import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveCloseIdentity } from '../lib/close-identity.ts';

const snapshot = (overrides = {}) => ({
  date: '2026-10-30',
  highestBoard: 5,
  limitUp: 47,
  ladders: [
    {
      height: 5,
      stocks: [
        {
          code: '001219',
          name: '青岛食品',
          firstTouch: '09:30',
          lastSeal: '13:00',
          breakCount: 3,
          sealFund: 57075239,
          industry: '休闲食品',
        },
      ],
    },
    {
      height: 3,
      stocks: [{ code: '300949', name: '奥雅股份', firstTouch: '10:02' }],
    },
  ],
  ...overrides,
});

test('最高板个股带出空间位置与封板细节', () => {
  const view = resolveCloseIdentity(snapshot(), '001219');
  assert.equal(view.status, 'READY');
  assert.equal(view.height, 5);
  assert.equal(view.isHighest, true);
  assert.equal(view.highestBoard, 5);
  assert.equal(view.firstTouch, '09:30');
  assert.equal(view.lastSeal, '13:00');
  assert.equal(view.breakCount, 3);
  assert.equal(view.sealFund, 57075239);
  assert.equal(view.industry, '休闲食品');
  assert.equal(view.limitUpTotal, 47);
});

test('非最高板不标记为最高板', () => {
  const view = resolveCloseIdentity(snapshot(), '300949');
  assert.equal(view.height, 3);
  assert.equal(view.isHighest, false);
});

test('只有 1 板时不算最高板空间位', () => {
  const view = resolveCloseIdentity(
    snapshot({
      highestBoard: 1,
      ladders: [{ height: 1, stocks: [{ code: '600519', name: '贵州茅台' }] }],
    }),
    '600519',
  );
  assert.equal(view.height, 1);
  assert.equal(view.isHighest, false);
});

test('不在涨停梯队时如实说明，不补板高', () => {
  const view = resolveCloseIdentity(snapshot(), '600519');
  assert.equal(view.status, 'READY');
  assert.equal(view.height, null);
  assert.equal(view.isHighest, false);
  assert.match(view.reasons.join(' '), /没有该股/);
});

test('没有该交易日归档时判 MISSING', () => {
  const view = resolveCloseIdentity(null, '001219');
  assert.equal(view.status, 'MISSING');
  assert.match(view.reasons.join(' '), /没有收盘归档/);
});

test('归档缺日期时判 MISSING', () => {
  assert.equal(resolveCloseIdentity({}, '001219').status, 'MISSING');
});
