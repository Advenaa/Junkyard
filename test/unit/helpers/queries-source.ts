import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const QUERIES_DIR = join(ROOT, 'src/db/queries');

/**
 * Read all query domain files under src/db/queries/ and concatenate them.
 * Tests that previously read src/db/queries.ts as a single string should
 * use this helper instead, since the monolith is now a one-line re-export.
 */
export function readQueriesSource(): string {
  const files = readdirSync(QUERIES_DIR).filter((f) => f.endsWith('.ts') && f !== 'index.ts');
  return files.map((f) => readFileSync(join(QUERIES_DIR, f), 'utf-8')).join('\n');
}
