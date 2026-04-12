export const MIN_SUMMARIZABLE_DISCORD_CHUNK_CHARS = 50;

const SHORT_DISCORD_TICKER_SIGNAL_PATTERN = /(?:^|[^A-Za-z0-9_])\$[A-Za-z]{2,10}(?=$|[^A-Za-z0-9_])/;
const SHORT_DISCORD_NUMERIC_SIGNAL_PATTERN = /\b\d+(?:\.\d+)?%?\b/;
const SHORT_DISCORD_URL_SIGNAL_PATTERN = /https?:\/\//i;
const SHORT_DISCORD_KEYWORD_SIGNAL_PATTERN =
  /(?:exploit|hack|hacked|lawsuit|sues?|etf|listed?|listing|delist|launch|airdrop|audit|partnership|acquire[ds]?|governance|vote|approval|approved|rejected|fomc|cpi|inflation|rate cut|rate hike|bullish|bearish|strong|weak|compared|versus|vs\.?|higher|lower)\b/i;

export function buildChunkRawText<T extends { content: string }>(chunk: T[]): string {
  return chunk
    .map((item) => item.content.trim())
    .filter((content) => content.length > 0)
    .join(' ')
    .trim();
}

export function hasShortDiscordSignalMarker(text: string): boolean {
  return (
    SHORT_DISCORD_TICKER_SIGNAL_PATTERN.test(text) ||
    SHORT_DISCORD_NUMERIC_SIGNAL_PATTERN.test(text) ||
    SHORT_DISCORD_URL_SIGNAL_PATTERN.test(text) ||
    SHORT_DISCORD_KEYWORD_SIGNAL_PATTERN.test(text)
  );
}

export function shouldFilterShortDiscordChunk<T extends { content: string }>(source: string, chunk: T[]): boolean {
  if (source !== 'discord') return false;

  const rawChunkText = buildChunkRawText(chunk);

  if (rawChunkText.length === 0) return true;
  if (rawChunkText.length >= MIN_SUMMARIZABLE_DISCORD_CHUNK_CHARS) return false;

  return !hasShortDiscordSignalMarker(rawChunkText);
}
