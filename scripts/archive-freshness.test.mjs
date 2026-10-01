import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveFreshness } from '../lib/archive-freshness.ts';

const sessions = ['2026-09-24', '2026-09-28', '2026-09-29', '2026-09-30'];
test('stale archive reports the three trailing missing sessions, not an empty list', () => {
  const result = archiveFreshness(
    sessions,
    ['2026-09-24'],
    new Date('2026-10-01T02:00:00Z'),
  );
  assert.deepEqual(result.missingDates, [
    '2026-09-28',
    '2026-09-29',
    '2026-09-30',
  ]);
  assert.equal(result.expectedDate, '2026-09-30');
  assert.equal(result.stale, true);
});
test('holiday and not-yet-completed session are never reported as missing CLOSE', () => {
  assert.deepEqual(
    archiveFreshness(sessions, sessions, new Date('2026-10-01T02:00:00Z'))
      .missingDates,
    [],
  );
  assert.equal(
    archiveFreshness(
      sessions,
      sessions.slice(0, 3),
      new Date('2026-09-30T04:00:00Z'),
    ).expectedDate,
    '2026-09-29',
  );
});
