import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildArchivedLadderSnapshot,
  consecutiveLimitHeight,
} from '../lib/ladder-evidence.ts';

const stock = (code, name, height, changePct = null) => ({
  code,
  name,
  height,
  changePct,
  industry: '测试行业',
  firstTouch: '09:30',
  lastSeal: '10:00',
  breakCount: 0,
  sealFund: null,
});
const snapshot = (date, ladders, failedStocks = [], closeQuotes = {}) => ({
  date,
  cutoff: '15:00',
  status: 'READY',
  source: 'test',
  limitUp: ladders.flatMap((level) => level.stocks).length,
  failed: failedStocks.length,
  limitDown: 0,
  sealRate: 100,
  highestBoard: Math.max(0, ...ladders.map((level) => level.height)),
  consecutiveCount: 0,
  turnover: 0,
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
  ladders,
  failedStocks,
  limitDownStocks: [],
  coverage: { reported: 1, available: 1 },
  closeQuotes,
});

test('closed ladder rebuild keeps sealed, failed and dropped candidates with exact-day prices', () => {
  const previous = snapshot('2026-09-08', [
    {
      height: 2,
      stocks: [stock('000001', '晋级股', 2), stock('000002', '炸板股', 2)],
    },
    { height: 1, stocks: [stock('000003', '掉队股', 1)] },
  ]);
  const current = snapshot(
    '2026-09-09',
    [{ height: 3, stocks: [stock('000001', '晋级股', 3, 10)] }],
    [stock('000002', '炸板股', 1, 3)],
    {
      '000003': {
        changePct: -5,
        quoteTime: '2026-09-09T15:00:00+08:00',
        source: 'test close',
      },
    },
  );
  const result = buildArchivedLadderSnapshot(
    current,
    previous,
    new Map(),
    '20260909',
  );
  assert.equal(result.status, 'READY');
  assert.deepEqual(
    result.competitors.map((row) => row.state),
    ['SEALED', 'FAILED', 'DROPPED'],
  );
  assert.equal(
    result.competitors.find((row) => row.code === '000003').changePct,
    -5,
  );
  assert.equal(result.coverage.quoteReady, 3);
});

test('closed ladder never fills a missing dropped price from another date', () => {
  const previous = snapshot('2026-09-08', [
    { height: 1, stocks: [stock('000003', '掉队股', 1)] },
  ]);
  const current = snapshot('2026-09-09', []);
  const quotes = new Map([
    [
      '000003',
      {
        changePct: 2,
        speedPct: 0,
        amount: 1,
        quoteTime: '2026-09-08T15:00:00+08:00',
        quoteSource: 'wrong day',
      },
    ],
  ]);
  const result = buildArchivedLadderSnapshot(
    current,
    previous,
    quotes,
    '20260909',
  );
  assert.equal(result.status, 'DEGRADED');
  assert.equal(result.competitors[0].changePct, null);
});

test('consecutive height ends on the exact prior date and stops at the first non-limit close', () => {
  const rows = [
    { date: '2026-09-03', close: 10 },
    { date: '2026-09-04', close: 10.5 },
    { date: '2026-09-07', close: 11.55 },
    { date: '2026-09-08', close: 12.71 },
    { date: '2026-09-09', close: 13.98 },
  ];
  assert.equal(consecutiveLimitHeight(rows, '20260908', '600001', '测试股'), 2);
  assert.equal(
    consecutiveLimitHeight(rows, '20260906', '600001', '测试股'),
    null,
  );
});
