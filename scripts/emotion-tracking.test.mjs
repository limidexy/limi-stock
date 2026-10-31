import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildEmotionTracking,
  exactQuote,
  priorSession,
  reboundObservation,
  leadLagObservation,
  trackingCandidates,
} from '../lib/emotion-tracking.ts';
import { shortEmotionReading } from '../lib/market-reading.ts';

const evidence = JSON.parse(
  fs.readFileSync(
    new URL('../lib/emotion-tracking.generated.json', import.meta.url),
  ),
).dates;
const history = JSON.parse(
  fs.readFileSync(
    new URL('../lib/close-history.generated.json', import.meta.url),
  ),
).snapshots;
const facts = (d) => ({
  ...d,
  poolsReady: true,
  breadthReady: true,
  closeQuotes: evidence[d.date]?.quotes,
  previousDate: evidence[d.date]?.previousDate,
});
test('complete exact-date CLOSE packages repair historical quote coverage without changing cohort identities', () => {
  for (const [date, count] of [
    ['2026-08-31', 82],
    ['2026-09-01', 88],
    ['2026-09-02', 83],
    ['2026-09-03', 52],
    ['2026-09-04', 44],
  ]) {
    const i = history.findIndex((d) => d.date === date),
      result = shortEmotionReading(facts(history[i]), facts(history[i - 1]));
    assert.equal(result.cohort.all.count, count);
    assert.equal(result.cohort.all.priceReady, count);
    assert.equal(result.status, 'READY');
  }
  const i = history.findIndex((d) => d.date === '2026-08-28');
  assert.equal(
    shortEmotionReading(facts(history[i]), facts(history[i - 1])).status,
    'READY',
  );
  assert.equal(
    evidence['2026-08-28'].source.includes('已校验周归档CLOSE报价'),
    true,
  );
});
test('old-leader quote paths use exact-date close evidence and distinguish no-trade rows from missing quotes', () => {
  const repaired = buildEmotionTracking(history, evidence, '2026-09-08');
  assert.equal(repaired.oldLeaders.available,
    repaired.oldLeaders.rows.flatMap((stock) => stock.path).filter((day) => day.quoteState !== 'MISSING').length);
  assert.equal(
    repaired.oldLeaders.rows
      .flatMap((stock) => stock.path)
      .some((day) => day.quoteState === 'MISSING'),
    true, // Retained identities outside the old display window expose real gaps.
  );
  const latest = buildEmotionTracking(history, evidence, '2026-09-18');
  assert.equal(latest.oldLeaders.available,
    latest.oldLeaders.rows.flatMap((stock) => stock.path).filter((day) => day.quoteState !== 'MISSING').length);
  assert.ok(latest.oldLeaders.available < latest.oldLeaders.requested);
  const noTrade = latest.oldLeaders.rows
    .flatMap((stock) => stock.path.map((day) => ({ stock, day })))
    .find(({ stock, day }) => stock.code === '605577' && day.date === '2026-09-11');
  assert.equal(noTrade?.day.quoteState, 'NO_TRADE');
  assert.equal(noTrade?.day.quoteNote, '停牌');
  const suspendedDates = latest.oldLeaders.rows
    .find((stock) => stock.code === '605577')
    ?.path.filter((day) => day.quoteNote === '停牌')
    .map((day) => day.date);
  assert.deepEqual(suspendedDates, [
    '2026-09-09',
    '2026-09-10',
    '2026-09-11',
  ]);
  assert.equal(evidence['2026-09-09'].noTrade['605577'], '停牌');
});
test('exact-date 5m supplements are useful but never upgraded to 1m confirmation', () => {
  const result = reboundObservation(
    {
      code: '600000',
      name: '测试股',
      preClose: 10,
      intervalMinutes: 5,
      source: 'exact-date fixture',
      points: Array.from({ length: 48 }, (_, index) => ({
        time:
          index < 24
            ? `${String(9 + Math.floor((35 + index * 5) / 60)).padStart(2, '0')}:${String((35 + index * 5) % 60).padStart(2, '0')}`
            : `${String(13 + Math.floor((5 + (index - 24) * 5) / 60)).padStart(2, '0')}:${String((5 + (index - 24) * 5) % 60).padStart(2, '0')}`,
        price: index < 8 ? 9.4 : index < 16 ? 10 : 10.1,
      })),
    },
    '15:00',
  );
  assert.equal(result.status, 'DEGRADED');
  assert.match(result.label, /5分钟/);
  assert.match(result.reason, /不是日线倒推/);
});
test('complete exact-date 1m supplements replace shorter same-resolution paths', () => {
  const result = buildEmotionTracking(history, evidence, '2026-09-18');
  for (const code of ['001216', '603230']) {
    const row = result.rebounds.rows.find((item) => item.code === code);
    assert.equal(row?.status, 'READY');
    assert.equal(row?.points, 241);
  }
  assert.equal(result.rebounds.available, result.rebounds.rows.filter((row) => ['READY', 'NO_TRADE'].includes(row.status)).length);
  assert.ok(result.rebounds.available < result.rebounds.requested, 'old retained identities must expose missing paths, not vanish to manufacture 100% coverage');
  assert.equal(result.leadLag.available, result.leadLag.requested);
});
test('historical 5m gaps are replaced only by exact-date 1m consensus paths', () => {
  for (const date of ['2026-08-17', '2026-09-08', '2026-09-09']) {
    const trends = Object.values(evidence[date].trends);
    assert.ok(trends.length > 0);
    assert.equal(trends.every((row) => row.intervalMinutes === 1), true);
    assert.equal(trends.every((row) => row.points.length === 240), true);
    assert.equal(
      trends.every((row) => row.source.includes('精确日期1分钟分时')),
      true,
    );
  }
  assert.equal(
    evidence['2026-09-09'].trends['600865'].source,
    '通达信公共协议精确日期1分钟分时（五服务器逐分钟多数确认）',
  );
  assert.match(evidence['2026-09-08'].source, /1分钟49，5分钟0/);
  assert.equal(Object.keys(evidence['2026-09-09'].trends).length, 73);
  assert.match(evidence['2026-09-09'].source, /1分钟73，5分钟0/);
});
test('old highest-board survives its break; no future winners join prior identities', () => {
  const result = buildEmotionTracking(history, evidence, '2026-09-04');
  const old = result.oldLeaders.rows.find((x) => x.code === '002084');
  assert.equal(old.brokenDate, '2026-09-02');
  assert.equal(old.peakHeight, 7);
  assert.equal(old.path.length, 4);
  assert.ok(old.path.find((x) => x.date === '2026-09-03').changePct < 0);
  assert.equal(result.failedRepair.rows.length, 33);
  assert.equal(result.failedRepair.available, 33);
  assert.equal(new Set(result.failedRepair.rows.map((x) => x.code)).size, 33);
  assert.equal(
    result.rebounds.rows.find((x) => x.code === '002084').status,
    'MISSING',
  );
  assert.equal(result.status, 'DEGRADED');
  assert.equal(
    trackingCandidates(history, '2026-09-02').leaders.some(
      (x) => x.code === '605577',
    ),
    false,
  );
});
test('missing prior session never becomes yesterday by selecting the last known archive', () => {
  assert.equal(priorSession('2026-09-08', '2026-09-04'), false);
  // Exact-date recovery can fill real history over time. Keep this regression
  // deterministic by removing the immediately preceding session from a copy.
  const withoutPriorSession = history.filter((day) => day.date !== '2026-09-09');
  const r = buildEmotionTracking(withoutPriorSession, evidence, '2026-09-10');
  assert.equal(r.failedRepair.rows.length, 0);
});
test('close quotes require exact date and closing cutoff; live quotes accept actual seconds but reject future/stale', () => {
  const day = {
    date: '2026-09-04',
    source: 'fixture',
    quotes: {
      x: {
        changePct: 1,
        quoteTime: '2026-09-04T14:59:00+08:00',
        source: 'fixture',
      },
    },
    trends: {},
  };
  assert.equal(exactQuote(day, day.date, 'x'), null);
  day.sessionState = 'LIVE';
  day.asOf = '2026-09-04T14:59:45+08:00';
  day.quotes.x.quoteTime = '2026-09-04T14:59:30+08:00';
  assert.ok(exactQuote(day, day.date, 'x', '14:59'));
  assert.equal(
    exactQuote({ ...day, sessionState: 'CLOSED', asOf: undefined }, day.date, 'x'),
    null,
  );
  day.quotes.x.quoteTime = '2026-09-04T14:59:46+08:00';
  assert.equal(exactQuote(day, day.date, 'x', '14:59'), null);
  day.quotes.x.quoteTime = '2026-09-03T14:59:30+08:00';
  assert.equal(exactQuote(day, day.date, 'x', '14:59'), null);
});
// Pure synthetic minute fixtures never exported to the application.
const trend = (points) => ({
  code: '600001',
  name: '测试',
  preClose: 100,
  points: points.map(([time, price]) => ({ time, price })),
});
test('rebound confirmation requires consecutive recovery, respects cutoff and keeps later failure separate', () => {
  const t = trend([
    ['09:31', 94],
    ['09:32', 94],
    ['09:33', 98.1],
    ['09:34', 98],
    ['09:35', 98],
    ['09:36', 94.5],
  ]);
  assert.equal(reboundObservation(t, '09:34').event, null);
  assert.equal(reboundObservation(t, '09:35').event.time, '09:35');
  assert.equal(reboundObservation(t, '09:36').label, '拉回后再回落');
  const gap = trend([
    ['09:31', 94],
    ['09:32', 94],
    ['10:00', 99],
    ['10:01', 99],
    ['10:02', 99],
  ]);
  assert.equal(reboundObservation(gap, '10:02').event, null);
  assert.match(reboundObservation(gap, '10:02').label, /路径缺失/);
});
test('missing close endpoint, duplicate minutes and stale paths cannot claim complete evidence', () => {
  const t = trend([
    ['09:31', 99],
    ['09:32', 99],
    ['09:33', 99],
    ['09:34', 99],
    ['14:59', 99],
  ]);
  assert.equal(reboundObservation(t, '15:00').status, 'DEGRADED');
  assert.equal(
    reboundObservation({ ...t, stale: true }, '15:00').status,
    'MISSING',
  );
  assert.equal(
    reboundObservation({ ...t, points: [...t.points, t.points[0]] }, '15:00')
      .status,
    'MISSING',
  );
});
test('missing core opening path does not establish core/follower order', () => {
  const core = { code: '600001', name: '核心', height: 3, industry: '测试' };
  const follower = {
    code: '600002',
    name: '成员',
    height: 1,
    industry: '测试',
  };
  const a = trend([
    ['09:36', 100],
    ['09:37', 100],
    ['09:38', 100],
    ['09:39', 102],
    ['09:40', 102],
  ]);
  const b = trend(
    Array.from({ length: 10 }, (_, i) => [`09:${31 + i}`, i === 9 ? 102 : 100]),
  );
  const r = leadLagObservation(
    core,
    [core, follower],
    { trends: { 600001: a, 600002: b } },
    '09:40',
  );
  assert.equal(r.following, 0);
  assert.equal(r.rows[0].lag, null);
  assert.match(r.label, /不能确认先后/);
});
test('valid lead-lag keeps early, simultaneous and subsequent responses separate', () => {
  const make = (onset) =>
    trend(
      Array.from({ length: 15 }, (_, i) => [
        `09:${31 + i}`,
        i >= onset ? 102 : 100,
      ]),
    );
  const core = { code: '600001', name: '核心', height: 3, industry: '测试' };
  const members = [
    core,
    ...['600002', '600003', '600004'].map((code) => ({
      code,
      name: code,
      height: 1,
      industry: '测试',
    })),
  ];
  const r = leadLagObservation(
    core,
    members,
    {
      trends: {
        600001: make(6),
        600002: make(4),
        600003: make(6),
        600004: make(8),
      },
    },
    '09:45',
  );
  assert.deepEqual(
    r.rows.map((x) => x.role),
    ['早于核心', '同分钟', '随后响应'],
  );
  assert.equal(r.following, 1);
});

