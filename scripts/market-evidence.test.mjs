import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ladderReading,
  emotionReading,
  closeComparison,
  shortEmotionReading,
  historicalEmotionLadder,
  adjacentCloses,
} from '../lib/market-reading.ts';
import {
  parseTrendPoints,
  priceLimitState,
  timelineHeadline,
  trendWindow,
} from '../lib/timeline-evidence.ts';
import {
  mergeQuoteRows,
  parseTencentLiveQuotes,
  quoteComplete,
  sameTradeDate,
} from '../lib/quote-evidence.ts';

const emotionHistory = JSON.parse(
  fs.readFileSync(
    new URL('../lib/close-history.generated.json', import.meta.url),
  ),
).snapshots;
const archivedFacts = (date) => ({
  ...structuredClone(emotionHistory.find((row) => row.date === date)),
  poolsReady: true,
  breadthReady: true,
});
const sep4 = () => archivedFacts('2026-09-04');
const sep3 = () => archivedFacts('2026-09-03');

test('Tencent live fallback accepts only the exact requested quote date', () => {
  const text = [
    'v_sh600000="1~浦发银行~600000~9.11~9.00~9.03~0~0~0~~~~~~~~~~~~~~~~~~~~~~20260928104516~0.11~1.22~9.14~9.00~9.11/586205/533479468";',
    'v_sz000001="51~平安银行~000001~11.33~11.30~11.28~0~0~0~~~~~~~~~~~~~~~~~~~~~~20260927104518~0.03~0.27~11.41~11.28~11.33/375882/426686034";',
  ].join('\n');
  const quotes = parseTencentLiveQuotes(text, ['600000', '000001'], '20260928');
  assert.equal(quotes.size, 1);
  assert.equal(quotes.get('600000').changePct, 1.22);
  assert.equal(quotes.get('600000').speedPct, null);
  assert.equal(quotes.get('600000').amount, 533479468);
  assert.equal(quotes.get('600000').quoteTime, '2026-09-28T02:45:16.000Z');
});

test('a refreshed timestamp with an explicit no-trade tuple cannot fill a missing closing return', () => {
  const fields = Array(36).fill('');
  Object.assign(fields, {
    2: '002813',
    3: '26.38',
    4: '26.38',
    5: '0',
    6: '0',
    30: '20260930150000',
    32: '0',
    33: '0',
    34: '0',
    35: '26.38/0/0',
  });
  const raw = () => `v_sz002813="${fields.join('~')}";`;
  assert.equal(parseTencentLiveQuotes(raw(), ['002813'], '20260930').size, 0);
  // A genuinely traded flat close is valid. Zero change alone is not suspension.
  Object.assign(fields, {
    5: '26.38',
    6: '100',
    33: '26.40',
    34: '26.30',
    35: '26.38/100/263800',
  });
  assert.equal(
    parseTencentLiveQuotes(raw(), ['002813'], '20260930').get('002813')
      .changePct,
    0,
  );
});

test('historical emotion uses complete exact-date close quotes without inventing returns', () => {
  const result = shortEmotionReading(sep4(), sep3());
  assert.equal(result.cohort.consecutive.advanced, 1);
  assert.equal(result.cohort.consecutive.count, 9);
  assert.equal(result.cohort.all.priceReady, 44);
  assert.equal(result.cohort.all.count, 44);
  assert.ok(result.median < 0);
  assert.equal(result.status, 'READY');
  assert.match(result.transition, /不是全面修复/);
});

function exactCloseLadder() {
  const ladder = historicalEmotionLadder(sep4(), sep3());
  const archive = JSON.parse(
    fs.readFileSync(
      new URL('../lib/archive-evidence.generated.json', import.meta.url),
    ),
  );
  ladder.retrievedAt = '2026-09-04T15:01:00+08:00';
  ladder.competitors = ladder.competitors.map((stock) => {
    const row = Object.values(archive.records).find(
      (row) => row.code === stock.code,
    );
    assert.equal(row.points.at(-1)[0], '15:00');
    return {
      ...stock,
      changePct: row.changePct,
      priceQuoteTime: '2026-09-04T15:00:00+08:00',
    };
  });
  return ladder;
}

