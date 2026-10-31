import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attachTenLine,
  ma10At,
  parseTencentDailySeries,
} from '../lib/daily-close-ma10.ts';

const payload = (symbol, rows) => ({
  code: 0,
  msg: '',
  data: { [symbol]: { qfqday: rows, qt: {}, prec: '10.00' } },
});

/** 生成 count 根连续交易日的日线行，收盘 = base + i。 */
const series = (symbol, count, base = 10) =>
  payload(
    symbol,
    Array.from({ length: count }, (_, i) => {
      const day = String(i + 1).padStart(2, '0');
      return [`2026-08-${day}`, '0', String(base + i), '0', '0', '0'];
    }),
  );

test('tencent daily rows are parsed with column 3 as the close, not open or high', () => {
  const parsed = parseTencentDailySeries(
    '600825',
    'sh600825',
    payload('sh600825', [
      ['2026-10-29', '10.00', '11.00', '12.00', '9.00', '100'],
      ['2026-10-30', '11.00', '13.36', '14.00', '10.50', '200'],
    ]),
  );
  assert.equal(parsed.status, 'READY');
  assert.deepEqual(parsed.points, [
    { date: '2026-10-29', close: 11 },
    { date: '2026-10-30', close: 13.36 },
  ]);
});

test('a param error or an empty series is MISSING with the reason, never a fake curve', () => {
  const failed = parseTencentDailySeries('600825', 'sh600825', {
    code: 0,
    msg: 'param error',
    data: [],
  });
  assert.equal(failed.status, 'MISSING');
  assert.deepEqual(failed.points, []);
  assert.match(failed.reasons[0], /data/);

  const empty = parseTencentDailySeries(
    '600825',
    'sh600825',
    payload('sh600825', []),
  );
  assert.equal(empty.status, 'MISSING');
  assert.match(empty.reasons[0], /没有日线行/);
});

test('ma10 needs ten real closes and never averages fewer bars', () => {
  const points = Array.from({ length: 9 }, (_, i) => ({
    date: `2026-08-${String(i + 1).padStart(2, '0')}`,
    close: 10 + i,
  }));
  // 只有 9 根：即使该日有收盘，也不能给出 10 日均值。
  assert.deepEqual(ma10At(points, '2026-08-09'), {
    close: 18,
    ma10: null,
    used: 9,
  });
  const ten = [...points, { date: '2026-08-10', close: 19 }];
  const result = ma10At(ten, '2026-08-10');
  assert.equal(result.used, 10);
  assert.equal(result.ma10, (10 + 11 + 12 + 13 + 14 + 15 + 16 + 17 + 18 + 19) / 10);
});

test('ma10 at an earlier date ignores later closes (no look-ahead)', () => {
  const points = Array.from({ length: 12 }, (_, i) => ({
    date: `2026-08-${String(i + 1).padStart(2, '0')}`,
    close: 10 + i,
  }));
  const early = ma10At(points, '2026-08-10');
  const late = ma10At(points, '2026-08-12');
  assert.equal(early.ma10, 14.5);
  assert.equal(late.ma10, 16.5);
});

test('a suspended date has no ma10 instead of borrowing the previous session', () => {
  const points = Array.from({ length: 12 }, (_, i) => ({
    date: `2026-08-${String(i + 1).padStart(2, '0')}`,
    close: 10 + i,
  }));
  const gap = ma10At(points, '2026-08-11');
  assert.equal(gap.close, 20);
  const suspended = ma10At(points, '2026-08-13');
  assert.equal(suspended.close, null);
  assert.equal(suspended.ma10, null);
});

const path = (dates) =>
  dates.map((date) => ({
    date,
    changePct: 1,
    quoteState: 'READY',
    quoteNote: null,
    height: 3,
    quoteTime: `${date}T15:00:00+08:00`,
  }));

const carrier = (code, name, dates, brokenDate = null) => ({
  code,
  name,
  brokenDate,
  peakDate: dates[0],
  peakHeight: 5,
  industry: '测试',
  path: path(dates),
});