test('a leader that left the ladder across a missing session is kept with an explicit unconfirmed break', () => {
  // 2026-10-27 是交易日但归档里没有收盘快照：10-26 → 10-28 不是相邻交易日。
  // 上海九百 10-26 是当日最高板 4 板，10-28 起不在涨停池，10-30 已跌停。
  const result = buildEmotionTracking(
    history,
    evidence,
    '2026-10-30',
    10,
    '15:00',
    JSON.parse(
      fs.readFileSync(
        new URL('../lib/trading-calendar.generated.json', import.meta.url),
      ),
    ).dates,
  );
  const stock = result.oldLeaders.rows.find((x) => x.code === '600838');
  assert.ok(stock, '断板日不可确认的老高标不能被静默丢掉');
  assert.equal(stock.brokenDate, null);
  assert.match(stock.breakReason, /断板日不可确认/);
  assert.match(stock.breakReason, /2026-10-27/);
  assert.ok(result.oldLeaders.unconfirmedCount >= 1);
  // 已确认断板的仍然排在前面的位置。
  const firstUnconfirmed = result.oldLeaders.rows.findIndex(
    (x) => !x.brokenDate,
  );
  const lastConfirmed = result.oldLeaders.rows.reduce(
    (acc, x, i) => (x.brokenDate ? i : acc),
    -1,
  );
  assert.ok(firstUnconfirmed === -1 || lastConfirmed < firstUnconfirmed);
});

test('a leader still sealed on the target date is listed separately, not as broken', () => {
  const result = buildEmotionTracking(history, evidence, '2026-10-30');
  const codes = result.oldLeaders.stillSealed.map((x) => x.code);
  assert.ok(codes.includes('001219'), '青岛食品 10-30 仍是 5 板，应在“仍在板上”');
  assert.equal(
    result.oldLeaders.rows.some((x) => x.code === '001219'),
    false,
    '仍在板上的不能混进断板列表',
  );
  assert.equal(result.oldLeaders.stillSealedCount, result.oldLeaders.stillSealed.length);
});
