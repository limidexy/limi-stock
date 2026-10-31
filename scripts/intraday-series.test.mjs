import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SESSION_MINUTES,
  parseTencentIntraday,
  summarizeIntraday,
} from '../lib/intraday-series.ts';

const SYMBOL = 'sh600519';
const CODE = '600519';
const DATE = '2026-10-30';

/** 09:30–11:30 与 13:00–15:00，各 121 个端点。 */
function sessionTimes() {
  const out = [];
  const block = (startHour, startMinute, count) => {
    let minutes = startHour * 60 + startMinute;
    for (let i = 0; i < count; i += 1) {
      const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
      const mm = String(minutes % 60).padStart(2, '0');
      out.push(`${hh}${mm}`);
      minutes += 1;
    }
  };
  block(9, 30, 121);
  block(13, 0, 121);
  return out;
}

/**
 * 造一天的腾讯 1 分钟序列。
 * 原始字段：`时间 价格 累计成交量(手) 累计成交额(元)`。
 */
function day({
  times = sessionTimes(),
  priceAt = () => 10,
  lotStep = 10,
  preClose = 9.8,
  cumulative = true,
} = {}) {
  let cumVolume = 0;
  let cumAmount = 0;
  const bars = times.map((time, index) => {
    const price = priceAt(index, time);
    const lots = lotStep;
    cumVolume = cumulative ? cumVolume + lots : lots;
    cumAmount += lots * 100 * price;
    return `${time} ${price} ${cumVolume} ${cumAmount}`;
  });
  return {
    code: 0,
    msg: '',
    data: {
      [SYMBOL]: {
        qt: {},
        mx_price: { price: [], mx: [] },
        // prec（昨收）挂在日对象上，不在股票节点上。
        data: [{ date: '20261030', prec: String(preClose), data: bars }],
      },
    },
  };
}

test('完整 242 根判为 READY，并给出当日统计', () => {
  const series = parseTencentIntraday(day(), SYMBOL, CODE, DATE);
  assert.equal(series.status, 'READY');
  assert.deepEqual(series.reasons, []);
  assert.equal(series.bars.length, SESSION_MINUTES);
  assert.equal(series.expected, SESSION_MINUTES);
  assert.equal(series.preClose, 9.8);
  assert.equal(series.code, CODE);
  assert.equal(series.date, DATE);
  assert.equal(series.bars[0].time, '0930');
  assert.equal(series.bars.at(-1).time, '1500');
  assert.ok(series.bars.some((bar) => bar.time === '1130'));
  assert.ok(series.bars.some((bar) => bar.time === '1300'));
});

test('成交量按手转股，累计值取每分钟增量', () => {
  const series = parseTencentIntraday(day({ lotStep: 7 }), SYMBOL, CODE, DATE);
  assert.equal(series.status, 'READY');
  assert.ok(series.bars.every((bar) => bar.volume === 700));
  const total = series.bars.reduce((sum, bar) => sum + bar.volume, 0);
  assert.equal(total, 700 * SESSION_MINUTES);
});

test('均价等于累计成交额除以累计成交量，不是价格的再平均', () => {
  // 价格逐分钟抬升，均价必然落后于最新价，若代码把价格再平均一次则不会出现这种滞后。
  const series = parseTencentIntraday(
    day({ priceAt: (index) => 10 + index * 0.001 }),
    SYMBOL,
    CODE,
    DATE,
  );
  assert.equal(series.status, 'READY');
  const last = series.bars.at(-1);
  assert.ok(last.avgPrice != null);
  assert.ok(last.avgPrice < last.price);
  assert.ok(Math.abs(last.avgPrice - (10 + (SESSION_MINUTES - 1) * 0.0005)) < 1e-9);

  const summary = summarizeIntraday(series);
  assert.equal(summary.first, 10);
  assert.ok(Math.abs(summary.last - (10 + 241 * 0.001)) < 1e-9);
  assert.equal(summary.high, summary.last);
  assert.equal(summary.low, 10);
  assert.ok(Math.abs(summary.changePct - ((10 + 241 * 0.001) / 9.8 - 1) * 100) < 1e-9);
});

test('累计成交量回退时该分钟记 0，不做负成交量', () => {
  const base = day();
  const rows = base.data[SYMBOL].data[0].data;
  // 第 10 根把累计成交量改小，模拟行情源修正。
  const fields = rows[10].split(' ');
  rows[10] = `${fields[0]} ${fields[1]} ${Number(fields[2]) - 50} ${fields[3]}`;
  const series = parseTencentIntraday(base, SYMBOL, CODE, DATE);
  assert.equal(series.bars[10].volume, 0);
  assert.ok(series.bars.every((bar) => bar.volume >= 0));
});

