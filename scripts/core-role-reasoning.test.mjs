import test from 'node:test';
import assert from 'node:assert/strict';
import { emotionCoreReading } from '../lib/market-reading.ts';
import { updateInfluenceHistory } from '../lib/core-influence-history.ts';

const date = '2026-09-28',
  now = `${date}T10:00:00+08:00`;
const facts = {
  date,
  previousDate: '2026-09-24',
  cutoff: '10:00',
  retrievedAt: now,
  status: 'READY',
  poolsReady: true,
  breadthReady: true,
  limitUp: 0,
  failed: 0,
  limitDown: 0,
  highestBoard: 0,
  consecutiveCount: 0,
  ladders: [],
  failedStocks: [],
  limitDownStocks: [],
  breadth: { up: 5, down: 5, flat: 0, rowsAvailable: 10, medianChangePct: 0 },
};
function group(direction = 'up', concept = 'A') {
  return {
    core: { code: '600099', name: '观察股', height: 0 },
    industry: concept,
    status: 'READY',
    onset: { time: '09:42', gain: direction === 'up' ? 2 : -2 },
    requested: 3,
    available: 3,
    following: 2,
    rows: ['600002', '600003'].map((code) => ({
      code,
      name: code,
      pathState: 'READY',
      role: direction === 'up' ? '随后响应' : '随后负向响应',
      time: '09:48',
      lag: 6,
    })),
  };
}
function evidence({
  pct = 0.1,
  amount = 9e8,
  direction = 'up',
  historyConcept = 'A',
  speed = true,
} = {}) {
  return {
    date,
    cutoff: '10:00',
    availableAt: now,
    sourceState: 'LIVE',
    source: 'fixture',
    speedRows: speed
      ? [
          {
            code: '600099',
            name: '观察股',
            changePct: pct,
            amount,
            quoteTime: now,
          },
        ]
      : [],
    influenceHistory: [
      {
        code: '600099',
        date: '2026-09-23',
        observedAt: '2026-09-23T10:00:00+08:00',
        source: 'dated fixture',
        state: 'READY',
        respondingCodes: ['600002', '600003'],
        concept: historyConcept,
      },
    ],
    tracking: {
      date,
      cutoff: '10:00',
      availableAt: now,
      source: 'fixture',
      conceptsState: 'READY',
      conceptsAvailableAt: `${date}T09:00:00+08:00`,
      concepts: { 600099: ['A'], 600002: ['A'], 600003: ['A'] },
      leadLag: { rows: direction === 'up' ? [group()] : [] },
      negativeLeadLag: { rows: direction === 'down' ? [group('down')] : [] },
    },
  };
}
const run = (e) => emotionCoreReading(facts, null, [], [], e);
const stock = (r) => r.candidates.find((x) => x.code === '600099');

test('identity does not flip at the red/green price boundary; sequence never alone certifies a market core', () => {
  const positive = stock(run(evidence({ pct: 0.1 })));
  const negative = stock(run(evidence({ pct: -0.1 })));
  assert.equal(positive.provisional, true);
  assert.equal(negative.provisional, true);
  assert.equal(
    positive.interpretation.identity.label,
    negative.interpretation.identity.label,
  );
  assert.notEqual(
    positive.interpretation.feedback.label,
    negative.interpretation.feedback.label,
  );
  assert.notEqual(positive.state, '明牌核心');
});

test('verified local sequence recalls a new observation independent of speed list membership or the 1 billion cutoff', () => {
  for (const config of [{ speed: false }, { amount: 9e8 }, { amount: 1e9 }]) {
    const e = evidence(config);
    e.influenceHistory = [];
    const s = stock(run(e));
    assert.ok(s, JSON.stringify(config));
    assert.equal(s.height, null);
    assert.equal(s.provisional, true);
    assert.equal(s.interpretation.influence.direction, 'UP');
  }
});

test('negative group response is retained as influence, not missing leadership or identity loss', () => {
  const s = stock(run(evidence({ direction: 'down', pct: -6 })));
  assert.equal(s.dimensions.leadership.state, 'READY');
  assert.equal(s.interpretation.influence.direction, 'DOWN');
  assert.equal(s.interpretation.influence.groups[0].members.length, 2);
  assert.match(s.interpretation.influence.label, /负向/);
  assert.notEqual(s.state, '影响衰减退出');
});

