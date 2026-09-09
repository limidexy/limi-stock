import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRadarSnapshot,
  normalizeRadarRows,
  normalizeLegacyRadar,
  mergeRadarQuotes,
  selectRadarBoards,
  selectRadarDrivers,
  radarDisplay,
  radarWindow,
  windowedRadarEvents,
} from '../lib/radar-evidence.ts';

// Synthetic fixtures exercise contracts only; never exported as market snapshots.
const now = Date.parse('2026-09-04T01:33:00Z');
const stamp = (time) => new Date(time).toISOString();
const context = {
  tradeDate: '20260904',
  requestedDate: '20260904',
  phase: '上午盘',
  sessionState: 'LIVE',
  sourceState: 'LIVE',
};
const closed = { ...context, sessionState: 'CLOSED', sourceState: 'ARCHIVED' };
const member = (patch = {}) => ({
  code: '600001',
  name: '测试甲',
  changePct: 1,
  speedPct: 0.2,
  mainNetInflow: 100,
  amount: 1000,
  industry: '测试行业',
  quoteTime: stamp(now),
  ...patch,
});
const event = (patch = {}) => ({
  ...member({ code: 'BK001', name: '测试题材' }),
  direction: 'up',
  selectionBasis: 'SPEED',
  memberCount: 1,
  directionalCount: 1,
  members: [member()],
  drivers: [member()],
  memberQueriesReady: 2,
  memberQueriesRequested: 2,
  driverState: 'READY',
  driverBasis: 'test',
  missingReasons: [],
  ...patch,
});
const snapshot = (events, patch = {}) => ({
  ...context,
  dataVersion: 2,
  status: 'READY',
  retrievedAt: stamp(now),
  coverage: {},
  events,
  ...patch,
});
const raw = (patch = {}) => ({
  f12: 'BK001',
  f14: '测试题材',
  f3: 1,
  f22: 0.2,
  f62: 100,
  f6: 1000,
  f124: now / 1000,
  ...patch,
});

test('radar keeps exact-day finite quotes, rejects missing dates, future rows and duplicates', () => {
  const rows = normalizeRadarRows(
    [
      raw(),
      raw({ f62: 110 }),
      raw({ f12: 'OLD', f124: now / 1000 - 86400 }),
      raw({ f12: 'NONE', f124: undefined }),
      raw({ f12: 'FUTURE', f124: now / 1000 + 1 }),
    ],
    '20260904',
    now,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].mainNetInflow, 110);
  assert.equal(
    normalizeRadarRows([raw({ f22: '-' })], '20260904', now)[0].speedPct,
    null,
  );
});

test('daily down but positive final speed uses the daily field after close', () => {
  const boards = selectRadarBoards(
    [member({ code: 'BK001', name: '测试芯片', changePct: -3, speedPct: 0.1 })],
    false,
  );
  assert.equal(boards[0].direction, 'down');
  assert.equal(boards[0].selectionBasis, 'DAY_CHANGE');
  assert.equal(radarDisplay(event(boards[0])).displayChangePct, -3);
  assert.equal(
    selectRadarDrivers(
      [member({ changePct: -2, speedPct: 0.1 })],
      'down',
      'DAY_CHANGE',
    ).drivers.length,
    1,
  );
});

test('statistical groups are not themes and a board cannot appear on both sides', () => {
  const rows = selectRadarBoards(
    [
      member({ name: '昨日连板', code: 'BK000' }),
      member({ name: '历史新高', code: 'BK099' }),
      member({ name: '测试芯片', code: 'BK001', changePct: -3, speedPct: 0.2 }),
      member({ name: '测试医药', code: 'BK002', changePct: 2, speedPct: -0.2 }),
    ],
    true,
  );
  assert.equal(rows.length, 2);
  assert.equal(new Set(rows.map((row) => row.code)).size, 2);
});

test('downside retrieval uses price and fund ascending samples; coverage is not provider total', async () => {
  const requests = [];
  const result = await buildRadarSnapshot(
    closed,
    async (query) => {
      requests.push(query);
      if (query.fs.startsWith('m:'))
        return { total: 504, rows: [raw({ f3: -3, f22: 0.2 })] };
      return {
        total: 215,
        rows: [
          raw({ f12: '600001', f14: '测试甲', f3: -2, f22: 0.2, f62: -100 }),
        ],
      };
    },
    now,
  );
  assert.equal(result.status, 'READY');
  assert.equal(result.coverage.available, 1);
  assert.equal(result.coverage.reported, 504);
  assert.equal(result.coverage.queryRequested, 2);
  assert.equal(result.events[0].members.length, 1);
  assert.equal(result.events[0].memberCount, 215);
  assert.equal(result.events[0].drivers[0].changePct, -2);
  assert.deepEqual(
    requests
      .filter((query) => query.fs.startsWith('b:'))
      .map((query) => [query.fid, query.order]),
    [
      ['f3', 0],
      ['f62', 0],
    ],
  );
});

