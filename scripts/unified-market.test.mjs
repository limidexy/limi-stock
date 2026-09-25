import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { alignedEvidence } from '../lib/unified-market-evidence.ts';

const derived = JSON.parse(
  fs.readFileSync(
    new URL('../lib/close-derived-evidence.generated.json', import.meta.url),
  ),
);

test('archived 15:00 flow and five-minute speed are exact-date evidence, not fake curves', () => {
  const day = derived.dates['20260924'];
  assert.equal(day.flow.status, 'READY');
  assert.equal(day.flow.reported, 496);
  assert.equal(day.flow.available, 496);
  assert.equal(day.flow.cutoff, '15:00');
  assert.equal(day.speed.status, 'READY');
  assert.equal(day.speed.windowStart, '14:55');
  assert.equal(day.speed.windowEnd, '15:00');
  assert.equal(day.speed.rows.length, 30);
  assert.ok(day.speed.rows.every((row) => Number.isFinite(row.speedPct)));
});

test('same-date gates reject stale, missing and cross-date evidence', () => {
  const ready = {
    status: 'READY',
    sourceState: 'ARCHIVED',
    tradeDate: '20260924',
  };
  assert.equal(alignedEvidence('2026-09-24', ready), ready);
  assert.equal(
    alignedEvidence('2026-09-24', { ...ready, tradeDate: '20260921' }),
    null,
  );
  assert.equal(
    alignedEvidence('2026-09-24', { ...ready, sourceState: 'STALE' }),
    null,
  );
  assert.equal(
    alignedEvidence('2026-09-24', { ...ready, status: 'MISSING' }),
    null,
  );
});