test('all real close prices make the current-day sentiment ready without claiming strategy accuracy', () => {
  const result = shortEmotionReading(sep4(), sep3(), exactCloseLadder());
  assert.equal(result.status, 'READY');
  assert.equal(result.version, 'short-emotion-v2');
  assert.equal(result.highBoard.tone, 'negative');
  assert.match(
    result.highBoard.summary,
    /空间高位仍有强势表现，但中位已出现集中负反馈/,
  );
  assert.equal(result.relay.label, '接力退潮');
  assert.equal(result.relay.candidateCount, 9);
  assert.equal(result.cohort.consecutive.attempts, 3);
  assert.ok(Math.abs(result.relay.attemptRate - 33.33333333333333) < 1e-8);
  assert.ok(Math.abs(result.relay.sealRate - 33.33333333333333) < 1e-8);
  assert.equal(result.cohort.all.priceReady, 44);
  assert.equal(result.negative.length, 6);
  assert.equal(result.positive.length, 3);
  assert.ok(result.median < 0);
});

test('invalid supplied ladders never replace the exact adjacent-close cohort', () => {
  for (const mutate of [
    (row) => (row.fromHeight = 8),
    (row) => (row.state = 'SEALED'),
  ]) {
    const ladder = exactCloseLadder();
    mutate(ladder.competitors[0]);
    const result = shortEmotionReading(sep4(), sep3(), ladder);
    assert.equal(result.status, 'DEGRADED');
    assert.equal(result.cohortSource, '相邻收盘涨停名单逐股对照');
  }
  for (const mutate of [
    (row) => (row.previousTradeDate = '20260812'),
    (row) => (row.competitors[0].code = '999999'),
    (row) => (row.retrievedAt = '2026-09-04T14:00:00+08:00'),
  ]) {
    const ladder = exactCloseLadder();
    mutate(ladder);
    const result = shortEmotionReading(sep4(), sep3(), ladder);
    assert.equal(result.status, 'READY');
    assert.notEqual(result.cohortSource, '同日完整昨日涨停跟踪');
  }
});

test('one first-board pool race degrades low support without erasing verified high-board relay', () => {
  const ladder = exactCloseLadder();
  const firstBoard = ladder.competitors.find((row) => row.fromHeight === 1);
  assert.ok(firstBoard);
  firstBoard.state = firstBoard.state === 'SEALED' ? 'DROPPED' : 'SEALED';
  const result = shortEmotionReading(sep4(), sep3(), ladder);
  assert.equal(result.status, 'DEGRADED');
  assert.notEqual(result.highBoard.label, '高标数据不足');
  assert.notEqual(result.relay.label, '接力数据不足');
  assert.match(result.missing.join('；'), /首板池与梯队接口存在1只瞬时差异/);
});

test('a current complete live ladder survives a same-day stale emotion snapshot', () => {
  const facts = {
    ...sep4(),
    date: '2026-09-28',
    status: 'DEGRADED',
    stale: true,
    cutoff: '10:34',
    retrievedAt: '2026-09-28T10:34:00+08:00',
  };
  const previous = { ...sep3(), date: '2026-09-24' };
  const ladder = exactCloseLadder();
  ladder.tradeDate = '20260928';
  ladder.previousTradeDate = '20260924';
  ladder.sessionState = 'LIVE';
  ladder.sourceState = 'LIVE';
  ladder.retrievedAt = '2026-09-28T10:35:00+08:00';
  ladder.sealedStocks = sep4().ladders.flatMap((level) => level.stocks);
  ladder.counts.todaySealed = ladder.sealedStocks.length;
  ladder.competitors = ladder.competitors.map((row) => ({
    ...row,
    quoteTime: '2026-09-28T10:35:00+08:00',
    priceQuoteTime: '2026-09-28T10:35:00+08:00',
  }));
  const result = shortEmotionReading(facts, previous, ladder);
  assert.equal(result.status, 'DEGRADED');
  assert.equal(result.cohortSource, '同日完整昨日涨停跟踪');
  assert.equal(result.cohort.ready, true);
  assert.equal(result.relay.candidateCount, 9);
  assert.ok(result.highBoard.rows.length > 0);
  assert.notEqual(result.highBoard.label, '高标数据不足');
  assert.notEqual(result.relay.label, '接力数据不足');
  assert.match(result.missing.join('；'), /高标与接力已独立使用当前梯队证据/);
});

test('individual stale, absent or future price times cannot enter a complete return distribution', () => {
  for (const quoteTime of [
    undefined,
    '2026-09-03T15:00:00+08:00',
    '2026-09-04T14:00:00+08:00',
    '2026-09-04T15:10:00+08:00',
  ]) {
    const ladder = exactCloseLadder();
    ladder.competitors[0].priceQuoteTime = quoteTime;
    const result = shortEmotionReading(sep4(), sep3(), ladder);
    assert.equal(result.status, 'DEGRADED');
    assert.equal(result.median, null);
    assert.equal(result.cohort.all.priceReady, 43);
  }
});

