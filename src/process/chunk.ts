export const CHUNK_TOKEN_BUDGET = 6000;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function chunkByTokens<T extends { content: string }>(
  items: T[],
  budget: number,
): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let currentTokens = 0;

  for (const item of items) {
    const itemTokens = estimateTokens(item.content);
    if (currentTokens + itemTokens > budget && current.length > 0) {
      chunks.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(item);
    currentTokens += itemTokens;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export interface ChunkMeta {
  tokenCount: number;
  itemCount: number;
  estimatedEntities: number;
  hasUrgencyKeywords: boolean;
}

const URGENCY_KEYWORDS = [
  'exploit',
  'hack',
  'rate decision',
  'flash crash',
  'halt',
  'circuit breaker',
  'emergency',
  'bank run',
];

export function analyzeChunk<T extends { content: string }>(
  items: T[],
): ChunkMeta {
  const combined = items.map((i) => i.content).join(' ');
  const tokenCount = estimateTokens(combined);
  const lower = combined.toLowerCase();
  const entityHints = (
    combined.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+|\$[A-Za-z]+/g) ?? []
  ).length;
  return {
    tokenCount,
    itemCount: items.length,
    estimatedEntities: entityHints,
    hasUrgencyKeywords: URGENCY_KEYWORDS.some((kw) => lower.includes(kw)),
  };
}