test('ranking failures stay identified, partial coverage is not READY', async () => {
  const result = await buildRadarSnapshot(
    context,
    async (query) => {
      if (query.fs.startsWith('m:') && query.fid === 'f22')
        throw new Error('synthetic timeout');
      return {
        total: 10,
        rows: [
          query.fs.startsWith('m:')
            ? raw()
            : raw({ f12: '600001', f14: '测试甲' }),
        ],
      };
    },
    now,
  );
  assert.equal(result.status, 'DEGRADED');
  assert.equal(result.coverage.queryReady, 2);
  assert.equal(result.coverage.queryRequested, 4);
  assert.equal(result.coverage.missingQueries.length, 2);
  assert.match(result.reason, /synthetic timeout/);
});

test('one non-quoting constituent is excluded without degrading an otherwise complete board', async () => {
  const result = await buildRadarSnapshot(
    closed,
    async (query) => ({
      total: 37,
      rows: Array.from({ length: 37 }, (_, index) =>
        query.fs.startsWith('m:')
          ? raw({
              f12: `BK${String(index).padStart(3, '0')}`,
              f14: `测试题材${index}`,
              f3: index === 36 ? '-' : index + 1,
            })
          : raw({
              f12: `60${String(index).padStart(4, '0')}`,
              f14: `测试股${index}`,
              f3: index === 36 ? '-' : index + 1,
            }),
      ),
    }),
    now,
  );
  assert.equal(result.status, 'READY');
  assert.equal(result.coverage.rowsReturned, 74);
  assert.equal(result.coverage.rowsUsable, 72);
  assert.equal(result.coverage.rowsExcluded, 2);
  assert.doesNotMatch(result.reason ?? '', /排序字段缺失/);
});

test('a ranking sample with less than 80 percent usable fields remains degraded', async () => {
  const result = await buildRadarSnapshot(
    closed,
    async (query) => ({
      total: 10,
      rows: Array.from({ length: 10 }, (_, index) =>
        query.fs.startsWith('m:')
          ? raw({
              f12: `BK${String(index).padStart(3, '0')}`,
              f14: `测试题材${index}`,
              f3: index < 7 ? index + 1 : '-',
            })
          : raw({
              f12: `60${String(index).padStart(4, '0')}`,
              f14: `测试股${index}`,
              f3: index < 7 ? index + 1 : '-',
            }),
      ),
    }),
    now,
  );
  assert.equal(result.status, 'DEGRADED');
  assert.match(result.reason, /有效排序字段覆盖不足/);
});

test('empty HTTP-success payloads cannot be READY', async () => {
  const result = await buildRadarSnapshot(
    closed,
    async () => ({ total: 504, rows: [] }),
    now,
  );
  assert.equal(result.status, 'MISSING');
  assert.equal(result.coverage.queryReady, 0);
  assert.equal(result.events.length, 0);
});

test('stale member queries propagate to event and snapshot without zero filling', async () => {
  const result = await buildRadarSnapshot(
    context,
    async (query) => ({
      total: 1,
      stale: query.fs.startsWith('b:'),
      rows: [
        query.fs.startsWith('m:')
          ? raw()
          : raw({ f12: '600001', f14: '测试甲', f62: '-' }),
      ],
    }),
    now,
  );
  assert.equal(result.sourceState, 'STALE');
  assert.equal(result.status, 'DEGRADED');
  assert.equal(result.events[0].driverState, 'DEGRADED');
  assert.equal(result.events[0].drivers[0].mainNetInflow, null);
  assert.equal(result.events[0].drivers[0].contributionPct, null);
});

test('future quotes are rejected both intraday and in an archive', async () => {
  for (const ctx of [context, closed]) {
    const result = await buildRadarSnapshot(
      ctx,
      async () => ({ total: 1, rows: [raw({ f124: now / 1000 + 3600 })] }),
      now,
    );
    assert.equal(result.status, 'MISSING');
    assert.equal(result.events.length, 0);
  }
});

