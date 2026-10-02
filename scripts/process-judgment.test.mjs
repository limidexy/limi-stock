import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadLocalTs } from './lib/load-local-ts.mjs';
import { shortEmotionReading } from '../lib/market-reading.ts';
import { refreshFlowObservations } from '../lib/flow-observation.ts';

// Synthetic paths test descriptions, never market effectiveness or source truth.
function curve(increments) {
  let value = 0;
  return [0, ...increments].map((delta, i) => {
    value += delta;
    return { time: `10:${String(i).padStart(2, '0')}`, mainNetInflow: value };
  });
}
function flow(points) {
  const document = {
    dates: {
      20260930: {
        flow: {
          status: 'DEGRADED',
          reported: 496,
          available: 1,
          curveRequested: 496,
          curveAvailable: 1,
          cutoff: '15:00',
          rows: [
            {
              code: 'TEST',
              name: '工程测试',
              changePct: 1,
              latestMainNetInflow: points.at(-1).mainNetInflow,
              points,
            },
          ],
        },
      },
    },
  };
  return loadLocalTs('lib/close-derived-evidence.ts', {
    [fileURLToPath(
      new URL('../lib/close-derived-evidence.generated.json', import.meta.url),
    )]: document,
  }).archivedCloseFlow('20260930').allRows[0];
}

test('flat funds do not become a turning point', () => {
  assert.match(flow(curve(Array(30).fill(0))).persistenceLabel, /无.*变化/);
});
test('one terminal print is not continuous inflow', () => {
  const result = flow(curve([...Array(29).fill(0), 3_000_000]));
  assert.equal(result.flowObservation?.state, 'SINGLE_JUMP');
});
test('a new opposite segment is an attempt, later independent segments support continuation only then', () => {
  const before = curve([...Array(25).fill(100), ...Array(5).fill(-100)]);
  assert.equal(flow(before).flowObservation?.state, 'TURN_ATTEMPT');
  const after = curve([...Array(25).fill(100), ...Array(10).fill(-100)]);
  assert.equal(flow(after).flowObservation?.state, 'TURN_CONTINUED');
  assert.equal(
    flow(before).flowObservation?.state,
    'TURN_ATTEMPT',
    'later observation must not rewrite an earlier prefix',
  );
});
test('missing minute cannot be treated as five consecutive minutes', () => {
  const points = curve(Array(30).fill(100)).filter((p) => p.time !== '10:28');
  assert.equal(flow(points).delta5m, null);
  assert.equal(flow(points).flowObservation?.state, 'INSUFFICIENT');
});

const history = JSON.parse(
  fs.readFileSync(
    new URL('../lib/close-history.generated.json', import.meta.url),
  ),
).snapshots;
const factsAt = (date) => ({
  ...structuredClone(history.find((s) => s.date === date)),
  poolsReady: true,
  breadthReady: true,
});
const { unifiedMarketReading } = loadLocalTs('lib/unified-market.ts');
function mainlineInput() {
  const row = {
    code: 'TEST',
    name: '测试方向',
    latestMainNetInflow: 100_000_000,
  };
  return {
    facts: factsAt('2026-09-30'),
    previousClose: factsAt('2026-09-29'),
    radar: { status: 'READY' },
    radarEvents: [
      {
        code: 'TEST',
        name: row.name,
        direction: 'up',
        changePct: 2,
        windowReady: true,
        driverState: 'READY',
        drivers: [
          { code: '600001', name: '测试甲' },
          { code: '600002', name: '测试乙' },
        ],
      },
    ],
    flow: {
      status: 'DEGRADED',
      tradeDate: '20260930',
      coverage: { requested: 496, available: 50 },
      series: [row],
      split: { cumulativeInflow: [row], persistentStrong: [] },
    },
  };
}
test('positive funds and two drivers support a candidate, not a confirmed mainline', () => {
  const result = unifiedMarketReading(mainlineInput());
  const mainline = result.modules.find((m) => m.id === 'mainline');
  assert.equal(mainline.judgment, 'OBSERVE');
  assert.equal(mainline.state, 'DEGRADED');
  assert.match(mainline.conclusion, /候选/);
  assert.ok(mainline.evidence.some((e) => e.includes('50/496')));
  assert.doesNotMatch(result.factChain, /完成传递/);
});
test('cross-date funds do not support the current candidate', () => {
  const input = mainlineInput();
  input.flow.tradeDate = '20260929';
  const m = unifiedMarketReading(input).modules.find(
    (r) => r.id === 'mainline',
  );
  assert.equal(m.judgment, 'OBSERVE');
  assert.ok(m.evidence.some((e) => e.includes('停用')));
});

