import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reboundObservation,
  buildEmotionTracking,
} from '../lib/emotion-tracking.ts';
import { emotionCoreReading } from '../lib/market-reading.ts';

const trend = (points) => ({
  code: '600001',
  name: 'sample',
  preClose: 10,
  intervalMinutes: 1,
  points: points.map(([time, price]) => ({ time, price })),
  source: 'test exact 1m',
});

test('an intact rebound interval is confirmed separately from an incomplete full-day path', () => {
  const path = trend([
    ['09:30', 10],
    ['09:31', 10],
    ['09:33', 9.5],
    ['09:34', 9.1],
    ['09:35', 9.5],
    ['09:36', 9.6],
    ['09:37', 9.7],
  ]);
  const observed = reboundObservation(path, '09:37');
  assert.equal(observed.status, 'DEGRADED');
  assert.equal(observed.eventState, 'READY');
  assert.equal(observed.eventWindow.complete, true);
  assert.equal(observed.eventWindow.start, '09:34');
  const facts = {
    date: '2026-09-24',
    previousDate: '2026-09-23',
    cutoff: '09:37',
    retrievedAt: '2026-09-24T09:37:00+08:00',
    status: 'READY',
    poolsReady: true,
    breadthReady: false,
    limitUp: 0,
    failed: 0,
    limitDown: 0,
    highestBoard: 0,
    ladders: [],
    failedStocks: [],
    limitDownStocks: [],
    breadth: {
      up: 0,
      down: 0,
      flat: 0,
      rowsAvailable: 0,
      medianChangePct: null,
    },
  };
  const result = emotionCoreReading(facts, null, [], [], {
    date: facts.date,
    cutoff: facts.cutoff,
    availableAt: facts.retrievedAt,
    sourceState: 'LIVE',
    tracking: {
      date: facts.date,
      cutoff: facts.cutoff,
      oldLeaders: {
        rows: [
          {
            code: '600001',
            name: 'sample',
            peakHeight: 6,
            brokenDate: '2026-09-23',
          },
        ],
      },
      rebounds: { rows: [{ code: '600001', name: 'sample', ...observed }] },
    },
  });
  assert.equal(result.highFeedback.antiAttempt.knownCount, 1);
});

test('a gap inside the rebound hold window remains unconfirmed', () => {
  const path = trend([
    ['09:30', 10],
    ['09:31', 10],
    ['09:33', 9.5],
    ['09:34', 9.1],
    ['09:35', 9.5],
    ['09:37', 9.7],
    ['09:38', 9.6],
  ]);
  const result = reboundObservation(path, '09:38');
  assert.equal(result.event, null);
  assert.notEqual(result.eventState, 'READY');
});

function negativeSummary(moving) {
  const stocks = [
    { code: '600001', name: 'core', height: 3, industry: 'test' },
    { code: '600002', name: 'member', height: 2, industry: 'test' },
  ];
  const previous = {
    date: '2026-09-23',
    cutoff: '15:00',
    status: 'READY',
    limitUp: 2,
    failed: 0,
    limitDown: 0,
    highestBoard: 3,
    ladders: stocks.map((s) => ({ height: s.height, stocks: [s] })),
    failedStocks: [],
    limitDownStocks: [],
  };
  const points = (offset) =>
    Array.from({ length: 31 }, (_, i) => i)
      .filter((i) => i !== 1)
      .map((i) => {
        const time = i === 30 ? '10:00' : `09:${30 + i}`;
        return [
          time,
          moving ? 10 - Math.max(0, Math.min(4, i - offset)) * 0.12 : 10,
        ];
      });
  return buildEmotionTracking(
    [previous],
    {
      '2026-09-24': {
        date: '2026-09-24',
        previousDate: '2026-09-23',
        cutoff: '10:00',
        sessionState: 'LIVE',
        sourceState: 'LIVE',
        source: 'test local window',
        quotes: {},
        trends: {
          600001: trend(points(17)),
          600002: { ...trend(points(23)), code: '600002', name: 'member' },
        },
      },
    },
    '2026-09-24',
    10,
    '10:00',
  );
}
test('negative sequence uses a complete recent interval even with an earlier unrelated gap', () => {
  const result = negativeSummary(true);
  const group = result.negativeLeadLag.rows.find(
    (g) => g.core.code === '600001',
  );
  assert.equal(group.status, 'READY');
  assert.equal(group.pathScope, 'FULL_SESSION');
  assert.equal(group.following, 1);
});
test('a complete negative comparison with no onset is a known non-event, not missing data', () => {
  const result = negativeSummary(false);
  const group = result.negativeLeadLag.rows.find(
    (g) => g.core.code === '600001',
  );
  assert.equal(group.status, 'READY');
  assert.equal(group.onset, null);
  assert.equal(group.following, 0);
});
