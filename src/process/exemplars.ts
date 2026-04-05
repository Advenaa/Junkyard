export interface Exemplar {
  id: string;
  source: string;
  sourceId: string;
  content: string;
  engagement: number;
  author: string;
}

const URGENCY_KEYWORDS = ['exploit', 'hack', 'rate decision', 'flash crash', 'halt', 'circuit breaker'];

const URGENCY_PATTERN = new RegExp(URGENCY_KEYWORDS.join('|'), 'i');

/** Count capitalized multi-word terms and $-prefixed tokens in text. */
function countEntities(content: string): number {
  // Capitalized multi-word terms: two+ consecutive capitalized words
  const capitalizedMultiWord = content.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g);
  // $-prefixed tokens like $BTC, $ETH
  const dollarTokens = content.match(/\$[A-Za-z]+/g);

  return (capitalizedMultiWord?.length ?? 0) + (dollarTokens?.length ?? 0);
}

/** Estimate token count as content length / 4. */
function estimateTokens(content: string): number {
  return Math.max(content.length / 4, 1);
}

function scoreNewsItem(item: Exemplar): number {
  const tokens = estimateTokens(item.content);
  const entityDensity = (countEntities(item.content) / tokens) * 100;
  const urgencyWeight = URGENCY_PATTERN.test(item.content) ? 3 : 1;
  return entityDensity * urgencyWeight;
}

export function selectExemplars(items: Exemplar[], maxSlots = 10): Exemplar[] {
  const engagementSlots = Math.max(0, maxSlots - 3);
  const newsSlots = maxSlots - engagementSlots;

  // 1. Engagement-ranked picks
  const byEngagement = [...items].sort((a, b) => b.engagement - a.engagement);
  const engagementPicks = byEngagement.slice(0, engagementSlots);
  const pickedIds = new Set(engagementPicks.map((e) => e.id));

  // 2. RSS/news picks scored by entityDensity * urgencyWeight
  const newsItems = items.filter(
    (item) => (item.source === 'rss' || item.source === 'news') && !pickedIds.has(item.id),
  );

  const scoredNews = newsItems.map((item) => ({ item, score: scoreNewsItem(item) })).sort((a, b) => b.score - a.score);

  const newsPicks = scoredNews.slice(0, newsSlots).map((s) => s.item);

  // 3. Combine and deduplicate by id
  const result: Exemplar[] = [...engagementPicks];
  const resultIds = new Set(result.map((e) => e.id));

  for (const pick of newsPicks) {
    if (!resultIds.has(pick.id)) {
      result.push(pick);
      resultIds.add(pick.id);
    }
  }

  return result;
}
