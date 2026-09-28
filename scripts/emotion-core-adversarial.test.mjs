import test from 'node:test';
import assert from 'node:assert/strict';
import { emotionCoreReading } from '../lib/market-reading.ts';

test('core audit: an ordinary first board before identity cannot manufacture an old-core second wave', () => {
  const current = [stock('600001', 3)];
  const first = {
    ...base([stock('600001', 1), stock('600002', 5)]),
    date: '2026-09-22',
    previousDate: '2026-09-21',
    cutoff: '15:00',
  };
  const second = {
    ...base([stock('600002', 6)]),
    date: '2026-09-23',
    previousDate: '2026-09-22',
    cutoff: '15:00',
  };
  const result = emotionCoreReading(base(current), null, [], current, {
    history: [first, second],
  });
  assert.ok(!at(result, '600001').roles.includes('反核/反包尝试'));
  assert.notEqual(at(result, '600001').state, '反包或二波');
});

test('core audit: a fresh exact stock quote is not displaced by a later untimestamped pool price', () => {
  const current = [stock('600001', 5)];
  const result = emotionCoreReading(
    base(current),
    null,
    [
      {
        code: '600001',
        name: '空间股',
        fromHeight: 4,
        toHeight: 5,
        state: 'SEALED',
        changePct: 9.99,
        quoteTime: '2026-09-28T09:59:45+08:00',
        speedPct: null,
        industry: '测试行业',
      },
    ],
    current,
  );
  assert.equal(at(result, '600001').quoteState, 'READY');
  assert.equal(at(result, '600001').quoteTime, '2026-09-28T09:59:45+08:00');
  assert.equal(at(result, '600001').changePct, 9.99);
});

const stock = (code, height, extra = {}) => ({
  code,
  name: `样本${code}`,
  height,
  changePct: 10,
  industry: '测试行业',
  ...extra,
});
const base = (stocks = [stock('600001', 5)]) => ({
  date: '2026-09-28',
  previousDate: '2026-09-24',
  cutoff: '10:00',
  retrievedAt: '2026-09-28T10:00:00+08:00',
  status: 'READY',
  stale: false,
  poolsReady: true,
  breadthReady: true,
  limitUp: stocks.length,
  failed: 0,
  limitDown: 0,
  highestBoard: Math.max(0, ...stocks.map((x) => x.height)),
  consecutiveCount: stocks.filter((x) => x.height >= 2).length,
  ladders: [...new Set(stocks.map((x) => x.height))].map((height) => ({
    height,
    stocks: stocks.filter((x) => x.height === height),
  })),
  failedStocks: [],
  limitDownStocks: [],
  breadth: { up: 1, down: 1, flat: 0, rowsAvailable: 2, medianChangePct: 0 },
});
const evidence = (extra = {}) => ({
  date: '2026-09-28',
  cutoff: '10:00',
  sourceState: 'LIVE',
  retrievedAt: '2026-09-28T10:00:00+08:00',
  source: 'adversarial-fixture',
  ...extra,
});
const at = (result, code) => result.candidates.find((x) => x.code === code);

test('core audit: a first-board-only market does not turn every ordinary first board into a core', () => {
  const stocks = [stock('600001', 1), stock('600002', 1)];
  const result = emotionCoreReading(base(stocks), null, [], stocks);
  assert.equal(result.candidates.length, 0);
});

test('core audit: future same-day tracking cannot backfill an earlier initiative or identity', () => {
  const stocks = [stock('600001', 5)];
  const result = emotionCoreReading(
    base(stocks),
    null,
    [],
    stocks,
    evidence({
      cutoff: '11:00',
      retrievedAt: '2026-09-28T11:00:00+08:00',
      tracking: {
        date: '2026-09-28',
        cutoff: '11:00',
        rebounds: {
          rows: [
            {
              code: '600001',
              status: 'READY',
              event: {
                lowTime: '10:10',
                lowPct: -9,
                time: '10:55',
                recoveryPp: 12,
              },
            },
          ],
        },
        oldLeaders: {
          rows: [
            {
              code: '600099',
              name: '未来才识别',
              peakHeight: 7,
              brokenDate: '2026-09-28',
              path: [],
            },
          ],
        },
      },
    }),
  );
  assert.equal(at(result, '600001').dimensions.initiative.state, 'MISSING');
  assert.equal(at(result, '600099'), undefined);
});

test('core audit: two deep-water days with missing impact and liquidity are NOT evidence of exit', () => {
  const result = emotionCoreReading(
    base([]),
    null,
    [],
    [],
    evidence({
      tracking: {
        date: '2026-09-28',
        cutoff: '10:00',
        oldLeaders: {
          rows: [
            {
              code: '600099',
              name: '老核心',
              peakHeight: 7,
              brokenDate: '2026-09-23',
              path: [
                { date: '2026-09-23', changePct: -10, quoteState: 'READY' },
                { date: '2026-09-24', changePct: -10, quoteState: 'READY' },
              ],
            },
          ],
        },
      },
    }),
  );
  const row = at(result, '600099');
  assert.ok(row, 'known broken identity must stay visible');
  assert.notEqual(row.state, '影响衰减退出');
});

