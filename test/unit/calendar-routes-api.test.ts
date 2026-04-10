/**
 * Structural regression tests for the calendar route module extraction (Cycle 381).
 *
 * Verifies:
 * - server.ts wires the extracted calendar route module
 * - the route module exposes CRUD calendar routes
 * - the module keeps recurrence validation and alias-aware entity resolution
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readSrc(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf-8');
}

describe('Calendar route module wiring', () => {
  const serverSrc = readSrc('src/server.ts');
  const routesSrc = readSrc('src/server-calendar-routes.ts');

  it('server wires registerCalendarRoutes', () => {
    assert.ok(serverSrc.includes('registerCalendarRoutes'));
  });

  it('defines GET /api/v1/calendar-events', () => {
    assert.match(routesSrc, /['"]\/api\/v1\/calendar-events['"]/);
  });

  it('defines PATCH and DELETE /api/v1/calendar-events/:eventId', () => {
    assert.match(routesSrc, /['"]\/api\/v1\/calendar-events\/:eventId['"]/);
  });

  it('uses calendar query helpers from db/queries', () => {
    assert.ok(routesSrc.includes('getCalendarEvents'));
    assert.ok(routesSrc.includes('insertCalendarEvent'));
    assert.ok(routesSrc.includes('getCalendarEventById'));
    assert.ok(routesSrc.includes('updateCalendarEvent'));
    assert.ok(routesSrc.includes('deleteCalendarEvent'));
  });

  it('uses recurrence helpers from knowledge/calendar', () => {
    assert.ok(routesSrc.includes('getNextCalendarOccurrence'));
    assert.ok(routesSrc.includes('isCalendarRecurrenceRule'));
  });

  it('keeps alias-aware entity resolution for linked calendar events', () => {
    assert.ok(routesSrc.includes('resolveCalendarEntity'));
    assert.ok(routesSrc.includes('normalizeAlias'));
    assert.ok(routesSrc.includes('entity_aliases'));
  });

  it('rejects invalid recurrence rules and missing linked entities', () => {
    assert.ok(routesSrc.includes('Invalid recurrence rule'));
    assert.ok(routesSrc.includes('Linked entity not found'));
  });

  it('keeps the future-date guard for one-time events', () => {
    assert.ok(routesSrc.includes('Calendar events must be scheduled in the future'));
  });
});
