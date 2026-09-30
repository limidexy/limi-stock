import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  emotionCoreReading,
  shortEmotionReading,
} from '../lib/market-reading.ts';

const DATE = '2026-09-28',
  NOW = `${DATE}T10:00:00+08:00`;
const stock = (code, height = 3, changePct = 10) => ({
  code,
  name: `股${code}`,
  height,
  changePct,
  industry: '测试行业',
  firstTouch: '09:40',
  breakCount: 0,
});
const facts = (ss, extra = {}) => ({
  date: DATE,
  previousDate: '2026-09-24',
  cutoff: '10:00',
  retrievedAt: NOW,
  status: 'READY',
  poolsReady: true,
  breadthReady: true,
  limitUp: ss.length,
  failed: 0,
  limitDown: 0,
  highestBoard: Math.max(0, ...ss.map((s) => s.height)),
  consecutiveCount: ss.filter((s) => s.height >= 2).length,
  ladders: [...new Set(ss.map((s) => s.height))].map((height) => ({
    height,
    stocks: ss.filter((s) => s.height === height),
  })),
  failedStocks: [],
  limitDownStocks: [],
  breadth: { up: 5, down: 5, flat: 0, rowsAvailable: 10, medianChangePct: 0 },
  ...extra,
});
const prior = (ss, extra = {}) =>
  facts(ss, {
    date: '2026-09-24',
    previousDate: '2026-09-23',
    cutoff: '15:00',
    retrievedAt: '2026-09-24T15:00:00+08:00',
    ...extra,
  });
const row = (code, fromHeight, state, changePct) => ({
  code,
  name: `股${code}`,
  fromHeight,
  toHeight: fromHeight + 1,
  state,
  changePct,
  speedPct: 0,
  industry: '测试行业',
  quoteTime: NOW,
});
const evidence = (tracking = {}, extra = {}) => ({
  date: DATE,
  cutoff: '10:00',
  availableAt: NOW,
  sourceState: 'LIVE',
  source: 'test minute capture',
  tracking: {
    date: DATE,
    cutoff: '10:00',
    availableAt: NOW,
    source: 'test minute paths',
    conceptsAvailableAt: `${DATE}T09:00:00+08:00`,
    conceptsState: 'READY',
    ...tracking,
  },
  ...extra,
});
const rebound = (code) => ({
  code,
  name: `股${code}`,
  status: 'READY',
  points: 31,
  event: {
    lowTime: '09:35',
    lowPct: -9,
    time: '09:45',
    changePct: -2,
    recoveryPp: 7,
  },
});
const group = (core, members, onset = '09:42', time = '09:48', extra = {}) => ({
  core: { code: core, name: `股${core}`, height: 3 },
  industry: '测试行业',
  status: 'READY',
  onset: { time: onset, gain: 2 },
  following: members.length,
  available: members.length + 1,
  requested: members.length + 1,
  rows: members.map((code) => ({
    code,
    name: `股${code}`,
    role: '随后响应',
    pathState: 'READY',
    time,
    lag: Number(time.slice(3)) - Number(onset.slice(3)),
  })),
  ...extra,
});
const at = (r, c) => r.candidates.find((s) => s.code === c);

test('acceptance 1: sealed space leader with broadly deep-water middle cannot be healthy', () => {
  const ss = [stock('600001', 6)];
  const before = prior([
    stock('600001', 5),
    stock('600002', 4),
    stock('600003', 4),
  ]);
  const rows = [
    row('600001', 5, 'SEALED', 10),
    row('600002', 4, 'DROPPED', -8),
    row('600003', 4, 'DROPPED', -9),
  ];
  const r = emotionCoreReading(facts(ss), before, rows, ss);
  assert.equal(r.retreatWarning, true);
  assert.equal(r.tone, 'negative');
  assert.match(r.summary, /空间高位仍有强势表现，但中位已出现集中负反馈/);
  assert.equal(r.middle.promoted, 0);
  assert.equal(r.middle.denominator, 2);
});