test('short-window rebound is not same-horizon alignment with positive daily flow', () => {
  const input = mainlineInput();
  Object.assign(input.radarEvents[0], {
    selectionBasis: 'SPEED',
    displayChangePct: 0.5,
    changePct: -3,
  });
  const result = unifiedMarketReading(input);
  assert.doesNotMatch(
    result.modules.find((m) => m.id === 'mainline').conclusion,
    /价格与累计资金同向/,
  );
  assert.doesNotMatch(result.factChain, /价格与累计资金同向/);
});

test('retained weak day with a rebound is not kept in the strong list by an old cached label', () => {
  const points = curve(Array(30).fill(100)).map((p) => ({
    ...p,
    mainNetInflow: p.mainNetInflow - 10_000,
  }));
  const row = {
    code: 'TEST',
    name: '测试',
    changePct: -3,
    latestMainNetInflow: -7000,
    points,
  };
  const old = {
    status: 'DEGRADED',
    tradeDate: '20260930',
    retrievedAt: '2026-09-30T15:00:00+08:00',
    series: [row],
    split: {
      inflow: [row],
      outflow: [],
      cumulativeInflow: [],
      cumulativeOutflow: [row],
      persistentStrong: [row],
      persistentWeak: [],
      positiveCount: 8,
      negativeCount: 2,
    },
  };
  const fixed = refreshFlowObservations(old);
  assert.equal(fixed.split.persistentStrong.length, 0);
  assert.equal(fixed.split.persistentWeak.length, 1);
  assert.equal(fixed.split.positiveCount, 1);
  assert.equal(fixed.tradeDate, old.tradeDate);
  assert.equal(fixed.retrievedAt, old.retrievedAt);
  assert.equal(fixed.status, 'DEGRADED');
  assert.equal(
    old.split.persistentStrong.length,
    1,
    'do not mutate stored facts',
  );
});

test('sealed winners do not cancel deep losses on the failure side', () => {
  const r = shortEmotionReading(factsAt('2026-09-30'), factsAt('2026-09-29'));
  assert.ok(r.relay.sealRate >= 75);
  assert.equal(r.relay.tone, 'negative');
  assert.match(r.relay.label, /失败侧/);
});
test('null or malformed board process is missing, never healthy turnover', () => {
  for (const firstTouch of [null, undefined, '25:99', '12:05']) {
    const facts = factsAt('2026-09-04');
    for (const level of facts.ladders)
      for (const stock of level.stocks) {
        stock.firstTouch = firstTouch;
        stock.breakCount = 0;
      }
    const r = shortEmotionReading(facts, factsAt('2026-09-03'));
    const process = r.relay.evidence.at(-1);
    assert.equal(process.state, 'DEGRADED');
    assert.doesNotMatch(process.value, /承接经过|健康换手/);
  }
});
test('valid touch and reopening records describe sealing, not absorption of selling pressure', () => {
  const facts = factsAt('2026-09-04');
  for (const level of facts.ladders)
    for (const stock of level.stocks) {
      stock.firstTouch = '09:40';
      stock.breakCount = 3;
    }
  const r = shortEmotionReading(facts, factsAt('2026-09-03'));
  const process = r.relay.evidence.at(-1);
  assert.doesNotMatch(process.value, /换手型|承接经过/);
  assert.match(process.value, /开板/);
  assert.match(process.detail, /不能确认/);
});
