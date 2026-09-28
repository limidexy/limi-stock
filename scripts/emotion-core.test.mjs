import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildEmotionTracking,
  priorSession,
  trackingCandidates,
} from '../lib/emotion-tracking.ts';
import { buildCoreEvidence } from '../lib/core-evidence.ts';

const history = JSON.parse(
  fs.readFileSync(new URL('../lib/close-history.generated.json', import.meta.url)),
).snapshots;
const tracking = JSON.parse(
  fs.readFileSync(new URL('../lib/emotion-tracking.generated.json', import.meta.url)),
).dates;

const closeDay = (date, code, height = 3) => ({
  date,
  cutoff: '15:00',
  status: 'READY',
  source: 'test close',
  limitUp: 1,
  failed: 0,
  limitDown: 0,
  sealRate: 100,
  highestBoard: height,
  consecutiveCount: 1,
  turnover: 1,
  breadth: {
    requested: 1,
    rowsAvailable: 1,
    up: 1,
    down: 0,
    flat: 0,
    medianChangePct: 1,
  },
  indexMood: '',
  shortMood: '',
  cycleNode: '',
  concentratedIndustries: [],
  leaders: [],
  indices: [],
  ladders: [{
    height,
    stocks: [{
      code,
      name: code,
      height,
      changePct: 1,
      industry: '测试行业',
      firstTouch: null,
      lastSeal: null,
      breakCount: 0,
      sealFund: null,
    }],
  }],
  failedStocks: [],
  limitDownStocks: [],
  coverage: { reported: 1, available: 1 },
});

test('lookback limits displayed paths but not prior high-board identity recall', () => {
  const all = [
    closeDay('2026-09-01', '600001'),
    closeDay('2026-09-02', '600002'),
    closeDay('2026-09-03', '600003'),
    closeDay('2026-09-04', '600004'),
  ];
  const result = trackingCandidates(all, '2026-09-05', 1);
  assert.equal(result.prior.length, 1);
  assert.ok(result.leaders.some((row) => row.code === '600001'));
  assert.ok(!result.displayLeaders.some((row) => row.code === '600001'));
});

test('holiday gap is not inferred as an adjacent trading session', () => {
  assert.equal(priorSession('2026-09-28', '2026-09-24'), false);
  assert.equal(
    priorSession('2026-09-28', '2026-09-24', { previousDate: '2026-09-24' }),
    true,
  );
});

test('tracking summary exposes source cutoff and exact availability without fabricating concepts', () => {
  const result = buildEmotionTracking(history, tracking, '2026-09-18');
  assert.equal(result.date, '2026-09-18');
  assert.equal(result.cutoff, '15:00');
  assert.match(result.availableAt, /2026-09-18T15:00:00\+08:00/);
  assert.ok(['READY', 'DEGRADED', 'MISSING', 'RECOVERED_LATE'].includes(result.conceptsState));
  assert.ok('negativeLeadLag' in result);
});

test('date-mismatched tracking cannot remove an as-of history candidate set', () => {
  const facts = {
    ...history.at(-1),
    poolsReady: true,
    breadthReady: true,
  };
  const result = buildCoreEvidence({
    facts,
    tracking: {
      date: '2026-09-01',
      source: 'wrong date fixture',
      sourceState: 'ARCHIVED',
      retrievedAt: '2026-09-28T15:00:00+08:00',
      quotes: {},
      trends: {},
    },
    history,
  });
  assert.equal(result.tracking, undefined);
  assert.equal(result.history?.length, history.length);
});

