import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { buildArchivedLadderSnapshot } from '../lib/ladder-evidence.ts';
const history = JSON.parse(
  fs.readFileSync(
    new URL('../lib/close-history.generated.json', import.meta.url),
  ),
).snapshots;
const tracking = JSON.parse(
  fs.readFileSync(
    new URL('../lib/emotion-tracking.generated.json', import.meta.url),
  ),
);

test('latest three exact-date recoveries have adjacent sessions and independent evidence states', () => {
  for (const [date, prior, up, failed, down] of [
    ['2026-09-28', '2026-09-24', 33, 11, 56],
    ['2026-09-29', '2026-09-28', 57, 8, 10],
    ['2026-09-30', '2026-09-29', 52, 12, 9],
  ]) {
    const current = history.find((d) => d.date === date);
    const previous = history.find((d) => d.date === prior);
    assert.equal(current.previousDate, prior);
    assert.deepEqual(
      [current.limitUp, current.failed, current.limitDown],
      [up, failed, down],
    );
    assert.equal(current.evidenceStatus, 'DEGRADED');
    assert.equal(current.modules.boardMinuteFlow.status, 'MISSING');
    const ladder = buildArchivedLadderSnapshot(
      current,
      previous,
      new Map(),
      '20261001',
    );
    assert.equal(ladder.previousTradeDate, prior.replaceAll('-', ''));
    assert.equal(ladder.counts.previousLimitUp, previous.limitUp);
    assert.equal(
      new Set(ladder.competitors.map((r) => r.code)).size,
      ladder.competitors.length,
    );
    assert.ok(ladder.competitors.some((r) => r.changePct < 0));
  }
});
test('adding later sessions never changes frozen earlier real minute paths', () => {
  const fixture = JSON.parse(
    zlib.gunzipSync(
      fs.readFileSync(
        new URL('./fixtures/real-tape-source-v1.json.gz', import.meta.url),
      ),
    ),
  );
  for (const [date, day] of Object.entries(fixture.dates))
    assert.deepEqual(tracking.dates[date].trends, day.trends);
});
test('excluded identities do not become complete minute coverage', () => {
  for (const date of ['2026-09-28', '2026-09-30']) {
    const row = tracking.audit.find((r) => r.date === date);
    assert.equal(row.minuteState, 'DEGRADED');
    assert.ok(row.minuteCoverage.available < row.minuteCoverage.requested);
  }
});
