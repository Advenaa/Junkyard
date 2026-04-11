import type { RawItem } from '../ingest/rss.js';

export interface SpamRule {
  name: string;
  sources?: ('discord' | 'twitter' | 'rss' | 'news')[];
  test: (item: RawItem) => boolean;
}

export const SPAM_RULES: SpamRule[] = [
  // English patterns
  // Only filter very short posts from Discord (RSS/news headlines can be short)
  { name: 'short-post', sources: ['discord'], test: (i) => i.content.split(/\s+/).length < 3 },
  { name: 'gm-gn', test: (i) => /^(gm|gn|gm\/gn)\s*[!.]*$/i.test(i.content.trim()) },
  { name: 'bot-author', test: (i) => /\bbot\b/i.test(i.author) },

  // Indonesian patterns
  { name: 'id-wm', test: (i) => /^wm\s*$/i.test(i.content.trim()) },
  { name: 'id-done-min', test: (i) => /^(done\s*min|sudah\s*min)/i.test(i.content.trim()) },
  { name: 'id-gas', test: (i) => /^gas\s*!*$/i.test(i.content.trim()) },
  { name: 'id-mantap', test: (i) => /^mantap\s*[!.]*$/i.test(i.content.trim()) },
  { name: 'single-emoji', test: (i) => /^\p{Emoji}\s*$/u.test(i.content.trim()) },
  {
    name: 'airdrop-copypasta',
    sources: ['discord'],
    test: (i) => /airdrop/i.test(i.content) && i.content.includes('0x'),
  },
];

export function checkSpam(item: RawItem): { isSpam: boolean; rule?: string } {
  for (const rule of SPAM_RULES) {
    if (rule.sources && !rule.sources.includes(item.source)) {
      continue;
    }
    if (rule.test(item)) {
      return { isSpam: true, rule: rule.name };
    }
  }
  return { isSpam: false };
}
