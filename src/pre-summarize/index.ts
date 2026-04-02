import type { Pool } from '../db/connection.js';
import type { Logger } from '../logger.js';
import type { Config } from '../config.js';

interface LLMCaller {
  call(params: {
    model: string;
    system: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
    maxTokens: number;
    stage: string;
  }): Promise<{ content: string }>;
}

interface Item {
  id: string;
  source: string;
  content: string;
}

const URGENCY_KEYWORDS = [
  'exploit', 'hack', 'rate decision', 'flash crash',
  'halt', 'circuit breaker', 'emergency', 'bank run',
];

function shouldSkip(item: { source: string; content: string }): boolean {
  if (item.source === 'discord' || item.source === 'twitter') return true;
  if (item.content.length <= 4000) return true;

  const lower = item.content.toLowerCase();
  if (URGENCY_KEYWORDS.some(kw => lower.includes(kw))) return true;

  const tokenEstimate = item.content.length / 4;
  const entityHints = (
    item.content.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+|\$[A-Za-z]+/g) ?? []
  ).length;
  const density = entityHints / (tokenEstimate / 100);
  if (density > 2) return true;

  return false;
}

const REGULATORY_RE = /regulat|OJK|SEC|CFTC|policy|rule|compliance/i;

const REGULATORY_PROMPT =
  'Summarize these regulatory/policy articles for a market analyst. Preserve: exact rule numbers, effective dates, affected entities, penalties, and quoted official statements. Drop background explainers. Content is in English (Indonesian content has been pre-translated). Output in English.';

const GENERAL_PROMPT =
  'Summarize these news articles for a market analyst. Preserve: all named entities, numbers, quotes, dates, and causal claims. Drop boilerplate, author bios, and filler paragraphs. Content is in English (Indonesian content has been pre-translated). Output in English.';

const OUTPUT_FORMAT_SUFFIX =
  '\n\nOutput format: label each summary with its number, e.g. [1] Summary text... [2] Summary text...';

function classifyBatch(batch: Item[]): 'regulatory' | 'general' {
  return batch.some(item => REGULATORY_RE.test(item.content))
    ? 'regulatory'
    : 'general';
}

function formatBatchContent(batch: Item[]): string {
  return batch.map((item, i) => `---[${i + 1}]---\n${item.content}`).join('\n\n');
}

function parseLabeledOutput(
  output: string,
  batchSize: number,
): (string | null)[] {
  const results: (string | null)[] = new Array(batchSize).fill(null);

  for (let i = 1; i <= batchSize; i++) {
    const labelPattern = new RegExp(
      `\\[${i}\\]\\s*([\\s\\S]*?)(?=\\[${i + 1}\\]|$)`,
    );
    const match = output.match(labelPattern);
    if (match) {
      const text = match[1].trim();
      if (text.length > 0) {
        results[i - 1] = text;
      }
    }
  }

  return results;
}

function chunk<T>(arr: T[], min: number, max: number): T[][] {
  const batches: T[][] = [];
  let offset = 0;
  while (offset < arr.length) {
    const size = Math.min(max, Math.max(min, arr.length - offset));
    batches.push(arr.slice(offset, offset + size));
    offset += size;
  }
  return batches;
}

export function createPreSummarizer(
  pool: Pool,
  log: Logger,
  config: Config,
  llm: LLMCaller,
) {
  async function run(): Promise<number> {
    const { rows } = await pool.query<Item>(
      `SELECT * FROM items WHERE status = 'ready' AND source IN ('rss', 'news') AND LENGTH(content) > 4000`,
    );

    const eligible = rows.filter(item => !shouldSkip(item));

    if (eligible.length === 0) {
      log.info('pre-summarize: no eligible items');
      return 0;
    }

    // Store content_anchor for each eligible item
    for (const item of eligible) {
      const anchor = item.content.slice(0, 800);
      await pool.query(
        'UPDATE items SET content_anchor = $1 WHERE id = $2',
        [anchor, item.id],
      );
    }

    const batches = chunk(eligible, 3, 5);
    let compressed = 0;

    for (const batch of batches) {
      const category = classifyBatch(batch);
      const basePrompt = category === 'regulatory' ? REGULATORY_PROMPT : GENERAL_PROMPT;
      const systemPrompt = basePrompt + OUTPUT_FORMAT_SUFFIX;
      const batchedContent = formatBatchContent(batch);

      try {
        const response = await llm.call({
          model: config.models.haiku,
          system: systemPrompt,
          messages: [{ role: 'user' as const, content: batchedContent }],
          maxTokens: 300 * batch.length,
          stage: 'pre-summarize',
        });

        const summaries = parseLabeledOutput(response.content, batch.length);

        for (let i = 0; i < batch.length; i++) {
          const summary = summaries[i];
          if (summary) {
            await pool.query(
              'UPDATE items SET content = $1 WHERE id = $2',
              [summary, batch[i].id],
            );
            compressed++;
          } else {
            log.warn(
              `pre-summarize: parse failure for item ${batch[i].id}, keeping original`,
            );
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        log.error(`pre-summarize: LLM call failed for batch, keeping originals: ${message}`);
      }
    }

    log.info(`pre-summarize: compressed ${compressed}/${eligible.length} items`);
    return compressed;
  }

  return { run };
}
