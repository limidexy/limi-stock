import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertPayload,
  isCompactDate,
  parseSnapshotIndex,
  snapshotUrl,
} from '../lib/rankings-source.ts';

test('索引日期倒序去重，latest 取最新', () => {
  const index = parseSnapshotIndex({
    version: 1,
    generatedAt: '2026-10-30T11:00:00.000Z',
    source: '腾讯前复权日线',
    dates: ['20261028', '20261030', '20261029', '20261030'],
  });
  assert.deepEqual(index.dates, ['20261030', '20261029', '20261028']);
  assert.equal(index.latest, '20261030');
  assert.equal(index.source, '腾讯前复权日线');
});

test('索引缺失或没有合法日期时返回 null，由调用方回退外部接口', () => {
  assert.equal(parseSnapshotIndex(null), null);
  assert.equal(parseSnapshotIndex({}), null);
  assert.equal(parseSnapshotIndex({ dates: [] }), null);
  assert.equal(parseSnapshotIndex({ dates: ['2026-10-30', 'abc', 123] }), null);
});

test('非法日期被剔除，不参与排序', () => {
  const index = parseSnapshotIndex({ dates: ['20261030', '2026-10-29', '../x'] });
  assert.deepEqual(index.dates, ['20261030']);
});

test('只接受 8 位交易日，避免拼接任意路径', () => {
  assert.equal(isCompactDate('20261030'), true);
  assert.equal(isCompactDate('2026-10-30'), false);
  assert.equal(isCompactDate('../../etc/passwd'), false);
  assert.equal(snapshotUrl('20261030'), '/rankings/20261030.json');
});

test('载荷缺窗口或缺覆盖统计时直接报错，不用默认值补齐', () => {
  assert.throws(() => assertPayload(null), /不是对象/);
  assert.throws(() => assertPayload({ coverage: {} }), /缺少目标交易日/);
  assert.throws(
    () => assertPayload({ tradeDate: '20261030' }),
    /缺少覆盖统计/,
  );
  assert.throws(
    () =>
      assertPayload({
        tradeDate: '20261030',
        coverage: {},
        windows: { '5': {}, '10': {}, '20': {} },
      }),
    /缺少 30 日窗口/,
  );
});

test('完整载荷原样返回', () => {
  const payload = {
    tradeDate: '20261030',
    coverage: { activeUniverse: 1 },
    windows: { '5': {}, '10': {}, '20': {}, '30': {} },
  };
  assert.equal(assertPayload(payload), payload);
});