test('attachTenLine writes the stock own ma10 into every path day and splits the reminder', () => {
  const dates = [
    '2026-10-28',
    '2026-10-29',
    '2026-10-30',
  ];
  const rows = [carrier('600825', '新华传媒', dates, '2026-10-29')];
  const parsed = parseTencentDailySeries('600825', 'sh600825', series('sh600825', 20));
  const attached = attachTenLine(rows, new Map([['600825', parsed]]), '2026-10-30');

  const today = attached.rows[0].path.at(-1);
  assert.equal(today.date, '2026-10-30');
  // 2026-08-01..2026-08-20 收盘 10..29，目标日不在序列里 -> 无收盘即无 10 日线。
  assert.equal(today.ma10, null);
  assert.match(today.ma10Note, /该日无日线收盘/);
  assert.equal(attached.tenLine.reached, false);
  assert.ok(
    attached.tenLine.items.some((item) => item.label === '口径'),
    '提醒必须拆成条目，口径单独一条',
  );
  assert.ok(
    attached.tenLine.items.some((item) => item.label === '覆盖'),
    '提醒必须拆出覆盖条目',
  );
});

test('attachTenLine marks below-ma10 with the real close and never invents a basis', () => {
  const dates = ['2026-10-29', '2026-10-30'];
  const rows = [carrier('600825', '新华传媒', dates, '2026-10-30')];
  const parsed = parseTencentDailySeries(
    '600825',
    'sh600825',
    payload('sh600825', [
      ...Array.from({ length: 9 }, (_, i) => [
        `2026-10-${String(i + 1).padStart(2, '0')}`,
        '0',
        '20',
        '0',
        '0',
        '0',
      ]),
      ['2026-10-29', '0', '20', '0', '0', '0'],
      ['2026-10-30', '0', '12', '0', '0', '0'],
    ]),
  );
  const attached = attachTenLine(rows, new Map([['600825', parsed]]), '2026-10-30');
  const today = attached.rows[0].path.at(-1);
  assert.equal(today.close, 12);
  assert.equal(today.ma10, (20 * 9 + 12) / 10);
  assert.equal(today.belowMa10, true);
  assert.equal(attached.tenLine.belowNowCount, 1);
  assert.equal(attached.tenLine.readyCount, 1);
  assert.match(attached.tenLine.note, /个股自身日线前复权收盘/);
});

test('a stock without any daily series is listed as not computed, not as not broken', () => {
  const rows = [carrier('600001', '缺数据', ['2026-10-30'], '2026-10-30')];
  const attached = attachTenLine(rows, new Map(), '2026-10-30');
  assert.equal(attached.tenLine.reached, false);
  assert.equal(attached.tenLine.missing.length, 1);
  assert.equal(attached.tenLine.missing[0].code, '600001');
  assert.match(attached.tenLine.missing[0].reason, /未请求日线收盘/);
  assert.equal(attached.rows[0].path[0].ma10, null);
});

test('ma5 uses five real closes and stays null when the stock is too new', async () => {
  const { maAt } = await import('../lib/daily-close-ma10.ts');
  const points = Array.from({ length: 6 }, (_, i) => ({
    date: `2026-09-${String(i + 1).padStart(2, '0')}`,
    close: 10 + i,
  }));
  // 09-06 收盘 15，前 5 根是 11..15，均值 13。
  assert.equal(maAt(points, '2026-09-06', 5).ma, 13);
  assert.equal(maAt(points, '2026-09-03', 5).ma, null);
  assert.equal(maAt(points, '2026-09-03', 5).used, 3);
});

test('a target-day live quote is used only when its date equals the target date', async () => {
  const { parseTencentQuotes, quoteForDate } = await import('../lib/live-quote.ts');
  const raw =
    'v_sh600838="1~上海九百~600838~12.27~13.63~12.98~1188169~630454~557715~0.00~0~0.00~0~0.00~0~0.00~0~0.00~0~12.27~68224~12.28~723~12.29~134~12.30~510~12.31~45~~20261030161456~-1.36~-9.98~13.53~12.27~";';
  const quotes = parseTencentQuotes(raw);
  const quote = quotes.get('600838');
  assert.equal(quote.price, 12.27);
  assert.equal(quote.changePct, -9.98);
  assert.equal(quote.date, '2026-10-30');
  assert.equal(quote.time, '16:14');
  // 目标日一致：可用，且 15:00 之后是收盘快照，不是实时。
  const same = quoteForDate(quote, '2026-10-30');
  assert.equal(same.price, 12.27);
  assert.equal(same.label, '收盘');
  // 目标日不一致：不许把 10-30 的快照当成 09-18 的价格。
  assert.equal(quoteForDate(quote, '2026-09-18'), null);
});