test('old unrelated concept records do not certify current concept continuity', () => {
  const same = stock(run(evidence()));
  const changed = stock(run(evidence({ historyConcept: '旧题材B' })));
  assert.deepEqual(same.interpretation.influence.groups[0].historyDays, [
    '20260923',
  ]);
  assert.deepEqual(changed.interpretation.influence.groups[0].historyDays, []);
  assert.equal(changed.provisional, true);
});

test('sparse tiny declines in three proxies cannot erase an old identity, especially with negative response today', () => {
  for (const direction of ['up', 'down']) {
    const e = evidence({ direction });
    e.decayObservations = ['2026-09-01', '2026-09-10', '2026-09-24'].map(
      (d, i) => ({
        code: '600099',
        date: d,
        observedAt: `${d}T15:00:00+08:00`,
        source: 'fixture',
        state: 'READY',
        liquidityShare: 0.5 - i * 0.01,
        responseCount: 100 - i,
        recognitionCount: 1000 - i,
        coverage: 1,
      }),
    );
    const s = stock(run(e));
    assert.notEqual(s.state, '影响衰减退出');
    assert.match(s.dimensions.persistence.basis, /退出/);
  }
});

test('history archive keeps opposite directions and different concepts separate', () => {
  const e = evidence();
  const summary = {
    ...e.tracking,
    sourceState: 'LIVE',
    negativeLeadLag: { rows: [group('down')] },
    concepts: { 600099: ['A', 'B'], 600002: ['A', 'B'], 600003: ['A', 'B'] },
  };
  const records = updateInfluenceHistory(summary, []);
  assert.equal(records.length, 4);
  assert.deepEqual(
    new Set(records.map((x) => `${x.concept}:${x.direction}`)),
    new Set(['A:up', 'B:up', 'A:down', 'B:down']),
  );
});

test('late receipt or late group/member evidence cannot be archived as an earlier known identity', () => {
  const base = { ...evidence().tracking, sourceState: 'LIVE' };
  assert.equal(
    updateInfluenceHistory(
      { ...base, availableAt: `${date}T10:01:00+08:00` },
      [],
    ).length,
    0,
  );
  for (const target of ['group', 'member']) {
    const s = structuredClone(base);
    if (target === 'group')
      s.leadLag.rows[0].availableAt = `${date}T10:05:00+08:00`;
    else
      s.leadLag.rows[0].rows.forEach((row) => {
        row.availableAt = `${date}T10:05:00+08:00`;
      });
    assert.equal(updateInfluenceHistory(s, []).length, 0, target);
  }
});

test('past negative non-board identity remains known when current quotes and sequences are missing', () => {
  const e = evidence({ speed: false });
  e.tracking.leadLag.rows = [];
  e.influenceHistory[0].direction = 'down';
  const s = stock(run(e));
  assert.equal(s.scope, 'HISTORY');
  assert.equal(s.dimensions.identity.state, 'READY');
  assert.match(s.dimensions.identity.fact, /历史.*A.*负向.*2/);
  assert.equal(s.quoteState, 'MISSING');
  assert.equal(s.interpretation.influence.direction, 'UNRESOLVED');
  assert.match(s.currentRole, /历史题材响应/);
});

test('non-board positive response cannot manufacture surviving spatial strength while all previous high boards fall', () => {
  const e = evidence({ pct: 6 });
  const before = {
    ...facts,
    date: '2026-09-24',
    cutoff: '15:00',
    retrievedAt: '2026-09-24T15:00:00+08:00',
    highestBoard: 3,
    ladders: [
      {
        height: 3,
        stocks: ['600011', '600012'].map((code) => ({
          code,
          name: code,
          height: 3,
          changePct: 10,
        })),
      },
    ],
  };
  const rows = ['600011', '600012'].map((code) => ({
    code,
    name: code,
    fromHeight: 3,
    toHeight: 4,
    state: 'DROPPED',
    changePct: -8,
    quoteTime: now,
  }));
  const r = emotionCoreReading(facts, before, rows, [], e);
  assert.equal(r.retreatWarning, true);
  assert.ok(!r.summary.includes('空间高位仍有强势表现'));
  assert.match(r.summary, /中位已出现集中负反馈/);
});
