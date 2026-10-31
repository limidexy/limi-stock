import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isSessionTime,
  marketSymbol,
  parseMinuteBars,
  summarizeSeries,
} from '../lib/minute-series.ts';

const DATE = '2026-10-30';
const pad = (n) => String(n).padStart(2, '0');
const fmt = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/** 沪深一个完整交易日的 48 根 5 分钟时间戳。 */
function sessionTimes() {
  const times = [];
  for (let m = 9 * 60 + 35; m <= 11 * 60 + 30; m += 5) times.push(fmt(m));
  for (let m = 13 * 60 + 5; m <= 15 * 60; m += 5) times.push(fmt(m));
  return times;
}

function bars(date = DATE, times = sessionTimes()) {
  return times.map((time, index) => ({
    day: `${date} ${time}:00`,
    close: 10 + index * 0.01,
    volume: 100,
  }));
}

test('48 根完整 5 分钟价格判定为 READY', () => {
  const series = parseMinuteBars(bars(), '600519', DATE);
  assert.equal(series.bars.length, 48);
  assert.equal(series.status, 'READY');
  assert.equal(series.bars[0].time, '09:35');
  assert.equal(series.bars.at(-1).time, '15:00');
  assert.deepEqual(series.reasons, []);
});

test('缺根时按实际根数降级，不补齐', () => {
  const series = parseMinuteBars(bars(DATE, sessionTimes().slice(0, 47)), '600519', DATE);
  assert.equal(series.bars.length, 47);
  assert.equal(series.status, 'DEGRADED');
  assert.match(series.reasons.join(' '), /47\/48/);
});

test('末根不是 15:00 时降级，不假装已收盘', () => {
  const times = sessionTimes().filter((time) => time !== '15:00');
  const series = parseMinuteBars(bars(DATE, times), '600519', DATE);
  assert.equal(series.status, 'DEGRADED');
  assert.match(series.reasons.join(' '), /末根为 14:55/);
});

test('只保留目标交易日的根，不混入相邻交易日', () => {
  const mixed = [...bars('2026-10-29'), ...bars(DATE)];
  const series = parseMinuteBars(mixed, '600519', DATE);
  assert.equal(series.bars.length, 48);
  assert.equal(series.status, 'READY');
});

test('非连续竞价时段的根被剔除并降级', () => {
  const times = ['09:30', ...sessionTimes(), '11:35', '13:00'];
  const series = parseMinuteBars(bars(DATE, times), '600519', DATE);
  assert.equal(series.bars.length, 48);
  assert.equal(series.status, 'DEGRADED');
  assert.match(series.reasons.join(' '), /剔除 3 根非连续竞价时段/);
});

test('重复时间戳保留首条并降级', () => {
  const raw = bars();
  raw.push({ day: `${DATE} 10:00:00`, close: 99, volume: 1 });
  const series = parseMinuteBars(raw, '600519', DATE);
  assert.equal(series.bars.length, 48);
  const ten = series.bars.find((bar) => bar.time === '10:00');
  assert.notEqual(ten.close, 99);
  assert.match(series.reasons.join(' '), /1 个重复时间戳/);
});

test('当日没有任何根时判 MISSING，不返回空壳 READY', () => {
  const series = parseMinuteBars(bars('2026-10-29'), '600519', DATE);
  assert.equal(series.status, 'MISSING');
  assert.equal(series.bars.length, 0);
  assert.match(series.reasons.join(' '), /停牌或未上市/);
});

test('非数组或空数组判 MISSING', () => {
  assert.equal(parseMinuteBars(null, '600519', DATE).status, 'MISSING');
  assert.equal(parseMinuteBars([], '600519', DATE).status, 'MISSING');
});

test('价格非正的根被丢弃', () => {
  const raw = bars();
  raw[10] = { ...raw[10], close: 0 };
  const series = parseMinuteBars(raw, '600519', DATE);
  assert.equal(series.bars.length, 47);
  assert.equal(series.status, 'DEGRADED');
});

test('板块到行情前缀的映射', () => {
  assert.equal(marketSymbol('600519', '沪主板'), 'sh600519');
  assert.equal(marketSymbol('688111', '科创板'), 'sh688111');
  assert.equal(marketSymbol('000001', '深主板'), 'sz000001');
  assert.equal(marketSymbol('300750', '创业板'), 'sz300750');
  assert.equal(marketSymbol('920045', '北交所'), 'bj920045');
  // 板块缺失时按代码段兜底
  assert.equal(marketSymbol('601318'), 'sh601318');
  assert.equal(marketSymbol('002594'), 'sz002594');
  assert.equal(marketSymbol('830799'), 'bj830799');
});

test('时段判定排除午休与开盘前', () => {
  assert.equal(isSessionTime('09:30'), false);
  assert.equal(isSessionTime('09:35'), true);
  assert.equal(isSessionTime('11:30'), true);
  assert.equal(isSessionTime('11:35'), false);
  assert.equal(isSessionTime('13:00'), false);
  assert.equal(isSessionTime('13:05'), true);
  assert.equal(isSessionTime('15:00'), true);
  assert.equal(isSessionTime('15:05'), false);
});

test('摘要给出首末高低与总量', () => {
  const series = parseMinuteBars(bars(), '600519', DATE);
  const summary = summarizeSeries(series);
  assert.equal(summary.first, 10);
  assert.equal(summary.last, 10.47);
  assert.equal(summary.high, 10.47);
  assert.equal(summary.low, 10);
  assert.equal(summary.volume, 4800);
});
