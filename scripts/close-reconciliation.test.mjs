import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileCloseSnapshot } from '../lib/close-reconciliation.ts';

test('verified recovery corrects stale predecessor and capability flags without mutating D1 record', () => {
  const old = {
    date: '2026-09-30',
    previousDate: '2026-09-24',
    status: 'READY',
    breadth: { rowsAvailable: 5000 },
  };
  const seed = {
    date: '2026-09-30',
    previousDate: '2026-09-29',
    status: 'READY',
    evidenceStatus: 'DEGRADED',
    modules: {
      quotes: { status: 'READY' },
      indices: { status: 'READY' },
      boardMinuteFlow: { status: 'MISSING' },
    },
  };
  assert.deepEqual(reconcileCloseSnapshot(old, seed), seed);
  assert.equal(old.previousDate, '2026-09-24');
  assert.equal(
    reconcileCloseSnapshot(old, { ...seed, date: '2026-09-29' }),
    old,
  );
});
