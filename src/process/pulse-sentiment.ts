export interface EntitySentimentEntry {
  name: string;
  sentiment: number;
  reason: string;
}

export interface DriftFlag {
  entity: string;
  prior: number;
  current: number;
  delta: number;
}

export function detectDrift(currentEntities: Map<string, number>, priorEntities: EntitySentimentEntry[]): DriftFlag[] {
  const flags: DriftFlag[] = [];
  const priorMap = new Map<string, number>();
  for (const entry of priorEntities) {
    priorMap.set(entry.name.toLowerCase(), entry.sentiment);
  }

  for (const [name, currentSentiment] of currentEntities) {
    const priorSentiment = priorMap.get(name.toLowerCase());
    if (priorSentiment !== undefined) {
      const delta = Math.abs(priorSentiment - currentSentiment);
      if (delta > 0.4) {
        flags.push({
          entity: name,
          prior: priorSentiment,
          current: currentSentiment,
          delta,
        });
      }
    }
  }

  return flags;
}

export function computeAvgSentiment(report: { entitySentiment: { sentiment: number }[] }): number | null {
  if (report.entitySentiment.length === 0) return null;
  const sum = report.entitySentiment.reduce((acc, entry) => acc + entry.sentiment, 0);
  return Math.round((sum / report.entitySentiment.length) * 100) / 100;
}

export function aggregateEntitySentiment(
  parsedSummaries: Array<{ parsedEntities: Array<{ name: string; sentiment: number }> }>,
): Map<string, number> {
  const entitySentimentSums = new Map<string, { total: number; count: number }>();

  for (const summary of parsedSummaries) {
    for (const entity of summary.parsedEntities) {
      const key = entity.name.toLowerCase();
      const existing = entitySentimentSums.get(key) ?? { total: 0, count: 0 };
      existing.total += entity.sentiment;
      existing.count += 1;
      entitySentimentSums.set(key, existing);
    }
  }

  const currentEntitySentiment = new Map<string, number>();
  for (const [key, value] of entitySentimentSums) {
    currentEntitySentiment.set(key, value.total / value.count);
  }

  return currentEntitySentiment;
}