test('真实返回的 267 根（242 连续竞价 + 25 盘后固定价格）判为 READY', () => {
  // 腾讯实际返回 09:30–15:30，15:06 起是盘后固定价格交易。
  const afterHours = [];
  let minutes = 15 * 60 + 6;
  while (minutes <= 15 * 60 + 30) {
    afterHours.push(
      `${String(Math.floor(minutes / 60)).padStart(2, '0')}${String(minutes % 60).padStart(2, '0')}`,
    );
    minutes += 1;
  }
  const times = [...sessionTimes(), ...afterHours];
  const series = parseTencentIntraday(day({ times }), SYMBOL, CODE, DATE);
  assert.equal(series.status, 'READY');
  assert.deepEqual(series.reasons, []);
  assert.equal(series.bars.length, SESSION_MINUTES);
  assert.equal(series.bars.at(-1).time, '1500');
  assert.ok(!series.bars.some((bar) => bar.time > '1500'));
  assert.ok(series.notes.some((note) => note.includes('25 根盘后固定价格交易')));
  // 盘后成交不计入分时成交量合计。
  const summary = summarizeIntraday(series);
  assert.equal(summary.volume, 1000 * SESSION_MINUTES);
});

test('集合竞价根排除且不影响状态', () => {
  const times = ['0925', ...sessionTimes()];
  const series = parseTencentIntraday(day({ times }), SYMBOL, CODE, DATE);
  assert.equal(series.status, 'READY');
  assert.equal(series.bars.length, SESSION_MINUTES);
  assert.ok(series.notes.some((note) => note.includes('集合竞价')));
});

test('午休等真正的异常时段根被剔除并说明原因', () => {
  const times = ['1131', ...sessionTimes()];
  const series = parseTencentIntraday(day({ times }), SYMBOL, CODE, DATE);
  assert.equal(series.status, 'DEGRADED');
  assert.equal(series.bars.length, SESSION_MINUTES);
  assert.ok(!series.bars.some((bar) => bar.time === '1131'));
  assert.ok(series.reasons.some((reason) => reason.includes('1 根')));
});

test('时间戳重复只保留第一根', () => {
  const times = sessionTimes();
  times.push('1500');
  const series = parseTencentIntraday(day({ times }), SYMBOL, CODE, DATE);
  assert.equal(series.status, 'DEGRADED');
  assert.equal(series.bars.length, SESSION_MINUTES);
  assert.equal(series.bars.filter((bar) => bar.time === '1500').length, 1);
  assert.ok(series.reasons.some((reason) => reason.includes('时间戳重复')));
});

test('不足 242 根或最后一根不是 15:00 时判为 DEGRADED', () => {
  const short = parseTencentIntraday(
    day({ times: sessionTimes().slice(0, 200) }),
    SYMBOL,
    CODE,
    DATE,
  );
  assert.equal(short.status, 'DEGRADED');
  assert.ok(short.reasons.some((reason) => reason.includes('实际 200 根')));
  assert.ok(short.reasons.some((reason) => reason.includes('不是 15:00')));

  const noClose = parseTencentIntraday(
    day({ times: sessionTimes().slice(0, -1) }),
    SYMBOL,
    CODE,
    DATE,
  );
  assert.equal(noClose.status, 'DEGRADED');
  assert.ok(noClose.reasons.some((reason) => reason.includes('最后一根是 1459')));
});

test('目标日不在行情源保留窗口内直接报缺失，不拿别的日期顶替', () => {
  const payload = day();
  payload.data[SYMBOL].data = [
    { date: '20261028', data: [] },
    { date: '20261029', data: [] },
    { date: '20261030', data: [] },
  ];
  const series = parseTencentIntraday(payload, SYMBOL, CODE, '2026-10-23');
  assert.equal(series.status, 'MISSING');
  assert.deepEqual(series.bars, []);
  assert.ok(series.reasons[0].includes('20261023 不在其中'));
  assert.ok(series.reasons[0].includes('20261028–20261030'));
});

test('行情源没有返回序列时报缺失而不是空图', () => {
  assert.equal(parseTencentIntraday(null, SYMBOL, CODE, DATE).status, 'MISSING');
  assert.equal(
    parseTencentIntraday({ data: {} }, SYMBOL, CODE, DATE).status,
    'MISSING',
  );
  const empty = parseTencentIntraday(
    { data: { [SYMBOL]: { data: [{ date: '20261030', data: [] }] } } },
    SYMBOL,
    CODE,
    DATE,
  );
  assert.equal(empty.status, 'MISSING');
  assert.ok(empty.reasons.some((reason) => reason.includes('没有可用的分钟成交记录')));
});

test('字段不完整的根被剔除，不做零价格占位', () => {
  const payload = day();
  const rows = payload.data[SYMBOL].data[0].data;
  rows[5] = '0935';
  rows[6] = '0936 0 100 1000';
  const series = parseTencentIntraday(payload, SYMBOL, CODE, DATE);
  assert.equal(series.status, 'DEGRADED');
  assert.ok(!series.bars.some((bar) => bar.time === '0935'));
  assert.ok(series.bars.every((bar) => bar.price > 0));
  assert.ok(series.reasons.some((reason) => reason.includes('字段不完整')));
});

test('空序列时 summarizeIntraday 返回 null', () => {
  assert.equal(
    summarizeIntraday({
      status: 'MISSING',
      code: CODE,
      date: DATE,
      preClose: null,
      bars: [],
      expected: SESSION_MINUTES,
      source: '腾讯 1 分钟 K 线',
      reasons: [],
    }),
    null,
  );
});
