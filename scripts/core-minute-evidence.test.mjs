import test from 'node:test';
import assert from 'node:assert/strict';
import { extremePathObservation } from '../lib/core-minute-evidence.ts';
import { updateInfluenceHistory } from '../lib/core-influence-history.ts';

const date = '2026-09-28';
const path = (prices, extra = {}) => ({
  code: '600001',
  name: '普通主板',
  preClose: 10,
  points: prices.map((price, i) => ({ time: `09:${30 + i}`, price })),
  intervalMinutes: 1,
  source: 'exact date 1m test',
  ...extra,
});

test('minute extremes: verifies ordered limit-up then limit-down with instrument price limits', () => {
  const r = extremePathObservation(
    date,
    { code: '600001', name: '普通主板' },
    path([11, 10.5, 10, 9.5, 9, 9]),
    '09:35',
  );
  assert.equal(r.status, 'READY');
  assert.equal(r.skyFloor, true);
  assert.equal(r.upTime, '09:30');
  assert.equal(r.downTime, '09:34');
});
test('minute extremes: a 20cm stock does not use a ten-percent extreme threshold', () => {
  const r = extremePathObservation(
    date,
    { code: '300001', name: '创业板样本' },
    path([11, 10.5, 10, 9.5, 9, 9]),
    '09:35',
  );
  assert.equal(r.skyFloor, false);
  const real = extremePathObservation(
    date,
    { code: '300001', name: '创业板样本' },
    path([12, 11, 10, 9, 8, 8]),
    '09:35',
  );
  assert.equal(real.skyFloor, true);
});
test('minute extremes: five-minute, duplicate and future points cannot fabricate sequence', () => {
  const p = path([11, 10.5, 10, 9.5, 9.5, 9.5, 9]);
  assert.equal(extremePathObservation(date, p, p, '09:35').skyFloor, false);
  assert.equal(
    extremePathObservation(date, p, { ...p, intervalMinutes: 5 }, '09:36')
      .skyFloor,
    null,
  );
  assert.equal(
    extremePathObservation(
      date,
      p,
      { ...p, points: [...p.points, p.points[0]] },
      '09:36',
    ).skyFloor,
    null,
  );
});
test('minute extremes: IPO unknown limit boundaries remain missing', () => {
  const p = path([11, 10.5, 10, 9.5, 9, 9]);
  assert.equal(
    extremePathObservation(date, { code: '600001', name: 'N样本' }, p, '09:35')
      .status,
    'MISSING',
  );
});

const summary = () => ({
  date,
  cutoff: '10:00',
  availableAt: `${date}T10:00:00+08:00`,
  sourceState: 'LIVE',
  source: 'test raw-minute capture',
  conceptsAvailableAt: `${date}T09:00:00+08:00`,
  conceptsState: 'READY',
  concepts: { 600001: ['概念A'], 600002: ['概念A'], 600003: ['概念A'] },
  leadLag: {
    rows: [
      {
        core: { code: '600001', name: '容量样本' },
        status: 'READY',
        onset: { time: '09:40' },
        rows: ['600002', '600003'].map((code) => ({
          code,
          pathState: 'READY',
          role: '随后响应',
          time: '09:44',
          lag: 4,
        })),
      },
    ],
  },
});
test('influence registry: real per-pair minute and dated concepts record identity without a board threshold', () => {
  const records = updateInfluenceHistory(summary(), []);
  assert.equal(records.length, 1);
  assert.equal(records[0].code, '600001');
  assert.equal(records[0].name, '容量样本');
  assert.equal(records[0].respondingCodes.length, 2);
});
test('influence registry: a late concept capture or passive member never becomes durable leadership', () => {
  const s = summary();
  s.conceptsAvailableAt = `${date}T10:01:00+08:00`;
  assert.equal(updateInfluenceHistory(s, []).length, 0);
  const passive = summary();
  passive.leadLag.rows[0].rows[1].role = '早于核心';
  assert.equal(updateInfluenceHistory(passive, []).length, 0);
});
test('influence registry: old identity survives missing current paths and first-seen time cannot be backfilled', () => {
  const initial = updateInfluenceHistory(summary(), []);
  const later = summary();
  later.cutoff = '10:30';
  later.availableAt = `${date}T10:30:00+08:00`;
  assert.equal(
    updateInfluenceHistory(later, initial)[0].observedAt,
    initial[0].observedAt,
  );
  later.leadLag.rows = [];
  assert.equal(updateInfluenceHistory(later, initial).length, 1);
});
