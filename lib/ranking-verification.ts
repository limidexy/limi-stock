/**
 * 多窗口涨幅排行的数据校验层。
 *
 * 纯函数、无 React 依赖、不引入任何 JSON，便于单元测试。
 * 校验口径（不得擅自更改）：
 *   N 日涨幅 = 目标日复权收盘 ÷ 向前第 N 个交易日复权收盘 − 1
 * 「向前第 N 个交易日」一律以权威交易日历定位，不按自然日、不按个股自身 K 线根数。
 */

export type DataState = 'READY' | 'DEGRADED' | 'MISSING';
export type WindowKey = '5' | '10' | '20' | '30';

export type RankingRow = {
  code: string;
  name: string;
  marketBoard: string;
  industry: string | null;
  themes: string[];
  latestClose: number;
  latestDate: string;
  amount: number | null;
  turnoverRate: number | null;
  volumeRatio: number | null;
  totalMarketCap: number | null;
  circulatingMarketCap: number | null;
  limitState: string;
  quoteTime: string | null;
  startDate: string;
  startClose: number;
  gainPct: number;
  metadataStatus: DataState;
};

export type RankingWindow = {
  status: DataState;
  tradeSessions: number;
  eligible: number;
  topRequested: number;
  topAvailable: number;
  metadataReady: number;
  startDate: string | null;
  endDate: string;
  reasons: string[];
  rows: RankingRow[];
};

export type RankingCoverage = {
  listedUniverse: number;
  activeUniverse: number;
  historyResponses: number;
  exactLatest: number;
  listedSnapshotExactDate: number;
  crosschecked: number;
};

export type RankingPayload = {
  status: DataState;
  tradeDate: string;
  generatedAt: string;
  source: string;
  adjustment: string;
  methodology: string;
  coverage: RankingCoverage;
  reasons: string[];
  windows: Record<WindowKey, RankingWindow>;
  scoringEnabled?: boolean;
  selectionEnabled?: boolean;
};

export type Exclusion = {
  code: string;
  name: string;
  reason: string;
};

export type WindowView = {
  key: WindowKey;
  sessions: number;
  declaredStatus: DataState;
  status: DataState;
  eligible: number;
  topRequested: number;
  topAvailable: number;
  metadataReady: number;
  expectedStart: string | null;
  endDate: string;
  declaredStart: string | null;
  reasons: string[];
  rows: RankingRow[];
  excluded: Exclusion[];
};

export type BoardView = {
  status: DataState;
  tradeDate: string;
  generatedAt: string;
  ageHours: number | null;
  source: string;
  adjustment: string;
  methodology: string;
  coverage: RankingCoverage;
  reasons: string[];
  windows: Record<WindowKey, WindowView>;
  scoringDisabled: boolean;
};

export const WINDOW_KEYS: WindowKey[] = ['5', '10', '20', '30'];

/** 日历距今超过该工作日数，即无法确认它仍是最新交易日，需要降级提示。 */
export const CALENDAR_STALE_WEEKDAYS = 1;
/** 生成时间超过该小时数时提示数据可能尚未包含最新收盘。 */
export const GENERATED_AGE_WARN_HOURS = 30;

export function compactToIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const compact = value.replaceAll('-', '');
  if (!/^\d{8}$/.test(compact)) return null;
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6)}`;
}

export function formatDate(value: string | null | undefined) {
  const iso = compactToIso(value);
  if (iso) return iso;
  return value && value.length ? value : '—';
}

export function formatAge(hours: number | null) {
  if (hours == null || !Number.isFinite(hours)) return '时间未知';
  if (hours < 1) return '1 小时内';
  if (hours < 48) return `${hours.toFixed(1)} 小时前`;
  return `${(hours / 24).toFixed(1)} 天前`;
}

function todayIso(now: Date) {
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 统计 (start, end] 内的周一至周五数量，用于判断日历是否已落后。 */
function countWeekdaysAfter(startIso: string, endIso: string) {
  if (!startIso || endIso <= startIso) return 0;
  const cursor = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${endIso}T00:00:00`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) return 0;
  let count = 0;
  let guard = 0;
  while (cursor < end && guard < 400) {
    cursor.setDate(cursor.getDate() + 1);
    const weekday = cursor.getDay();
    if (weekday !== 0 && weekday !== 6) count += 1;
    guard += 1;
  }
  return count;
}