test('core audit: a passive member cannot inherit another cores leadership evidence', () => {
  const stocks = [stock('600001', 5), stock('600002', 4)];
  const result = emotionCoreReading(
    base(stocks),
    null,
    [],
    stocks,
    evidence({
      tracking: {
        date: '2026-09-28',
        cutoff: '10:00',
        leadLag: {
          rows: [
            {
              core: { code: '600001', name: '先动者', height: 5 },
              status: 'READY',
              following: 1,
              industry: '测试行业',
              rows: [
                { code: '600002', name: '后动者', lag: 3, role: '随后响应' },
              ],
            },
          ],
        },
      },
    }),
  );
  const follower = at(result, '600002');
  assert.notEqual(follower.dimensions.leadership.state, 'READY');
  assert.ok(!follower.roles.includes('板块接力带动者'));
});

test('core audit: non-ready minute event cannot certify initiative', () => {
  const stocks = [stock('600001', 5)];
  const result = emotionCoreReading(
    base(stocks),
    null,
    [],
    stocks,
    evidence({
      tracking: {
        date: '2026-09-28',
        cutoff: '10:00',
        rebounds: {
          rows: [
            {
              code: '600001',
              status: 'MISSING',
              event: {
                lowTime: '09:35',
                lowPct: -9,
                time: '09:55',
                recoveryPp: 12,
              },
            },
          ],
        },
      },
    }),
  );
  assert.equal(at(result, '600001').dimensions.initiative.state, 'MISSING');
});

test('core audit: speed and a concept name alone do not create a mainline core', () => {
  const result = emotionCoreReading(
    base([]),
    null,
    [],
    [],
    evidence({
      speedRows: [
        {
          code: '600008',
          name: '普通上涨',
          changePct: 1,
          speedPct: 0.1,
          amount: 1000,
          concepts: ['普通概念'],
        },
      ],
    }),
  );
  assert.equal(at(result, '600008'), undefined);
});

test('core audit: exchange code and a non-null amount do not certify 20cm capacity', () => {
  const result = emotionCoreReading(
    base([]),
    null,
    [],
    [],
    evidence({
      speedRows: [
        {
          code: '300008',
          name: '普通20cm',
          changePct: 1,
          speedPct: 0.1,
          amount: 1000,
          concepts: [],
        },
      ],
    }),
  );
  assert.equal(at(result, '300008'), undefined);
});

test('core audit: speed scalar without a minute path leaves initiative MISSING', () => {
  const stocks = [stock('600001', 5)];
  const result = emotionCoreReading(
    base(stocks),
    null,
    [],
    stocks,
    evidence({
      speedRows: [
        {
          code: '600001',
          name: '空间股',
          changePct: 10,
          speedPct: 1,
          amount: 1e9,
          concepts: [],
        },
      ],
    }),
  );
  assert.equal(at(result, '600001').dimensions.initiative.state, 'MISSING');
});

test('core audit: reopening a board alone does not prove explosive volume', () => {
  const stocks = [stock('600001', 2, { firstTouch: '09:35', breakCount: 3 })];
  const result = emotionCoreReading(base(stocks), null, [], stocks);
  assert.notEqual(at(result, '600001').state, '爆量分歧');
});

test('core audit: yesterday highest broken today is recalled even if tracking API is absent', () => {
  const prior = stock('600099', 7);
  const previous = {
    ...base([prior]),
    date: '2026-09-24',
    cutoff: '15:00',
    retrievedAt: '2026-09-24T15:00:00+08:00',
  };
  const result = emotionCoreReading(
    base([]),
    previous,
    [
      {
        code: prior.code,
        name: prior.name,
        fromHeight: 7,
        toHeight: 8,
        state: 'DROPPED',
        changePct: -1,
        speedPct: null,
        industry: prior.industry,
        quoteTime: '2026-09-28T10:00:00+08:00',
      },
    ],
    [],
  );
  const row = at(result, '600099');
  assert.ok(row, 'a broken yesterday core must not vanish on API failure');
  assert.notEqual(row.height, 8, 'uncompleted promotion is not current height');
});

test('core audit: a stale emotion snapshot cannot certify a current stock price', () => {
  const stocks = [stock('600001', 5)];
  const facts = { ...base(stocks), stale: true, status: 'DEGRADED' };
  const result = emotionCoreReading(facts, null, [], stocks);
  assert.notEqual(at(result, '600001').quoteState, 'READY');
});

test('core audit: an ordinary failed first-board rebound is not a recognizable emotional core', () => {
  const result = emotionCoreReading(
    base([]),
    null,
    [],
    [],
    evidence({
      tracking: {
        date: '2026-09-28',
        cutoff: '10:00',
        failedRepair: {
          rows: [
            {
              code: '600008',
              name: '普通首板炸板修复',
              height: 1,
              changePct: 6,
              yesterdayChangePct: 3,
              quoteTime: '2026-09-28T10:00:00+08:00',
              quoteState: 'READY',
              label: '上涨修复（未封板）',
            },
          ],
        },
      },
    }),
  );
  assert.equal(at(result, '600008'), undefined);
});

test('core audit: unproven decay flags cannot replace timestamped liquidity and influence facts', () => {
  const result = emotionCoreReading(
    base([]),
    null,
    [],
    [],
    evidence({
      tracking: {
        date: '2026-09-28',
        cutoff: '10:00',
        oldLeaders: {
          rows: [
            {
              code: '600099',
              name: '仍需核验的老核心',
              peakHeight: 7,
              brokenDate: '2026-09-23',
              liquidityDecay: true,
              impactDecay: true,
              identityDecay: true,
              path: [
                { date: '2026-09-23', changePct: -10, quoteState: 'READY' },
                { date: '2026-09-24', changePct: -10, quoteState: 'READY' },
              ],
            },
          ],
        },
      },
    }),
  );
  assert.notEqual(at(result, '600099').state, '影响衰减退出');
});