test('empty pools do not create an emotional divergence or a false zero-percent promotion', () => {
  const result = shortEmotionReading({
    ...sep4(),
    limitUp: 0,
    failed: 0,
    limitDown: 0,
    highestBoard: 0,
    consecutiveCount: 0,
    ladders: [],
  });
  assert.equal(result.tone, 'unknown');
  assert.equal(result.highBoard.label, '高标数据不足');
  assert.equal(result.relay.label, '接力数据不足');
  assert.equal(result.cohort.consecutive.rate, null);
  assert.equal(result.cohort.consecutive.attemptRate, null);
  assert.equal(result.cohort.consecutive.sealRate, null);
});

test('the same sealing percentage does not override high-board contraction and failure pressure', () => {
  const result = shortEmotionReading(
    archivedFacts('2026-09-02'),
    archivedFacts('2026-09-01'),
  );
  assert.equal(result.cohort.consecutive.advanced, 6);
  assert.equal(result.cohort.consecutive.count, 18);
  assert.equal(result.tone, 'negative');
  assert.match(result.transition, /退潮压力/);
});

test('an independent 20cm five-board cannot mask the main-board relay break', () => {
  const result = shortEmotionReading(
    archivedFacts('2026-08-14'),
    archivedFacts('2026-08-13'),
  );
  assert.equal(result.highBoard.tone, 'negative');
  assert.notEqual(result.relay.tone, 'positive');
  assert.equal(result.families[0].highest, 3);
  assert.equal(result.families[1].highest, 5);
  assert.equal(result.families[1].leaders[0].name, '蓝盾光电');
});

test('highest tiers are recall evidence, not a final core threshold or confirmed leader identity', () => {
  const result = shortEmotionReading(
    archivedFacts('2026-09-18'),
    archivedFacts('2026-09-17'),
  );
  assert.equal(result.highBoard.poolFloor, null);
  assert.equal(result.highBoard.rows, result.core.activeCandidates);
  assert.equal(
    result.core.candidates.length,
    result.core.activeCandidates.length +
      result.core.historicalCandidates.length,
  );
  assert.ok(result.core.candidates.some((row) => row.historicalHeight === 5));
  assert.ok(
    result.core.candidates.some((row) => row.roles.includes('当前最高竞争者')),
  );
  assert.ok(result.core.candidates.every((row) => row.provisional));
  assert.ok(
    result.core.candidates.every(
      (row) => row.dimensions.initiative.state === 'MISSING',
    ),
  );
  assert.notEqual(result.highBoard.tone, 'positive');
});

test('independent sentiment does not change just because indices or market breadth change', () => {
  const base = sep4();
  const changed = {
    ...base,
    indices: [],
    breadthReady: false,
    breadth: {
      up: 0,
      down: 0,
      flat: 0,
      rowsAvailable: 0,
      medianChangePct: null,
    },
  };
  assert.equal(
    shortEmotionReading(base, sep3()).label,
    shortEmotionReading(changed, sep3()).label,
  );
});

test('historical gaps and future/repeated dates do not create a cycle transition or promotion denominator', () => {
  const now = archivedFacts('2026-08-21');
  assert.equal(historicalEmotionLadder(now, archivedFacts('2026-08-14')), null);
  assert.equal(historicalEmotionLadder(sep3(), sep4()), null);
  assert.equal(historicalEmotionLadder(sep4(), sep4()), null);
  assert.equal(
    adjacentCloses(archivedFacts('2026-08-31'), archivedFacts('2026-08-28')),
    true,
  );
  assert.equal(
    shortEmotionReading(now, archivedFacts('2026-08-14')).compare,
    null,
  );
});

test('missing, stale, inconsistent structure and a changed consecutive height fail closed', () => {
  for (const extra of [
    { stale: true },
    { status: 'MISSING' },
    { poolsReady: false },
    { ladders: [] },
    { highestBoard: 99 },
  ]) {
    assert.notEqual(
      shortEmotionReading({ ...sep4(), ...extra }, sep3()).status,
      'READY',
    );
    assert.equal(
      shortEmotionReading({ ...sep4(), ...extra }, sep3()).tone,
      'unknown',
    );
  }
  const inconsistent = sep4();
  inconsistent.ladders[0].stocks[0].height = 4;
  inconsistent.highestBoard = 4;
  assert.equal(historicalEmotionLadder(inconsistent, sep3()), null);
});