test('acceptance 2: a broken highest retains identity after minute rebound and verified member response', () => {
  const before = prior([stock('600001', 6)]);
  const r = emotionCoreReading(
    facts([]),
    before,
    [row('600001', 6, 'DROPPED', -2)],
    [],
    evidence({
      rebounds: { rows: [rebound('600001')] },
      concepts: { 600001: ['主线A'], 600002: ['主线A'], 600003: ['主线A'] },
      leadLag: { rows: [group('600001', ['600002', '600003'])] },
    }),
  );
  assert.ok(at(r, '600001'));
  assert.equal(at(r, '600001').dimensions.leadership.state, 'READY');
  assert.equal(r.highFeedback.antiAttempt.knownCount, 1);
  assert.equal(r.highFeedback.repairSpread.knownCount, 1);
});

test('acceptance 3: older broken core survives the display lookback and missing API', () => {
  const history = [
    prior([stock('600099', 7)], {
      date: '2026-09-01',
      previousDate: '2026-08-31',
    }),
    prior([stock('600005', 4)], {
      date: '2026-09-02',
      previousDate: '2026-09-01',
    }),
  ];
  const r = emotionCoreReading(facts([]), null, [], [], { history });
  assert.equal(at(r, '600099').state, '老高标跟踪');
  assert.notEqual(at(r, '600099').state, '影响衰减退出');
});

test('acceptance 4: low-board main-board trend capacity with verified response enters candidates', () => {
  const r = emotionCoreReading(
    facts([]),
    null,
    [],
    [],
    evidence(
      {
        concepts: { 600099: ['主线A'], 600002: ['主线A'], 600003: ['主线A'] },
        leadLag: { rows: [group('600099', ['600002', '600003'])] },
      },
      {
        speedRows: [
          {
            code: '600099',
            name: '趋势容量',
            changePct: 6,
            speedPct: 1,
            amount: 3e9,
            quoteTime: NOW,
            concepts: ['主线A'],
            metadataAsOf: `${DATE}T09:00:00+08:00`,
            metadataState: 'READY',
          },
        ],
      },
    ),
  );
  assert.ok(at(r, '600099').roles.includes('趋势容量核心候选'));
  assert.equal(at(r, '600099').height, null);
  assert.equal(at(r, '600099').dimensions.leadership.state, 'READY');
});

test('acceptance 5: isolated high board is space observation, not automatically a leader', () => {
  const ss = [stock('600001', 8)];
  const r = emotionCoreReading(facts(ss), null, [], ss);
  assert.equal(at(r, '600001').provisional, true);
  assert.equal(at(r, '600001').state, '潜在核心');
  assert.match(at(r, '600001').currentRole, /空间竞争观察/);
});

test('acceptance 6: verified same-tier leading separation and passive following have different roles', () => {
  const ss = [stock('600001', 5)];
  const before = prior([stock('600001', 4), stock('600002', 4)]);
  const r = emotionCoreReading(
    facts(ss),
    before,
    [row('600001', 4, 'SEALED', 10), row('600002', 4, 'DROPPED', 2)],
    ss,
    evidence({
      concepts: { 600001: ['A'], 600002: ['A'] },
      leadLag: { rows: [group('600001', ['600002'])] },
    }),
  );
  assert.equal(at(r, '600001').state, '分离/卡位');
  assert.match(at(r, '600002').currentRole, /被动跟随/);
  assert.notEqual(at(r, '600002').dimensions.leadership.state, 'READY');
});

