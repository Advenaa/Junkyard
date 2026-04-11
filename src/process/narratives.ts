import { kmeans } from 'ml-kmeans';
import { ulid } from 'ulid';
import type { Pool } from '../db/connection.js';
import { bytesToVector } from '../embed.js';
import type { Logger } from '../logger.js';
import type { Config } from '../config.js';

export interface Narrative {
  id: string;
  name: string;
  date: string;
  memberCount: number;
  avgSentiment: number | null;
  signalStrength: 'new' | 'emerging' | 'strong' | 'stable' | 'fading';
  summaryIds: string[];
}

interface LLM {
  call(params: {
    model: string;
    system: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
    maxTokens: number;
    stage: string;
  }): Promise<{ content: string }>;
}

interface Embedder {
  isAvailable(): boolean;
}

interface SummaryRow {
  summary_id: string;
  vector: Buffer;
  body: string;
  sentiment: number | null;
}

interface NarrativeRow {
  id: string;
  name: string;
  date: string;
  member_count: number;
  avg_sentiment: number | null;
  signal_strength: 'new' | 'emerging' | 'strong' | 'stable' | 'fading';
  summary_ids: string[];
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function cosineDistance(a: number[], b: number[]): number {
  return 1 - cosineSimilarity(a, b);
}

function silhouetteScore(points: number[][], assignments: number[], k: number, sampleRate = 0.1): number {
  const n = points.length;
  if (n <= 1) return 0;

  // Approximate silhouette: sample a subset of points to avoid O(n²k)
  const sampleSize = Math.min(n, Math.max(30, Math.ceil(n * sampleRate)));
  const allIndices = Array.from({ length: n }, (_, i) => i);

  // Fisher-Yates partial shuffle for sampling
  const indices: number[] = [];
  const pool = [...allIndices];
  for (let s = 0; s < sampleSize; s++) {
    const pick = s + Math.floor(Math.random() * (pool.length - s));
    [pool[s], pool[pick]] = [pool[pick], pool[s]];
    indices.push(pool[s]);
  }

  let totalSilhouette = 0;
  let counted = 0;

  for (const i of indices) {
    const clusterI = assignments[i];

    // Compute average distance to own cluster (a)
    let sumA = 0;
    let countA = 0;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      if (assignments[j] === clusterI) {
        sumA += cosineDistance(points[i], points[j]);
        countA++;
      }
    }
    // Skip singleton clusters
    if (countA === 0) continue;
    const a = sumA / countA;

    // Compute average distance to nearest other cluster (b)
    let minB = Infinity;
    for (let c = 0; c < k; c++) {
      if (c === clusterI) continue;
      let sumB = 0;
      let countB = 0;
      for (let j = 0; j < n; j++) {
        if (assignments[j] === c) {
          sumB += cosineDistance(points[i], points[j]);
          countB++;
        }
      }
      if (countB > 0) {
        const avgB = sumB / countB;
        if (avgB < minB) minB = avgB;
      }
    }

    if (minB === Infinity) continue;
    const b = minB;
    const maxAB = Math.max(a, b);
    const s = maxAB === 0 ? 0 : (b - a) / maxAB;
    totalSilhouette += s;
    counted++;
  }

  return counted === 0 ? 0 : totalSilhouette / counted;
}

/** Validate a timezone string. Returns the timezone if valid, fallback otherwise. */
function validateTimezone(tz: string, fallback: string, log: Logger): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    log.warn({ timezone: tz }, `Invalid timezone "${tz}", falling back to ${fallback}`);
    return fallback;
  }
}

/** Get the epoch timestamp for midnight of a given YYYY-MM-DD date in a timezone. */
export function midnightEpoch(dateStr: string, tz: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  // Create midnight UTC for this date
  const utcMidnight = new Date(Date.UTC(y, m - 1, d));
  // Format this UTC instant in both UTC and target TZ
  const utcStr = utcMidnight.toLocaleString('en-US', { timeZone: 'UTC' });
  const tzStr = utcMidnight.toLocaleString('en-US', { timeZone: tz });
  // The difference between parsing these back tells us the offset
  const utcParsed = new Date(utcStr).getTime();
  const tzParsed = new Date(tzStr).getTime();
  const offsetMs = utcParsed - tzParsed;
  // midnight local = midnight UTC + offset
  // (if TZ is UTC+7, tzParsed > utcParsed, so offset is negative, meaning midnight local is BEFORE midnight UTC)
  return Date.UTC(y, m - 1, d) + offsetMs;
}