test('a nonsealed but rising prior leader is not classified as a losing stock', () => {
  const ladder = historicalEmotionLadder(sep4(), sep3());
  const quote = ladder.competitors.find((stock) => stock.name === '国芳集团');
  ladder.retrievedAt = '2026-09-04T15:01:00+08:00';
  quote.priceQuoteTime = '2026-09-04T15:00:00+08:00';
  quote.changePct = 3.6;
  const result = shortEmotionReading(sep4(), sep3(), ladder);
  assert.ok(result.positive.some((stock) => stock.name === '国芳集团'));
  assert.ok(!result.negative.some((stock) => stock.name === '国芳集团'));
  assert.equal(result.median, null);
});

test('another date or future intraday ladder is never imported into the selected close', () => {
  const ladder = historicalEmotionLadder(sep4(), sep3());
  const old = shortEmotionReading(
    archivedFacts('2026-09-02'),
    archivedFacts('2026-09-01'),
    ladder,
  );
  assert.notEqual(old.cohortSource, '同日完整昨日涨停跟踪');
  assert.equal(old.cohort.consecutive.count, 18);
  const live = {
    ...sep4(),
    cutoff: '10:00',
    retrievedAt: '2026-09-04T10:00:00+08:00',
  };
  const future = {
    ...ladder,
    sessionState: 'LIVE',
    retrievedAt: '2026-09-04T10:00:30+08:00',
  };
  assert.equal(shortEmotionReading(live, null, future).cohort.ready, false);
  future.retrievedAt = '2026-09-04T09:58:00+08:00';
  assert.equal(shortEmotionReading(live, null, future).cohort.ready, false);
});

test('minute event uses close, rejects another date and future points', () => {
  const points = parseTrendPoints(
    [
      '2026-09-04 09:36,10,10.1,10.2,10,0,0,0',
      '2026-09-04 09:39,10.1,10.4,10.5,10,0,0,0',
      '2026-09-04 09:40,10.4,11,11,10.4,0,0,0',
      '2026-09-03 09:39,10,20,20,10,0,0,0',
    ],
    '20260904',
  );
  const window = trendWindow(
    { code: '600001', name: '测试', preClose: 10, points },
    '09:36',
    '09:39',
  );
  assert.equal(window.price, 10.4);
  assert.ok(Math.abs(window.changePct - 4) < 1e-8);
  assert.equal(points.length, 3);
});

test('a large minute gap is not a confirmed window', () => {
  const trend = {
    code: '600001',
    name: '测试',
    preClose: 10,
    points: [{ time: '09:31', price: 10 }],
  };
  assert.equal(trendWindow(trend, '09:36', '09:39').windowChangePct, null);
});

test('near-limit prices are not sealed; actual tick-rounded prices are', () => {
  assert.equal(priceLimitState('600001', '测试', 10.97, 10), 'NONE');
  assert.equal(priceLimitState('600001', '测试', 11, 10), 'LIMIT_UP');
  assert.equal(priceLimitState('600001', '测试', 9, 10), 'LIMIT_DOWN');
  assert.equal(priceLimitState('000428', '华天酒店', 4.69, 4.26), 'LIMIT_UP');
  assert.equal(priceLimitState('301001', 'N测试', 12, 10), 'UNKNOWN');
  assert.equal(priceLimitState('688001', '*ST测试', 12, 10), 'LIMIT_UP');
  assert.equal(priceLimitState('300001', 'ST测试', 10.5, 10), 'NONE');
});

test('headline never turns a later daily limit-up into an earlier event', () => {
  const event = {
    sectorName: 'AI应用',
    kind: 'START',
    flowDelta: 10,
    drivers: [
      {
        code: '600001',
        name: '甲股份',
        role: '同窗价格确认',
        atTimeChangePct: 2,
        windowChangePct: 1,
        limitState: 'NONE',
      },
    ],
    relatedStocks: [{ code: '600001', name: '甲股份', changePct: 10 }],
  };
  assert.equal(timelineHeadline(event), 'AI应用异动拉升，甲股份+2.00%同步走强');
  event.drivers[0].atTimeChangePct = undefined;
  assert.ok(!timelineHeadline(event).includes('10.00%'));
  assert.ok(!timelineHeadline(event).includes('涨停'));
});

