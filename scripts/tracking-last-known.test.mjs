import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTrackingCutoff } from '../lib/tracking-cutoff.ts';
import { exactQuote } from '../lib/emotion-tracking.ts';
import { buildCoreEvidence } from '../lib/core-evidence.ts';
import { shortEmotionReading } from '../lib/market-reading.ts';

const date = '2026-09-28',
  at = `${date}T13:56:26.860+08:00`;
const saved = {
  date,
  cutoff: '13:56',
  availableAt: at,
  asOf: at,
  sessionState: 'CLOSED',
  source: 'actual saved intraday source',
  quotes: {
    600001: {
      changePct: 9.98,
      quoteTime: `${date}T13:56:10+08:00`,
      source: 'individual quote',
    },
  },
  trends: {},
};
const stock = {
  code: '600001',
  name: 'space sample',
  height: 4,
  changePct: 9.98,
  industry: 'test',
};
const base = {
  date,
  cutoff: '13:56',
  retrievedAt: at,
  status: 'DEGRADED',
  stale: true,
  poolsReady: true,
  breadthReady: false,
  limitUp: 1,
  failed: 0,
  limitDown: 0,
  highestBoard: 4,
  consecutiveCount: 1,
  ladders: [{ height: 4, stocks: [stock] }],
  failedStocks: [],
  limitDownStocks: [],
  breadth: { up: 0, down: 0, flat: 0, rowsAvailable: 0, medianChangePct: null },
};

test('a saved intraday observation is not promoted to 15:00 when final close is absent', () => {
  const end = resolveTrackingCutoff(date, saved, false);
  assert.equal(end.cutoff, '13:56');
  assert.equal(end.lastKnown, true);
  assert.match(end.reason, /非当前实时/);
  assert.equal(resolveTrackingCutoff(date, saved, true).cutoff, '15:00');
  assert.equal(
    resolveTrackingCutoff('2026-09-29', saved, false).lastKnown,
    false,
  );
});

test('a closed-session saved intraday quote uses its actual capture time, never a future close', () => {
  assert.equal(exactQuote(saved, date, '600001', '13:56').changePct, 9.98);
  assert.equal(exactQuote(saved, date, '600001', '13:55'), null);
  assert.equal(exactQuote(saved, date, '600001', '15:00'), null);
  const future = {
    ...saved,
    quotes: {
      600001: {
        ...saved.quotes['600001'],
        quoteTime: `${date}T13:56:27+08:00`,
      },
    },
  };
  assert.equal(exactQuote(future, date, '600001', '13:56'), null);
});

test('fixed intraday observation preserves exact snapshot milliseconds without advancing a historical close', () => {
  const e = buildCoreEvidence({ facts: base, decisionMode: 'FIXED' });
  assert.equal(e.decisionAt, at);
  assert.equal(
    buildCoreEvidence({
      facts: {
        ...base,
        cutoff: '15:00',
        retrievedAt: `${date}T16:00:00+08:00`,
      },
      decisionMode: 'FIXED',
    }).decisionAt,
    `${date}T15:00:00+08:00`,
  );
});

test('same-day last-known space identity survives an unrelated archived ladder, without calling it realtime', () => {
  const priorStock = { ...stock, height: 3 };
  const prior = {
    ...base,
    date: '2026-09-24',
    cutoff: '15:00',
    stale: false,
    status: 'READY',
    retrievedAt: '2026-09-24T15:00:00+08:00',
    ladders: [{ height: 3, stocks: [priorStock] }],
    highestBoard: 3,
  };
  const tracking = {
    ...saved,
    sourceState: 'ARCHIVED',
    previousDate: '2026-09-24',
    oldLeaders: { rows: [] },
    rebounds: { rows: [] },
    leadLag: { rows: [] },
  };
  const e = buildCoreEvidence({
    facts: base,
    tracking,
    history: [prior],
    decisionMode: 'FIXED',
  });
  const archivedLadder = {
    tradeDate: '20260924',
    previousTradeDate: '20260923',
    sourceState: 'ARCHIVED',
    sessionState: 'CLOSED',
    status: 'READY',
    priorDateState: 'READY',
    retrievedAt: '2026-09-28T19:00:00+08:00',
    counts: { previousLimitUp: 1, todaySealed: 1 },
    sealedStocks: [{ ...stock, code: '600999', name: 'wrong day' }],
    competitors: [],
  };
  const result = shortEmotionReading(base, prior, archivedLadder, e);
  assert.ok(result.core.activeCandidates.some((c) => c.code === '600001'));
  assert.equal(
    result.core.candidates.find((c) => c.code === '600999'),
    undefined,
  );
  assert.equal(result.core.observationMode, 'LAST_KNOWN');
  assert.match(result.core.summary, /非实时/);
  assert.equal(result.core.observedAt, at);
  assert.notEqual(
    result.core.activeCandidates[0].dimensions.position.state,
    'READY',
  );
});
