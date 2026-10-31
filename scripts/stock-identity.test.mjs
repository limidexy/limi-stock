import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveStockIdentity } from '../lib/stock-identity.ts';

const payload = (overrides = {}) => ({
  status: 'READY',
  date: '2026-09-11',
  oldLeaders: { rows: [] },
  failedRepair: { rows: [] },
  rebounds: { rows: [] },
  leadLag: { rows: [] },
  ...overrides,
});

test('断板老高标带出空间记忆与断板后跟踪天数', () => {
  const view = resolveStockIdentity(
    payload({
      oldLeaders: {
        rows: [
          {
            code: '002084',
            name: '海鸥住工',
            peakDate: '2026-09-01',
            peakHeight: 7,
            brokenDate: '2026-09-02',
            height: 0,
            industry: '家居用品',
            path: [
              { date: '2026-09-01' },
              { date: '2026-09-02' },
              { date: '2026-09-03' },
              { date: '2026-09-04' },
            ],
          },
        ],
      },
    }),
    '002084',
  );
  assert.equal(view.status, 'READY');
  assert.deepEqual(view.roles, ['断板老高标']);
  assert.equal(view.recognition, '历史空间记忆 7 板');
  const facts = Object.fromEntries(view.facts.map((f) => [f.label, f.value]));
  assert.equal(facts['历史空间记忆'], '7 板（2026-09-01）');
  assert.equal(facts['断板日'], '2026-09-02');
  assert.equal(facts['断板后跟踪'], '2 个归档交易日');
});

test('首板（peakHeight=1）不授予空间记忆辨识度', () => {
  const view = resolveStockIdentity(
    payload({
      oldLeaders: {
        rows: [
          {
            code: '002242',
            name: '九阳股份',
            peakDate: '2026-09-10',
            peakHeight: 1,
            brokenDate: '2026-09-11',
            path: [],
          },
        ],
      },
    }),
    '002242',
  );
  assert.equal(view.recognition, null);
  assert.deepEqual(view.roles, ['断板老高标']);
});

test('当日核心带出板高与同组响应数量', () => {
  const view = resolveStockIdentity(
    payload({
      leadLag: {
        rows: [
          {
            core: { code: '000993', name: '闽东电力', height: 2 },
            industry: '电力',
            status: 'READY',
            rows: [
              { code: '603105', name: '芯能科技', time: '09:34' },
              { code: '000722', name: '湖南发展', time: '09:37' },
            ],
          },
        ],
      },
    }),
    '000993',
  );
  assert.deepEqual(view.roles, ['当日核心']);
  // 跟踪归档的板位不是「当日板高」，不参与辨识度判定
  assert.equal(view.recognition, null);
  const facts = Object.fromEntries(view.facts.map((f) => [f.label, f.value]));
  assert.equal(facts['同组响应'], '2 只');
  assert.equal(facts['同组板块'], '电力');
  assert.equal(facts['当日板高'], undefined);
});

test('同组跟随者只记录时点，不升级为核心', () => {
  const view = resolveStockIdentity(
    payload({
      leadLag: {
        rows: [
          {
            core: { code: '000993', name: '闽东电力', height: 2 },
            industry: '电力',
            rows: [{ code: '603105', name: '芯能科技', time: '09:34', role: '核心未触发' }],
          },
        ],
      },
    }),
    '603105',
  );
  assert.deepEqual(view.roles, ['同组跟随']);
  assert.equal(view.recognition, null);
});

test('昨日炸板与盘中反核可同时出现', () => {
  const view = resolveStockIdentity(
    payload({
      failedRepair: {
        rows: [
          {
            code: '002242',
            name: '九阳股份',
            yesterdayChangePct: 4.1176,
            label: '重新涨停',
          },
        ],
      },
      rebounds: {
        rows: [
          {
            code: '002242',
            name: '九阳股份',
            status: 'READY',
            label: '深跌后拉回',
            event: { start: '10:15', end: '13:40' },
            lowPct: -6.2,
            lastPct: 5.76,
            points: 238,
          },
        ],
      },
    }),
    '002242',
  );
  assert.deepEqual(view.roles, ['昨日炸板', '盘中反核']);
  const facts = Object.fromEntries(view.facts.map((f) => [f.label, f.value]));
  assert.equal(facts['昨日涨幅'], '+4.12%');
  assert.equal(facts['当日状态'], '重新涨停');
  assert.equal(facts['分钟点数'], '238 个');
});

test('分钟路径未见深跌拉回时不给反核角色', () => {
  const view = resolveStockIdentity(
    payload({
      rebounds: {
        rows: [
          {
            code: '001219',
            name: '青岛食品',
            status: 'READY',
            label: '未见深跌拉回',
            lowPct: 9.71,
            lastPct: 9.98,
            points: 241,
          },
        ],
      },
    }),
    '001219',
  );
  assert.deepEqual(view.roles, []);
  assert.match(view.notes.join(' '), /未见深跌拉回/);
});

test('归档里没有该股时如实说明，不推断身份', () => {
  const view = resolveStockIdentity(payload(), '999999');
  assert.equal(view.status, 'READY');
  assert.deepEqual(view.roles, []);
  assert.equal(view.recognition, null);
  assert.match(view.notes.join(' '), /不作身份推断/);
});

test('归档整体 MISSING 时向下透传原因', () => {
  const view = resolveStockIdentity(
    { status: 'MISSING', reason: '该交易日没有情绪跟踪归档。' },
    '600519',
  );
  assert.equal(view.status, 'MISSING');
  assert.match(view.reasons.join(' '), /没有情绪跟踪归档/);
});

test('载荷不可用或缺交易日时判 MISSING', () => {
  assert.equal(resolveStockIdentity(null, '600519').status, 'MISSING');
  assert.equal(resolveStockIdentity({}, '600519').status, 'MISSING');
});
