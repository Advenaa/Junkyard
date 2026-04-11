import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const SERVER_SOURCE_FILES = [
  'src/server.ts',
  'src/server-route-helpers.ts',
  'src/server-report-routes.ts',
  'src/server-source-routes.ts',
  'src/server-search-routes.ts',
  'src/server-admin-routes.ts',
  'src/server-insight-routes.ts',
  'src/server-calendar-routes.ts',
  'src/server-entity-routes.ts',
] as const;

export function readServerSource(): string {
  return SERVER_SOURCE_FILES.map((file) => readFileSync(resolve(ROOT, file), 'utf-8')).join('\n\n');
}