test('headline lists all observed sealed names, deduplicated by code', () => {
  const drivers = Array.from({ length: 7 }, (_, i) => ({
    code: String(i),
    name: `测试${i}`,
    atTimeChangePct: 10,
    windowChangePct: 0,
    limitState: 'LIMIT_UP',
    role: '同窗价格持平',
  }));
  const headline = timelineHeadline({
    sectorName: '测试板块',
    kind: 'STRONG',
    flowDelta: 10,
    drivers: [...drivers, drivers[0]],
  });
  assert.ok(
    headline.includes('测试0、测试1、测试2、测试3、测试4、测试5、测试6涨停'),
  );
});

test('opposite movement is distinct from a missing quote', () => {
  const headline = timelineHeadline({
    sectorName: '测试板块',
    kind: 'WEAKEN',
    flowDelta: -10,
    drivers: [
      {
        code: '600001',
        name: '甲股份',
        atTimeChangePct: -10,
        windowChangePct: 0,
        limitState: 'LIMIT_DOWN',
        role: '同窗价格持平',
      },
    ],
  });
  assert.ok(headline.endsWith('甲股份跌停'));
});

test('partial quote batches merge missing values without accepting stale dates', () => {
  const epoch = Date.parse('2026-09-04T15:00:00+08:00') / 1000;
  const quotes = new Map();
  mergeQuoteRows(
    quotes,
    [
      { f12: '600001', f3: -5, f22: null, f124: epoch },
      { f12: '600002', f3: 8, f22: 1, f124: epoch - 86400 },
    ],
    ['600001', '600002'],
    '20260904',
    'primary',
  );
  assert.equal(quotes.has('600002'), false);
  assert.equal(quoteComplete(quotes.get('600001')), false);
  mergeQuoteRows(
    quotes,
    [{ f12: '600001', f3: null, f22: -0.2, f124: epoch }],
    ['600001'],
    '20260904',
    'secondary',
  );
  assert.equal(quotes.get('600001').changePct, -5);
  assert.equal(quoteComplete(quotes.get('600001')), true);
});

test('archive must match the exact market date', () => {
  assert.equal(sameTradeDate('2026-09-04', '20260904'), true);
  assert.equal(sameTradeDate('20260903', '20260904'), false);
  assert.equal(sameTradeDate(undefined, '20260904'), false);
});

test('real CLOSE evidence includes all four previously missing competitor quotes', () => {
  const doc = JSON.parse(
    fs.readFileSync(
      new URL('../lib/archive-evidence.generated.json', import.meta.url),
    ),
  );
  if (doc.tradeDate !== '20260904') return;
  const rows = ['sh603150', 'sh603989', 'sz000813', 'sh600479'].map(
    (symbol) => doc.records[symbol],
  );
  assert.ok(
    rows.every(
      (row) =>
        row &&
        Number.isFinite(row.changePct) &&
        row.points.at(-1)[0] === '15:00',
    ),
  );
  assert.ok(rows[0].changePct > 0);
  assert.ok(rows.slice(1).every((row) => row.changePct < 0));
  const row = doc.records.sz000428;
  const trend = {
    ...row,
    points: row.points.map(([time, price]) => ({ time, price })),
  };
  const early = trendWindow(trend, '09:36', '09:39');
  assert.equal(
    priceLimitState(row.code, row.name, early.price, row.preClose),
    'NONE',
  );
  const sealed = trendWindow(trend, '09:58', '10:01');
  assert.equal(
    priceLimitState(row.code, row.name, sealed.price, row.preClose),
    'LIMIT_UP',
  );
});

const facts = (overrides = {}) => ({
  date: '20260904',
  cutoff: '15:00',
  status: 'READY',
  poolsReady: true,
  breadthReady: true,
  limitUp: 39,
  failed: 48,
  limitDown: 9,
  highestBoard: 5,
  breadth: {
    up: 70,
    down: 25,
    flat: 5,
    rowsAvailable: 100,
    medianChangePct: 0.5,
  },
  indices: [
    { code: '000001', name: '上证', changePct: -0.5 },
    { code: '399001', name: '深证', changePct: -1 },
    { code: '399006', name: '创业板', changePct: -1 },
  ],
  ...overrides,
});

test('index direction is independent of profitable breadth and board quality', () => {
  const reading = emotionReading(facts());
  assert.equal(reading.indexMood, '三大指数下跌');
  assert.equal(reading.broad, '多数上涨');
  assert.equal(reading.headline, '多数个股上涨，但封板分歧大');
  assert.equal(reading.sealRate, (39 / 87) * 100);
});