const before = () =>
  event({
    quoteTime: stamp(now - 180000),
    changePct: 0,
    mainNetInflow: 10,
    members: [
      member({
        quoteTime: stamp(now - 180000),
        changePct: 0,
        mainNetInflow: 10,
      }),
    ],
  });
test('a true same-date quote window computes compounded price and net amount changes', () => {
  const result = radarWindow(before(), event(), context, now);
  assert.equal(result.windowReady, true);
  assert.equal(result.driverState, 'READY');
  assert.ok(Math.abs(result.displayChangePct - 1) < 1e-9);
  assert.equal(result.displayFlow, 90);
  const compounded = radarWindow(
    event({ ...before(), changePct: 10 }),
    event({ changePct: 11 }),
    context,
    now,
  );
  assert.ok(Math.abs(compounded.displayChangePct - 100 / 110) < 1e-9);
});

test('closed, stale, cross-date, missing price, old and future quotes never form a window', () => {
  for (const ctx of [
    closed,
    { ...context, sourceState: 'STALE' },
    { ...context, tradeDate: '20260907' },
  ])
    assert.equal(radarWindow(before(), event(), ctx, now).windowReady, false);
  for (const after of [
    event({ changePct: null }),
    event({ mainNetInflow: null }),
    event({ quoteTime: stamp(now + 1) }),
    event({ quoteTime: stamp(now - 100000) }),
  ])
    assert.equal(radarWindow(before(), after, context, now).windowReady, false);
  assert.equal(
    radarWindow(
      event({ ...before(), quoteTime: stamp(now - 600000) }),
      event(),
      context,
      now,
    ).windowReady,
    false,
  );
});

test('window confirmation cannot erase a source failure or use future member prices', () => {
  assert.equal(
    radarWindow(
      before(),
      event({
        driverState: 'DEGRADED',
        memberQueriesReady: 1,
        missingReasons: ['资金榜缺失'],
      }),
      context,
      now,
    ).driverState,
    'DEGRADED',
  );
  assert.equal(
    radarWindow(
      before(),
      event({ members: [member({ quoteTime: stamp(now + 1000) })] }),
      context,
      now,
    ).windowReady,
    false,
  );
});

test('merging ranking responses is ordered by quote time, not response order', () => {
  const newer = member({ mainNetInflow: 200 });
  const older = member({ quoteTime: stamp(now - 30000), mainNetInflow: 50 });
  assert.deepEqual(mergeRadarQuotes([newer, older]), [newer]);
  assert.deepEqual(mergeRadarQuotes([older, newer]), [newer]);
});

test('a member with a four-minute interval is not a three-minute driver', () => {
  const prior = before();
  prior.quoteTime = stamp(now - 210000);
  prior.members[0].quoteTime = stamp(now - 240000);
  assert.equal(radarWindow(prior, event(), context, now).windowReady, false);
});

test('a retained failed or expired live snapshot is explicitly degraded', () => {
  const failed = windowedRadarEvents(
    snapshot([event()], { sourceState: 'STALE' }),
    new Map(),
    now,
  );
  assert.equal(failed[0].driverState, 'DEGRADED');
  assert.match(failed[0].driverBasis, /非当前实时/);
  const old = windowedRadarEvents(snapshot([event()]), new Map(), now + 100000);
  assert.equal(old[0].driverState, 'DEGRADED');
  assert.equal(old[0].windowReady, false);
});

test('history deduplicates repeated quote times, clears closed data and isolates trading dates', () => {
  const history = new Map();
  for (let i = 0; i < 20; i++)
    windowedRadarEvents(snapshot([event()]), history, now + 1000);
  assert.equal(history.get('20260904:BK001').length, 1);
  const result = windowedRadarEvents(snapshot([event()], closed), history, now);
  assert.equal(result[0].windowReady, false);
  assert.equal(history.size, 0);
  windowedRadarEvents(snapshot([before()]), history, now - 180000);
  windowedRadarEvents(
    snapshot([event()], { tradeDate: '20260907' }),
    history,
    now,
  );
  assert.equal(history.size, 0);
});

test('legacy archives stay degraded and discard statistical and wrong-direction groups', () => {
  const result = normalizeLegacyRadar(
    snapshot(
      [
        event({ name: '历史新高' }),
        event({ code: 'BK002', changePct: -2 }),
        event({ code: 'BK003' }),
      ],
      closed,
    ),
  );
  assert.equal(result.status, 'DEGRADED');
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].selectionBasis, 'DAY_CHANGE');
  assert.equal(result.events[0].driverState, 'DEGRADED');
});
