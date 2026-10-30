import test from 'node:test';
import assert from 'node:assert/strict';

import {
  expectedStartIso,
  verifyRankings,
} from '../lib/ranking-verification.ts';

const TRADE_DATE = '20261030';
/** 固定“当前时间”，避免运行时区与真实时钟影响生成时间门禁。 */
const NOW = new Date('2026-10-30T16:00:00+08:00');

function isoOf(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function weekdaysBetween(startIso, endIso) {
  const dates = [];
  const cursor = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${endIso}T00:00:00`);
  while (cursor <= end) {
    const weekday = cursor.getDay();
    if (weekday !== 0 && weekday !== 6) dates.push(isoOf(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

const CALENDAR = weekdaysBetween('2026-08-01', '2026-10-30');
const LAST_INDEX = CALENDAR.length - 1;

function sessionsAgo(sessions) {
  return CALENDAR[LAST_INDEX - sessions].replaceAll('-', '');
}

function makeRow(code, name, startDate, overrides = {}) {
  return {
    code,
    name,
    marketBoard: '沪主板',
    industry: '出版',
    themes: ['国企改革'],
    latestClose: 13.36,
    latestDate: TRADE_DATE,
    amount: 123012200,
    turnoverRate: 0.881,
    volumeRatio: 0.058,
    totalMarketCap: 13959701676,
    circulatingMarketCap: 13959701676,
    limitState: '未触板',
    quoteTime: '2026-10-30 15:00:00',
    startDate,
    startClose: 6,
    gainPct: 122.67,
    metadataStatus: 'READY',
    ...overrides,
  };
}

function makePayload(rowsByWindow, overrides = {}) {
  const windows = {};
  for (const key of ['5', '10', '20', '30']) {
    const rows = rowsByWindow[key] ?? [];
    windows[key] = {
      status: 'READY',
      tradeSessions: Number(key),
      eligible: 5117,
      topRequested: 30,
      topAvailable: rows.length,
      metadataReady: rows.length,
      startDate:
        overrides.declaredStart?.[key] ??
        expectedStartIso(CALENDAR, overrides.tradeDate ?? TRADE_DATE, Number(key)),
      endDate: overrides.tradeDate ?? TRADE_DATE,
      reasons: [],
      rows,
    };
  }
  return {
    status: 'READY',
    tradeDate: TRADE_DATE,
    generatedAt: '2026-10-30T15:23:13+08:00',
    source: '腾讯前复权日线 + Futu OpenD 沪深股票池/收盘元数据/题材',
    adjustment: 'QFQ',
    methodology:
      'N日涨幅=(目标日复权收盘/向前第N个交易日复权收盘-1)；要求目标日精确匹配并与Futu收盘价交叉核验。',
    coverage: {
      listedUniverse: 5257,
      activeUniverse: 5217,
      historyResponses: 5141,
      exactLatest: 5117,
      listedSnapshotExactDate: 5239,
      crosschecked: 5117,
    },
    reasons: [],
    windows,
    scoringEnabled: false,
    selectionEnabled: false,
    ...overrides.payload,
  };
}

function cleanWindows() {
  const rows = {};
  for (const key of ['5', '10', '20', '30']) {
    rows[key] = [
      makeRow('600001', '样本甲', sessionsAgo(Number(key))),
      makeRow('600002', '样本乙', sessionsAgo(Number(key))),
    ];
  }
  return rows;
}

test('起点由权威日历定位，30 个交易日前的日期可反查', () => {
  assert.equal(
    expectedStartIso(CALENDAR, TRADE_DATE, 30),
    CALENDAR[LAST_INDEX - 30],
  );
  assert.equal(
    expectedStartIso(CALENDAR, TRADE_DATE, 5),
    CALENDAR[LAST_INDEX - 5],
  );
  assert.equal(expectedStartIso(CALENDAR, '20260831', 30), null);
});

test('全部合规时保持 READY，且不排除任何行', () => {
  const view = verifyRankings(makePayload(cleanWindows()), CALENDAR, NOW);
  assert.equal(view.status, 'READY');
  for (const key of ['5', '10', '20', '30']) {
    assert.equal(view.windows[key].status, 'READY');
    assert.equal(view.windows[key].rows.length, 2);
    assert.equal(view.windows[key].excluded.length, 0);
    assert.equal(view.windows[key].reasons.length, 0);
  }
});

test('停牌导致起点被顺延的行必须排除，而不是混进 30 日榜', () => {
  const windows = cleanWindows();
  // 模拟 600825：接口用个股自身 K 线向前数 43 根，实际跨度 43 个交易日。
  windows['30'] = [
    makeRow('600825', '新华传媒', sessionsAgo(43), { gainPct: 173.77 }),
    makeRow('600001', '样本甲', sessionsAgo(30)),
    makeRow('600002', '样本乙', sessionsAgo(30)),
  ];

  const view = verifyRankings(makePayload(windows), CALENDAR, NOW);
  const window30 = view.windows['30'];

  assert.equal(window30.rows.length, 2, '只保留窗口长度正确的两行');
  assert.equal(
    window30.rows.some((row) => row.code === '600825'),
    false,
    '600825 不得出现在 30 日榜内',
  );
  assert.equal(window30.excluded.length, 1);
  assert.equal(window30.excluded[0].code, '600825');
  assert.match(window30.excluded[0].reason, /实际跨度 43 个交易日/);
  assert.equal(window30.status, 'DEGRADED');
  assert.equal(view.status, 'DEGRADED', '整体不得仍报 READY');

  // 其余窗口未受影响，仍为 READY。
  assert.equal(view.windows['5'].status, 'READY');
});

test('最新日期与目标日不符的行必须排除', () => {
  const windows = cleanWindows();
  windows['5'] = [
    makeRow('600003', '相邻日', sessionsAgo(5), { latestDate: '20261029' }),
    makeRow('600001', '样本甲', sessionsAgo(5)),
  ];

  const view = verifyRankings(makePayload(windows), CALENDAR, NOW);
  assert.equal(view.windows['5'].rows.length, 1);
  assert.equal(view.windows['5'].excluded[0].code, '600003');
  assert.match(view.windows['5'].excluded[0].reason, /与目标日 2026-10-30 不符/);
  assert.equal(view.windows['5'].status, 'DEGRADED');
});

test('接口日期落后于已知交易日时判为 MISSING，不用旧榜替代', () => {
  const payload = makePayload(cleanWindows(), { tradeDate: '20261029' });
  payload.tradeDate = '20261029';
  const view = verifyRankings(payload, CALENDAR, NOW);

  assert.equal(view.status, 'MISSING');
  assert.match(view.reasons.join(' '), /落后于已知交易日 2026-10-30/);
  // 页面据此不渲染表格，这里用状态断言代替 DOM 断言。
  assert.notEqual(view.status, 'READY');
});

test('目标日不在权威日历内时降级，不冒充 READY', () => {
  const payload = makePayload(cleanWindows());
  payload.tradeDate = '20261031'; // 周六
  const view = verifyRankings(payload, CALENDAR, NOW);

  assert.equal(view.status, 'DEGRADED');
  assert.match(view.reasons.join(' '), /不在本地权威交易日历内/);
});

test('元数据以题材为准：缺行业不降级，缺题材才降级', () => {
  const windows = cleanWindows();
  windows['5'] = [
    makeRow('600001', '样本甲', sessionsAgo(5)),
    makeRow('600004', '缺行业', sessionsAgo(5), { industry: null }),
    makeRow('600005', '缺题材', sessionsAgo(5), { themes: [] }),
  ];

  const view = verifyRankings(makePayload(windows), CALENDAR, NOW);
  const window5 = view.windows['5'];

  assert.equal(window5.rows.length, 3, '元数据缺失仍可展示，但必须降级');
  assert.equal(window5.metadataReady, 2, '缺行业不算不完整，缺题材才算');
  assert.equal(window5.status, 'DEGRADED');
  assert.match(window5.reasons.join(' '), /元数据完整 2\/3/);
});

test('题材齐全时即使行业为空也保持 READY', () => {
  const windows = cleanWindows();
  windows['10'] = [
    makeRow('600004', '缺行业甲', sessionsAgo(10), { industry: null }),
    makeRow('600006', '缺行业乙', sessionsAgo(10), { industry: null }),
  ];

  const view = verifyRankings(makePayload(windows), CALENDAR, NOW);
  assert.equal(view.windows['10'].metadataReady, 2);
  assert.equal(view.windows['10'].status, 'READY');
});

test('接口声明的区间起点与日历口径不一致时给出原因', () => {
  const windows = cleanWindows();
  const payload = makePayload(windows, {
    declaredStart: { '30': '20260824', '20': '20260921' },
  });
  const view = verifyRankings(payload, CALENDAR, NOW);

  assert.equal(view.windows['30'].status, 'DEGRADED');
  assert.match(view.windows['30'].reasons.join(' '), /不一致，页面按日历口径展示/);
  assert.equal(
    view.windows['30'].expectedStart,
    CALENDAR[LAST_INDEX - 30],
    '展示区间必须以日历为准',
  );
  assert.equal(view.windows['10'].status, 'READY');
});

test('交易日历长期未更新时提示重建，而不是继续报 READY', () => {
  const later = new Date('2026-11-05T10:00:00+08:00');
  const view = verifyRankings(makePayload(cleanWindows()), CALENDAR, later);

  assert.equal(view.status, 'DEGRADED');
  assert.match(view.reasons.join(' '), /请重建交易日历/);
});

test('接口生成时间过久时提示可能未包含最新收盘', () => {
  // 10-30 15:23 生成，到 11-01 12:00 已约 44.6 小时，超过 30 小时阈值。
  const later = new Date('2026-11-01T12:00:00+08:00');
  const view = verifyRankings(makePayload(cleanWindows()), CALENDAR, later);
  assert.match(view.reasons.join(' '), /可能尚未包含最新收盘/);
});

test('窗口全部为空时判为 MISSING，不展示空榜', () => {
  const view = verifyRankings(makePayload({}), CALENDAR, NOW);
  assert.equal(view.windows['5'].status, 'MISSING');
  assert.equal(view.status, 'DEGRADED');
  assert.match(view.windows['5'].reasons.join(' '), /没有可展示的行/);
});

test('接口声明未启用评分与选股时如实透出', () => {
  const view = verifyRankings(makePayload(cleanWindows()), CALENDAR, NOW);
  assert.equal(view.scoringDisabled, true);
});
