import type { MacroIndicator } from '../db/queries.js';
import type { Logger } from '../logger.js';

export interface MacroObservationData {
  date: string;
  indicator: MacroIndicator;
  value: number;
  change1d: number | null;
  change7d: number | null;
  source: 'fred';
}

interface FredObservation {
  date: string;
  value: string;
}

interface FredSeriesResponse {
  observations?: FredObservation[];
}

export interface MacroFetcher {
  fetchLatest(): Promise<MacroObservationData[]>;
}

const BASE_URL = 'https://api.stlouisfed.org/fred/series/observations';
const REQUEST_TIMEOUT_MS = 15_000;
const LOOKBACK_OBSERVATIONS = 20;

const SERIES_DEFINITIONS: Array<{ indicator: MacroIndicator; seriesId: string; label: string }> = [
  { indicator: 'vix', seriesId: 'VIXCLS', label: 'VIX' },
  { indicator: 'dxy', seriesId: 'DTWEXBGS', label: 'DXY proxy' },
  { indicator: 'us10y', seriesId: 'DGS10', label: 'US 10Y' },
  { indicator: 'spx', seriesId: 'SP500', label: 'S&P 500' },
  { indicator: 'gold', seriesId: 'GOLDAMGBD228NLBM', label: 'Gold' },
];

function parseNumber(raw: string): number | null {
  if (!raw || raw === '.') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function computeTargetDate(date: string, daysBack: number): number | null {
  const parsed = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return null;
  return parsed - daysBack * 24 * 60 * 60 * 1000;
}

function findObservationAtOrBefore(
  observations: FredObservation[],
  date: string,
  daysBack: number,
): FredObservation | null {
  const target = computeTargetDate(date, daysBack);
  if (target === null) return null;

  for (const observation of observations.slice(1)) {
    const observedAt = Date.parse(`${observation.date}T00:00:00Z`);
    if (Number.isFinite(observedAt) && observedAt <= target) {
      return observation;
    }
  }

  return observations[1] ?? null;
}

function computeChange(latest: number, prior: FredObservation | null): number | null {
  if (!prior) return null;
  const priorValue = parseNumber(prior.value);
  return priorValue === null ? null : latest - priorValue;
}

export function createFredMacroFetcher(log: Logger, apiKey?: string): MacroFetcher {
  async function fetchSeries(definition: { indicator: MacroIndicator; seriesId: string; label: string }) {
    const params = new URLSearchParams({
      series_id: definition.seriesId,
      file_type: 'json',
      sort_order: 'desc',
      limit: String(LOOKBACK_OBSERVATIONS),
    });

    if (apiKey) {
      params.set('api_key', apiKey);
    }

    const response = await fetch(`${BASE_URL}?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`FRED returned ${response.status}: ${body.slice(0, 200)}`);
    }

    const data = (await response.json()) as FredSeriesResponse;
    const observations = (data.observations ?? []).filter((observation) => parseNumber(observation.value) !== null);
    const latest = observations[0];
    if (!latest) {
      log.warn(
        { indicator: definition.indicator, seriesId: definition.seriesId },
        'FRED returned no usable observations',
      );
      return null;
    }

    const latestValue = parseNumber(latest.value);
    if (latestValue === null) {
      log.warn(
        { indicator: definition.indicator, seriesId: definition.seriesId },
        'FRED latest observation was invalid',
      );
      return null;
    }

    return {
      date: latest.date,
      indicator: definition.indicator,
      value: latestValue,
      change1d: computeChange(latestValue, findObservationAtOrBefore(observations, latest.date, 1)),
      change7d: computeChange(latestValue, findObservationAtOrBefore(observations, latest.date, 7)),
      source: 'fred' as const,
    };
  }

  async function fetchLatest(): Promise<MacroObservationData[]> {
    if (!apiKey) {
      log.info('FRED_API_KEY not set — skipping macro fetch');
      return [];
    }

    const results: MacroObservationData[] = [];

    for (const definition of SERIES_DEFINITIONS) {
      try {
        const observation = await fetchSeries(definition);
        if (observation) {
          results.push(observation);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn(
          { err, indicator: definition.indicator, seriesId: definition.seriesId },
          `FRED macro fetch failed for ${definition.label}: ${message}`,
        );
      }
    }

    log.info({ requested: SERIES_DEFINITIONS.length, fetched: results.length }, 'Fetched macro indicators from FRED');

    return results;
  }

  return { fetchLatest };
}