function calendarIndex(
  calendar: string[],
  compactDate: string | null | undefined,
) {
  const iso = compactToIso(compactDate);
  if (!iso) return -1;
  return calendar.indexOf(iso);
}

/** 以目标日为锚点，取权威日历上「向前第 N 个交易日」的日期。 */
export function expectedStartIso(
  calendar: string[],
  tradeDate: string,
  sessions: number,
) {
  const index = calendarIndex(calendar, tradeDate);
  if (index < 0) return null;
  const target = index - sessions;
  return target >= 0 ? calendar[target] : null;
}

/** 两个日历日期之间相隔多少个交易日，仅用于生成排除原因。 */
function sessionSpan(calendar: string[], startIso: string, endIso: string) {
  const start = calendar.indexOf(startIso);
  const end = calendar.indexOf(endIso);
  if (start < 0 || end < 0 || end < start) return null;
  return end - start;
}

/**
 * 元数据是否完整：以题材为准。
 * 行业与板态属于补充信息，缺失不单独判定为不完整，避免整榜无谓降级。
 */
export function isMetadataComplete(row: RankingRow) {
  return Array.isArray(row.themes) && row.themes.length > 0;
}

export function verifyRankings(
  payload: RankingPayload,
  calendar: string[],
  now: Date,
): BoardView {
  const reasons: string[] = [...(payload.reasons ?? [])];
  const tradeIso = compactToIso(payload.tradeDate);
  const calendarLastIso = calendar[calendar.length - 1] ?? '';
  let status: DataState = payload.status ?? 'DEGRADED';

  // 门禁一：目标交易日必须被权威日历确认，且不得落后于已知交易日。
  if (!tradeIso) {
    status = 'MISSING';
    reasons.push('接口未返回可解析的目标交易日，无法确认排行所属日期。');
  } else if (calendarIndex(calendar, payload.tradeDate) < 0) {
    if (status !== 'MISSING') status = 'DEGRADED';
    reasons.push(
      `目标交易日 ${tradeIso} 不在本地权威交易日历内，无法交叉核验该日期。`,
    );
  } else if (calendarLastIso && tradeIso < calendarLastIso) {
    // 已知存在更晚的交易日：不得用旧榜冒充最新榜。
    status = 'MISSING';
    reasons.push(
      `接口最新交易日 ${tradeIso} 落后于已知交易日 ${calendarLastIso}，不以旧榜替代。`,
    );
  } else if (calendarLastIso && tradeIso > calendarLastIso) {
    if (status !== 'MISSING') status = 'DEGRADED';
    reasons.push(
      `交易日历止于 ${calendarLastIso}，无法确认 ${tradeIso} 为有效交易日。`,
    );
  } else if (calendarLastIso) {
    const lag = countWeekdaysAfter(calendarLastIso, todayIso(now));
    if (lag > CALENDAR_STALE_WEEKDAYS) {
      if (status !== 'MISSING') status = 'DEGRADED';
      reasons.push(
        `交易日历止于 ${calendarLastIso}，此后已有 ${lag} 个工作日，无法确认它仍是最新交易日；请重建交易日历。`,
      );
    }
  }

  // 门禁二：逐窗口校验「向前第 N 个交易日」，并重算元数据覆盖。
  const windows = {} as Record<WindowKey, WindowView>;
  let anyWindowDegraded = false;
  let anyWindowMissing = false;

  for (const key of WINDOW_KEYS) {
    const declared = payload.windows?.[key];
    const sessions = Number(key);

    if (!declared) {
      windows[key] = {
        key,
        sessions,
        declaredStatus: 'MISSING',
        status: 'MISSING',
        eligible: 0,
        topRequested: 30,
        topAvailable: 0,
        metadataReady: 0,
        expectedStart: null,
        endDate: payload.tradeDate,
        declaredStart: null,
        reasons: [`接口未返回 ${key} 日窗口。`],
        rows: [],
        excluded: [],
      };
      anyWindowMissing = true;
      continue;
    }

    const windowReasons: string[] = [...(declared.reasons ?? [])];
    const expectedStart = expectedStartIso(calendar, payload.tradeDate, sessions);
    const sourceRows = Array.isArray(declared.rows) ? declared.rows : [];
    const kept: RankingRow[] = [];
    const excluded: Exclusion[] = [];

    for (const row of sourceRows) {
      const rowLatestIso = compactToIso(row.latestDate);
      const rowStartIso = compactToIso(row.startDate);

      if (!rowLatestIso || rowLatestIso !== tradeIso) {
        excluded.push({
          code: row.code,
          name: row.name,
          reason: `最新日期 ${formatDate(row.latestDate)} 与目标日 ${formatDate(payload.tradeDate)} 不符`,
        });
        continue;
      }
      if (!rowStartIso) {
        excluded.push({
          code: row.code,
          name: row.name,
          reason: '起点日期缺失，无法确认区间长度',
        });
        continue;
      }
      if (expectedStart && rowStartIso !== expectedStart) {
        const span = sessionSpan(calendar, rowStartIso, tradeIso);
        excluded.push({
          code: row.code,
          name: row.name,
          reason: `起点 ${formatDate(row.startDate)} 不等于 ${sessions} 个交易日前的 ${expectedStart}${
            span == null ? '' : `（实际跨度 ${span} 个交易日）`
          }`,
        });
        continue;
      }
      kept.push(row);
    }

    const metadataReady = kept.filter(isMetadataComplete).length;
    let windowStatus: DataState = declared.status ?? 'DEGRADED';
    const declaredStartIso = compactToIso(declared.startDate);

    if (!expectedStart) {
      if (windowStatus !== 'MISSING') windowStatus = 'DEGRADED';
      windowReasons.push(
        `无法从权威日历定位 ${sessions} 个交易日前的起点，窗口长度未校验。`,
      );
    }
    if (declaredStartIso && expectedStart && declaredStartIso !== expectedStart) {
      if (windowStatus !== 'MISSING') windowStatus = 'DEGRADED';
      windowReasons.push(
        `接口声明区间起点 ${declaredStartIso} 与日历口径 ${expectedStart} 不一致，页面按日历口径展示。`,
      );
    }
    if (excluded.length) {
      if (windowStatus !== 'MISSING') windowStatus = 'DEGRADED';
      windowReasons.push(
        `已排除 ${excluded.length}/${sourceRows.length} 行：窗口长度或目标日不符，不参与排行。`,
      );
    }
    if (kept.length && metadataReady < kept.length) {
      if (windowStatus !== 'MISSING') windowStatus = 'DEGRADED';
      windowReasons.push(
        `元数据完整 ${metadataReady}/${kept.length}，缺题材。`,
      );
    }
    if (!kept.length) {
      windowStatus = 'MISSING';
      windowReasons.push('排除后没有可展示的行，不展示空榜或旧榜。');
    }

    if (windowStatus === 'MISSING') anyWindowMissing = true;
    if (windowStatus === 'DEGRADED') anyWindowDegraded = true;

    windows[key] = {
      key,
      sessions,
      declaredStatus: declared.status ?? 'DEGRADED',
      status: windowStatus,
      eligible: declared.eligible ?? 0,
      topRequested: declared.topRequested ?? 30,
      topAvailable: kept.length,
      metadataReady,
      expectedStart,
      endDate: payload.tradeDate,
      declaredStart: declared.startDate ?? null,
      reasons: windowReasons,
      rows: kept,
      excluded,
    };
  }

  // 门禁三：整体状态不得优于任何窗口与日期门禁的结论。
  if (status !== 'MISSING') {
    if (anyWindowMissing) status = 'DEGRADED';
    else if (anyWindowDegraded && status === 'READY') status = 'DEGRADED';
  }

  const generatedAt = payload.generatedAt;
  const generatedMs = generatedAt ? new Date(generatedAt).getTime() : Number.NaN;
  const ageHours = Number.isFinite(generatedMs)
    ? (now.getTime() - generatedMs) / 3_600_000
    : null;

  if (ageHours != null && ageHours > GENERATED_AGE_WARN_HOURS) {
    if (status === 'READY') status = 'DEGRADED';
    reasons.push(
      `接口生成于 ${formatAge(ageHours)}，可能尚未包含最新收盘，请核对目标日。`,
    );
  }

  return {
    status,
    tradeDate: payload.tradeDate,
    generatedAt,
    ageHours,
    source: payload.source,
    adjustment: payload.adjustment,
    methodology: payload.methodology,
    coverage: payload.coverage,
    reasons,
    windows,
    scoringDisabled:
      payload.scoringEnabled === false && payload.selectionEnabled === false,
  };
}