test('acceptance 7: a degraded emotion endpoint with complete current ladder retains independent core identity', () => {
  const ss = [stock('600001', 4)];
  const before = prior([stock('600001', 3)]);
  const f = facts(ss, {
    stale: true,
    status: 'DEGRADED',
    cutoff: '09:50',
    retrievedAt: `${DATE}T09:50:00+08:00`,
  });
  const ladder = {
    status: 'DEGRADED',
    tradeDate: '20260928',
    previousTradeDate: '20260924',
    priorDateState: 'READY',
    sourceState: 'LIVE',
    sessionState: 'LIVE',
    retrievedAt: NOW,
    counts: { previousLimitUp: 1, todaySealed: 1 },
    sealedStocks: ss,
    competitors: [row('600001', 3, 'SEALED', 10)],
  };
  const r = shortEmotionReading(f, before, ladder);
  assert.ok(r.core.candidates.length > 0);
  assert.equal(at(r.core, '600001').dimensions.position.state, 'READY');
  assert.notEqual(at(r.core, '600001').dimensions.antiFall.state, 'READY');
});

test('acceptance 8: daily board results without minutes do not certify initiative, anti-nuclear attempt or leadership', () => {
  const ss = [stock('600001', 5)];
  const r = emotionCoreReading(facts(ss), null, [], ss);
  assert.equal(at(r, '600001').dimensions.initiative.state, 'MISSING');
  assert.equal(at(r, '600001').dimensions.leadership.state, 'MISSING');
  assert.equal(r.highFeedback.antiAttempt.value, null);
  assert.equal(r.highFeedback.repairSpread.value, null);
});

test('acceptance 9: the retained market calendar resolves the post-weekday-holiday prior session', () => {
  const calendar = JSON.parse(
    fs.readFileSync(
      new URL('../lib/trading-calendar.generated.json', import.meta.url),
      'utf8',
    ),
  );
  const previous = calendar.dates
    .filter((d) => d < '2026-09-28')
    .sort()
    .at(-1);
  assert.equal(previous, '2026-09-24');
  assert.ok(!calendar.dates.includes('2026-09-25'));
});

test('acceptance 10: code-normalized deduplication retains multiple evidence tags', () => {
  const ss = [stock('600001', 5), stock('sh600001', 5)];
  const r = emotionCoreReading(
    facts([ss[0]]),
    prior([stock('600001', 4)]),
    [],
    ss,
    evidence({
      oldLeaders: {
        rows: [
          {
            code: '600001',
            name: '股600001',
            peakHeight: 7,
            brokenDate: '2026-09-22',
          },
        ],
      },
    }),
  );
  assert.equal(r.candidates.filter((s) => s.code === '600001').length, 1);
  assert.ok(at(r, '600001').roles.length >= 2);
});

test('three falling historical proxies without current comparable scope cannot certify identity exit', () => {
  const r = emotionCoreReading(
    facts([]),
    null,
    [],
    [],
    evidence(
      {
        oldLeaders: {
          rows: [
            {
              code: '600099',
              name: '老核心',
              peakHeight: 7,
              brokenDate: '2026-09-21',
            },
          ],
        },
      },
      {
        decayObservations: ['2026-09-22', '2026-09-23', '2026-09-24'].map(
          (d, i) => ({
            code: '600099',
            date: d,
            observedAt: `${d}T15:00:00+08:00`,
            source: 'verified snapshot',
            state: 'READY',
            liquidityShare: 0.2 - i * 0.05,
            responseCount: 3 - i,
            recognitionCount: 10 - i * 2,
            coverage: 1,
          }),
        ),
      },
    ),
  );
  assert.notEqual(at(r, '600099').state, '影响衰减退出');
  assert.match(at(r, '600099').dimensions.persistence.basis, /下降不等于退出/);
});

test('negative control: responses before the rebound cannot be counted as repair propagation', () => {
  const r = emotionCoreReading(
    facts([]),
    prior([stock('600001', 6)]),
    [row('600001', 6, 'DROPPED', -2)],
    [],
    evidence({
      rebounds: { rows: [rebound('600001')] },
      concepts: { 600001: ['A'], 600002: ['A'], 600003: ['A'] },
      leadLag: {
        rows: [group('600001', ['600002', '600003'], '09:38', '09:41')],
      },
    }),
  );
  assert.equal(r.highFeedback.repairSpread.knownCount, 0);
});