/** Decrement a YYYY-MM-DD date string by one day, DST-safe. */
export function decrementDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  return prev.toISOString().slice(0, 10);
}

function computeCentroid(points: number[][]): number[] {
  if (points.length === 0) return [];
  const dim = points[0].length;
  const centroid = new Array<number>(dim).fill(0);
  for (const p of points) {
    for (let i = 0; i < dim; i++) {
      centroid[i] += p[i];
    }
  }
  for (let i = 0; i < dim; i++) {
    centroid[i] /= points.length;
  }
  return centroid;
}

export function createNarrativeDetector(pool: Pool, log: Logger, config: Config, llm: LLM, embedder: Embedder) {
  async function detectNarratives(): Promise<Narrative[]> {
    if (!embedder.isAvailable()) {
      log.info('Embedder not available, skipping narrative detection');
      return [];
    }

    // Compute yesterday's date range in configured timezone (SL-013 fix)
    let timezone = 'Asia/Jakarta';
    try {
      const tzResult = await pool.query<{ value: string }>("SELECT value FROM app_config WHERE key = 'timezone'");
      timezone = tzResult.rows[0]?.value ?? timezone;
    } catch {
      log.warn('Could not read timezone from app_config, defaulting to Asia/Jakarta');
    }
    timezone = validateTimezone(timezone, 'Asia/Jakarta', log);

    const now = new Date();
    const todayStr = now.toLocaleDateString('en-CA', { timeZone: timezone });
    const yesterdayStr = decrementDate(todayStr);
    const dateStr = yesterdayStr;

    const startOfDay = new Date(midnightEpoch(yesterdayStr, timezone));
    const endOfDay = new Date(midnightEpoch(todayStr, timezone));

    // Step a: Load summary embeddings
    const { rows } = await pool.query<SummaryRow>(
      `SELECT e.target_id AS summary_id, e.vector, s.body, s.sentiment
       FROM embeddings e
       JOIN summaries s ON s.id = e.target_id
       WHERE e.target_type = 'summary'
         AND s.created_at >= $1 AND s.created_at < $2`,
      [startOfDay.getTime(), endOfDay.getTime()],
    );

    // Step b: Skip if < 9 summaries
    if (rows.length < 9) {
      log.info({ count: rows.length }, 'Too few summaries for narrative detection (need 9+)');
      return [];
    }

    // Step c: Convert vectors
    const validRows: SummaryRow[] = [];
    const vectors: number[][] = [];
    for (const row of rows) {
      const f32 = bytesToVector(row.vector);
      if (!f32) continue;
      validRows.push(row);
      vectors.push(Array.from(f32));
    }

    if (validRows.length < 9) {
      log.info({ count: validRows.length }, 'Too few summaries for narrative detection (need 9+)');
      return [];
    }

    // Step d: K-means with silhouette auto-tuning
    const maxK = Math.min(10, Math.floor(validRows.length / 3));
    let bestK = 3;
    let bestScore = -1;
    let bestAssignments: number[] = [];

    for (let k = 3; k <= maxK; k++) {
      const result = kmeans(vectors, k, { initialization: 'kmeans++' });
      const score = silhouetteScore(vectors, result.clusters, k);
      log.debug({ k, silhouette: score }, 'K-means silhouette');
      if (score > bestScore) {
        bestScore = score;
        bestK = k;
        bestAssignments = result.clusters;
      }
    }

    log.info({ bestK, silhouette: bestScore, points: validRows.length }, 'Selected k for narrative clustering');

    // Step f: Group by cluster and filter 3+ members
    const clusterMap = new Map<number, number[]>();
    for (let i = 0; i < bestAssignments.length; i++) {
      const c = bestAssignments[i];
      const existing = clusterMap.get(c);
      if (existing) {
        existing.push(i);
      } else {
        clusterMap.set(c, [i]);
      }
    }

    const validClusters: { indices: number[] }[] = [];
    for (const [, indices] of clusterMap) {
      if (indices.length >= 3) {
        validClusters.push({ indices });
      }
    }

    if (validClusters.length === 0) {
      log.info('No clusters with 3+ members found');
      return [];
    }

    // Step h: Load prior day's narratives for signal strength comparison
    const priorDateStr = decrementDate(yesterdayStr);

    const { rows: priorNarratives } = await pool.query<NarrativeRow>('SELECT * FROM narratives WHERE date = $1', [
      priorDateStr,
    ]);

    // Compute centroids for prior narratives using their summary embeddings
    const priorCentroids: { narrative: NarrativeRow; centroid: number[] }[] = [];
    for (const pn of priorNarratives) {
      if (pn.summary_ids.length === 0) continue;
      const { rows: priorEmbRows } = await pool.query<{ vector: Buffer }>(
        `SELECT e.vector FROM embeddings e
         WHERE e.target_type = 'summary' AND e.target_id = ANY($1)`,
        [pn.summary_ids],
      );
      if (priorEmbRows.length > 0) {
        const priorVecs = priorEmbRows
          .map((r) => bytesToVector(r.vector))
          .filter((vec): vec is Float32Array => vec !== null)
          .map((vec) => Array.from(vec));
        if (priorVecs.length > 0) {
          priorCentroids.push({ narrative: pn, centroid: computeCentroid(priorVecs) });
        }
      }
    }

    // Step g + h + i: Name clusters, determine signal strength, insert
    const narratives: Narrative[] = [];

    for (const cluster of validClusters) {
      const { indices } = cluster;

      // Compute cluster centroid
      const clusterVectors = indices.map((i) => vectors[i]);
      const centroid = computeCentroid(clusterVectors);

      // Compute avg sentiment
      const sentiments = indices.map((i) => validRows[i].sentiment).filter((s): s is number => s !== null);
      const avgSentiment = sentiments.length > 0 ? sentiments.reduce((sum, s) => sum + s, 0) / sentiments.length : null;

      // Summary IDs
      const summaryIds = indices.map((i) => validRows[i].summary_id);

      // Name via Haiku (with fallback on failure)
      const snippets = indices.map((i) => validRows[i].body.slice(0, 200)).join('\n---\n');
      let name: string;
      try {
        const nameResult = await llm.call({
          model: config.models.normalizer,
          system: 'Name this discussion cluster in 3-5 words. Return ONLY the name, nothing else.',
          messages: [{ role: 'user', content: snippets }],
          maxTokens: 20,
          stage: 'narrative-cluster',
        });
        name = nameResult.content.trim();
      } catch (err) {
        log.warn({ err }, 'LLM naming failed, using fallback');
        name = '';
      }
      if (!name) {
        // Fallback: first 5 words from the longest summary body
        const longestBody = indices.map((i) => validRows[i].body).sort((a, b) => b.length - a.length)[0] ?? '';
        name = longestBody.split(/\s+/).slice(0, 5).join(' ') || `Cluster ${dateStr}`;
      }

      // Signal strength
      let signalStrength: Narrative['signalStrength'] = 'new';

      for (const prior of priorCentroids) {
        const sim = cosineSimilarity(centroid, prior.centroid);
        if (sim > 0.7) {
          const growthRate = indices.length / prior.narrative.member_count;
          if (growthRate >= 3.0) {
            signalStrength = 'strong';
          } else if (growthRate >= 1.5) {
            signalStrength = 'emerging';
          } else if (growthRate <= 0.5) {
            signalStrength = 'fading';
          } else {
            signalStrength = 'stable';
          }
          break;
        }
      }

      const id = ulid();
      const narrative: Narrative = {
        id,
        name,
        date: dateStr,
        memberCount: indices.length,
        avgSentiment,
        signalStrength,
        summaryIds,
      };

      // Insert
      await pool.query(
        `INSERT INTO narratives (id, name, date, member_count, avg_sentiment, signal_strength, summary_ids, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, name, dateStr, indices.length, avgSentiment, signalStrength, summaryIds, Date.now()],
      );

      narratives.push(narrative);
    }

    log.info({ count: narratives.length, date: dateStr }, 'Narrative detection complete');

    return narratives;
  }

  return { detectNarratives };
}
