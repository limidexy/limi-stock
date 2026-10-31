import assert from 'node:assert/strict';
import test from 'node:test';

import { excludeDelistedFromSnapshot } from '../lib/close-snapshot-filter.ts';
import { isDelistedName, splitDelisted } from '../lib/stock-universe.ts';

const stock = (code, name, height = 1, changePct = 10) => ({
  code,
  name,
  changePct,
  industry: '测试',
  height,
  firstTouch: '09:35',
  lastSeal: '14:50',
  breakCount: 0,
  sealFund: 1000,
});

function snapshot() {
  return {
    date: '2026-10-30',
    cutoff: '15:00',
    status: 'READY',
    source: '测试源',
    limitUp: 4,
    failed: 2,
    limitDown: 2,
    sealRate: (4 / 6) * 100,
    highestBoard: 3,
    consecutiveCount: 2,
    turnover: 0,
    breadth: {
      requested: 0,
      rowsAvailable: 0,
      up: 0,
      down: 0,
      flat: 0,
      medianChangePct: 0,
    },
    indexMood: '',
    shortMood: '',
    cycleNode: '',
    concentratedIndustries: [],
    leaders: [],
    indices: [],
    ladders: [
      { height: 3, stocks: [stock('000001', '三连板', 3)] },
      {
        height: 2,
        stocks: [stock('000002', '二连板', 2), stock('002731', '萃华退', 2)],
      },
      { height: 1, stocks: [stock('000003', '首板')] },
    ],
    failedStocks: [stock('000004', '炸板A', 1, 3), stock('000005', '炸板B', 1, 2)],
    limitDownStocks: [stock('000006', '跌停A', 1, -10), stock('000007', '退市海润', 1, -10)],
    coverage: { reported: 0, available: 0 },
  };
}

test('简称带「退」判为退市整理期，ST 不算', () => {
  assert.equal(isDelistedName('萃华退'), true);
  assert.equal(isDelistedName('退市海润'), true);
  assert.equal(isDelistedName('退'), true);
  assert.equal(isDelistedName('ST美克'), false);
  assert.equal(isDelistedName('*ST步森'), false);
  assert.equal(isDelistedName('贵州茅台'), false);
  assert.equal(isDelistedName(''), false);
  assert.equal(isDelistedName(' 萃华退 '), true);
});

test('splitDelisted 分开保留与剔除', () => {
  const { kept, excluded } = splitDelisted([
    { name: '贵州茅台' },
    { name: '萃华退' },
    { name: 'ST美克' },
  ]);
  assert.deepEqual(
    kept.map((row) => row.name),
    ['贵州茅台', 'ST美克'],
  );
  assert.deepEqual(
    excluded.map((row) => row.name),
    ['萃华退'],
  );
});

test('剔除退市股后梯队与三池统计量同步重算', () => {
  const before = snapshot();
  const after = excludeDelistedFromSnapshot(before);

  // 涨停 4 → 3（萃华退在 2 板梯队里）
  assert.equal(after.limitUp, 3);
  assert.equal(after.ladders.flatMap((group) => group.stocks).length, 3);
  // 跌停 2 → 1（退市海润）
  assert.equal(after.limitDown, 1);
  assert.equal(after.limitDownStocks.length, 1);
  // 炸板没有退市股，保持不变
  assert.equal(after.failed, 2);
  assert.equal(after.failedStocks.length, 2);
  // 2 板梯队只剩 1 只，仍保留该梯队
  assert.deepEqual(
    after.ladders.map((group) => [group.height, group.stocks.length]),
    [
      [3, 1],
      [2, 1],
      [1, 1],
    ],
  );
  assert.equal(after.highestBoard, 3);
  assert.equal(after.consecutiveCount, 2);
  assert.equal(after.sealRate, (3 / (3 + 2)) * 100);
  // 原始对象不被改写
  assert.equal(before.limitUp, 4);
  assert.equal(before.ladders[1].stocks.length, 2);
});

test('整层都是退市股时该梯队消失，最高板数随之下降', () => {
  const base = snapshot();
  base.ladders = [
    { height: 5, stocks: [stock('002731', '萃华退', 5)] },
    { height: 1, stocks: [stock('000003', '首板')] },
  ];
  base.highestBoard = 5;
  base.consecutiveCount = 1;
  const after = excludeDelistedFromSnapshot(base);
  assert.deepEqual(
    after.ladders.map((group) => group.height),
    [1],
  );
  assert.equal(after.highestBoard, 1);
  assert.equal(after.consecutiveCount, 0);
  assert.equal(after.limitUp, 1);
});

test('没有退市股时快照原样返回', () => {
  const base = snapshot();
  base.ladders[1].stocks = [stock('000002', '二连板', 2)];
  base.limitDownStocks = [stock('000006', '跌停A', 1, -10)];
  base.limitUp = 3;
  base.limitDown = 1;
  base.sealRate = (3 / (3 + 2)) * 100;
  const after = excludeDelistedFromSnapshot(base);
  assert.equal(after.limitUp, 3);
  assert.equal(after.limitDown, 1);
  assert.equal(after.sealRate, base.sealRate);
  assert.equal(after.ladders.length, 3);
});