test('missing, stale, zero-denominator and inconsistent facts never become a confident mood', () => {
  assert.equal(emotionReading(facts({ poolsReady: false })).usable, false);
  assert.equal(emotionReading(facts({ limitUp: 0, failed: 0 })).sealRate, null);
  assert.equal(
    emotionReading(facts({ stale: true })).headline,
    '非当前实时，仅作历史观察',
  );
  assert.equal(emotionReading(facts({ indices: [] })).indexMood, '待补指数');
  assert.equal(
    emotionReading(
      facts({
        breadth: {
          up: 100,
          down: 25,
          flat: 5,
          rowsAvailable: 100,
          medianChangePct: 0.5,
        },
      }),
    ).usable,
    false,
  );
});

test('consecutive promotion excludes first boards, deduplicates stocks and preserves negatives', () => {
  const rows = [
    {
      code: '600001',
      name: '测试甲',
      fromHeight: 4,
      toHeight: 5,
      state: 'SEALED',
      changePct: 10,
      speedPct: 0,
      industry: '测试',
    },
    {
      code: '600002',
      name: '测试乙',
      fromHeight: 2,
      toHeight: 3,
      state: 'DROPPED',
      changePct: -8,
      speedPct: -0.5,
      industry: '测试',
    },
    {
      code: '600003',
      name: '测试丙',
      fromHeight: 1,
      toHeight: 2,
      state: 'SEALED',
      changePct: 10,
      speedPct: 0,
      industry: '测试',
    },
  ];
  const input = {
    status: 'READY',
    tradeDate: '20260904',
    previousTradeDate: '20260903',
    priorDateState: 'READY',
    counts: { previousLimitUp: 3 },
    competitors: [...rows, rows[0]],
  };
  const reading = ladderReading(input, '2026-09-04');
  assert.equal(reading.rows.length, 3);
  assert.equal(reading.consecutive.rate, 50);
  assert.equal(reading.first.rate, 100);
  assert.equal(reading.negative[0].name, '测试乙');
  assert.equal(ladderReading(input, '20260903').consecutive.rate, null);
  assert.equal(
    ladderReading({ ...input, counts: { previousLimitUp: 4 } }).consecutive
      .rate,
    null,
  );
  assert.equal(
    ladderReading({ ...input, sourceState: 'STALE' }).consecutive.rate,
    null,
  );
});

test('comparison never mixes intraday with close or imports a future close', () => {
  const prior = facts({ date: '20260903', limitUp: 44 });
  assert.equal(closeComparison(facts(), prior).limitUp, -5);
  assert.equal(closeComparison(facts({ cutoff: '10:30' }), prior), null);
  assert.equal(closeComparison(facts(), facts({ date: '20260905' })), null);
  assert.equal(closeComparison(facts({ poolsReady: false }), prior), null);
});

test('actual archived day reconciles ladder heights, names, pool totals and separate promotion cohorts', () => {
  const history = JSON.parse(
    fs.readFileSync(
      new URL('../lib/close-history.generated.json', import.meta.url),
    ),
  ).snapshots;
  const now = history.find((row) => row.date === '2026-09-04');
  const prior = history.find((row) => row.date === '2026-09-03');
  if (!now || !prior) return;
  const sealed = now.ladders.flatMap((level) => level.stocks);
  assert.equal(new Set(sealed.map((stock) => stock.code)).size, now.limitUp);
  assert.equal(
    Math.max(...sealed.map((stock) => stock.height)),
    now.highestBoard,
  );
  assert.deepEqual(
    sealed
      .filter((stock) => stock.height === now.highestBoard)
      .map((stock) => stock.name)
      .sort((a, b) => a.localeCompare(b)),
    [...now.leaders].sort((a, b) => a.localeCompare(b)),
  );
  const rows = prior.ladders
    .flatMap((level) => level.stocks)
    .map((stock) => ({
      ...stock,
      fromHeight: stock.height,
      toHeight: stock.height + 1,
      speedPct: null,
      state: sealed.some((row) => row.code === stock.code)
        ? 'SEALED'
        : 'DROPPED',
      changePct: null,
    }));
  const reading = ladderReading({
    status: 'READY',
    tradeDate: '20260904',
    previousTradeDate: '20260903',
    priorDateState: 'READY',
    counts: { previousLimitUp: prior.limitUp },
    competitors: rows,
  });
  assert.equal(reading.consecutive.count, prior.consecutiveCount);
  assert.equal(
    reading.consecutive.advanced + reading.first.advanced,
    now.consecutiveCount,
  );
});
