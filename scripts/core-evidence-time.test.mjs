import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCoreEvidence } from '../lib/core-evidence.ts';
import { emotionCoreReading } from '../lib/market-reading.ts';
import { buildTapeObservation } from '../lib/tape-observation.ts';

const facts = (date, cutoff) => ({
  date,
  cutoff,
  status: 'READY',
  stale: false,
  poolsReady: true,
  breadthReady: true,
  limitUp: 1,
  failed: 0,
  limitDown: 0,
  highestBoard: 3,
  consecutiveCount: 1,
  breadth: {
    up: 1,
    down: 0,
    flat: 0,
    rowsAvailable: 1,
    medianChangePct: 1,
  },
  ladders: [],
  failedStocks: [],
  limitDownStocks: [],
  indices: [],
});

const tracking = (date, availableAt, sourceState = 'LIVE') => ({
  date,
  cutoff: '13:34:19',
  source: 'test minute capture',
  sourceState,
  sessionState: sourceState === 'LIVE' ? 'LIVE' : 'CLOSED',
  availableAt,
  retrievedAt: availableAt,
  quotes: {},
  trends: {},
});

test('live decision uses the newly received 13:34:19 minute at 13:34:20', () => {
  const result = buildCoreEvidence({
    facts: facts('2026-09-28', '13:34:08'),
    tracking: tracking('2026-09-28', '2026-09-28T13:34:19+08:00'),
    speed: {
      tradeDate: '20260928',
      sourceState: 'LIVE',
      retrievedAt: '2026-09-28T13:34:19+08:00',
      rows: [],
    },
    decisionMode: 'LIVE',
    now: Date.parse('2026-09-28T13:34:20+08:00'),
  });

  assert.equal(result.decisionMode, 'LIVE');
  assert.equal(result.decisionAt, '2026-09-28T13:34:20+08:00');
  assert.equal(result.tracking.availableAt, '2026-09-28T13:34:19+08:00');
});

test('fixed 13:34:08 does not advance to a minute that arrived at 13:34:19', () => {
  const result = buildCoreEvidence({
    facts: facts('2026-09-28', '13:34:08'),
    tracking: tracking('2026-09-28', '2026-09-28T13:34:19+08:00', 'STALE'),
    speed: {
      tradeDate: '20260928',
      sourceState: 'STALE',
      retrievedAt: '2026-09-28T13:34:19+08:00',
      rows: [
        {
          code: '600001',
          name: '测试股',
          changePct: 9,
          speedPct: 1,
          quoteTime: '2026-09-28T13:34:19+08:00',
        },
      ],
    },
    decisionMode: 'FIXED',
    now: Date.parse('2026-09-28T13:34:20+08:00'),
  });

  assert.equal(result.decisionMode, 'FIXED');
  assert.equal(result.decisionAt, '2026-09-28T13:34:08+08:00');
  assert.ok(
    Date.parse(result.speedRows[0].availableAt) > Date.parse(result.decisionAt),
  );
  assert.equal(result.tracking.availableAt, '2026-09-28T13:34:19+08:00');
});

test('a late response from the previous date cannot be mixed into the new date', () => {
  const result = buildCoreEvidence({
    facts: facts('2026-09-29', '09:40:00'),
    tracking: tracking('2026-09-28', '2026-09-28T15:00:00+08:00', 'ARCHIVED'),
    speed: {
      tradeDate: '20260928',
      sourceState: 'STALE',
      retrievedAt: '2026-09-28T15:00:00+08:00',
      rows: [{ code: '600001', name: '旧日股', changePct: 10, speedPct: 1 }],
    },
    decisionMode: 'LIVE',
    now: Date.parse('2026-09-29T09:40:01+08:00'),
  });

  assert.equal(result.decisionMode, 'FIXED');
  assert.equal(result.decisionAt, '2026-09-29T09:40:00+08:00');
  assert.equal(result.tracking, undefined);
  assert.deepEqual(result.speedRows, []);
});

test('live independent minute receipt advances despite a stale emotion pool, while fixed replay rejects it', () => {
  const f = {
    ...facts('2026-09-28', '13:34:08'),
    stale: true,
    retrievedAt: '2026-09-28T13:34:08+08:00',
  };
  const ss = [
    {
      code: '600001',
      name: 'space fixture',
      height: 3,
      changePct: 10,
      industry: 'test',
    },
  ];
  const packet = tracking('2026-09-28', '2026-09-28T13:34:19.378+08:00');
  packet.cutoff = '13:34';
  packet.tape = buildTapeObservation({
    date: f.date,
    cutoff: '13:34',
    previous: ss,
    source: 'local complete interval',
    availableAt: packet.availableAt,
    trends: {
      600001: {
        code: '600001',
        name: 'space fixture',
        preClose: 10,
        points: ['13:31', '13:32', '13:33', '13:34'].map((time, i) => ({
          time,
          price: 10 + i * 0.1,
        })),
      },
    },
  });
  const received = Date.parse('2026-09-28T13:34:19.500+08:00');
  const live = buildCoreEvidence({
    facts: f,
    tracking: packet,
    decisionMode: 'LIVE',
    now: received,
  });
  assert.equal(live.decisionMode, 'LIVE');
  assert.equal(live.decisionAt, '2026-09-28T13:34:19.500+08:00');
  const after = emotionCoreReading(f, null, [], ss, live);
  assert.ok(after.tape);
  assert.equal(after.observedAt, '2026-09-28T13:34:19.500+08:00');
  const fixed = buildCoreEvidence({
    facts: f,
    tracking: packet,
    decisionMode: 'FIXED',
    now: received,
  });
  const before = emotionCoreReading(f, null, [], ss, fixed);
  assert.equal(before.tape, null);
  assert.equal(
    f.retrievedAt,
    '2026-09-28T13:34:08+08:00',
    'original source time must not be rewritten',
  );
});

test('a verified live ladder alone supports a new decision without inventing missing minute evidence', () => {
  const result = buildCoreEvidence({
    facts: { ...facts('2026-09-28', '13:30'), stale: true },
    sessionEvidence: {
      date: '20260928',
      sourceState: 'LIVE',
      sessionState: 'LIVE',
    },
    decisionMode: 'LIVE',
    now: Date.parse('2026-09-28T13:34:20+08:00'),
  });
  assert.equal(result.decisionMode, 'LIVE');
  assert.equal(result.tracking, undefined);
  assert.equal(result.decisionAt, '2026-09-28T13:34:20+08:00');
});

test('a close or out-of-session view is fixed even when an earlier packet was marked LIVE', () => {
  for (const [cutoff, now] of [
    ['15:00', '15:00:00'],
    ['13:34', '18:00:00'],
  ]) {
    const result = buildCoreEvidence({
      facts: facts('2026-09-28', cutoff),
      tracking: tracking('2026-09-28', '2026-09-28T13:34:19+08:00'),
      decisionMode: 'LIVE',
      now: Date.parse(`2026-09-28T${now}+08:00`),
    });
    assert.equal(result.decisionMode, 'FIXED');
    assert.equal(result.decisionAt, `2026-09-28T${cutoff}:00+08:00`);
  }
});
