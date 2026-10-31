/**
 * 尾盘涨速归档的读取层。
 *
 * 归档口径见 scripts/build-close-speed.mjs：涨速 = 15:00 收盘价 / 14:55 价格 - 1。
 * 这里只按交易日取数并给出状态，缺哪一天就说缺哪一天，不用别的交易日顶替。
 */

import document from '@/lib/close-speed.generated.json';

export type CloseSpeedRow = {
  code: string;
  name: string;
  price: number;
  /** 14:55 的价格，涨速的分母。 */
  refPrice: number;
  speedPct: number;
  changePct: number | null;
  amount: number | null;
  volume: number | null;
};

export type CloseSpeedView = {
  status: 'READY' | 'DEGRADED' | 'MISSING';
  tradeDate: string | null;
  requestedDate: string;
  windowStart: string | null;
  windowEnd: string | null;
  coverage: {
    requested: number;
    available: number;
    withWindow: number;
    /** 退市整理期个股，已排除在池外。 */
    delistedExcluded: number;
  };
  rows: CloseSpeedRow[];
  reasons: string[];
};

type DayDocument = {
  date: string;
  windowStart: string;
  windowEnd: string;
  requested: number;
  available: number;
  withWindow: number;
  delistedExcluded?: number;
  rows: CloseSpeedRow[];
};

const DAYS = (document as { dates: Record<string, DayDocument> }).dates;

export const CLOSE_SPEED_DATES = Object.keys(DAYS).sort();

const digits = (value: string) => value.replace(/\D/g, '');

const fmtDate = (value: string) =>
  `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`;

export function closeSpeedIndex(tradeDate: string) {
  const day = DAYS[digits(tradeDate)];
  if (!day) return new Map<string, CloseSpeedRow>();
  return new Map(day.rows.map((row) => [row.code, row]));
}

export function resolveCloseSpeed(
  tradeDate: string,
  limit = 40,
): CloseSpeedView {
  const requestedDate = digits(tradeDate);
  const empty: CloseSpeedView = {
    status: 'MISSING',
    tradeDate: null,
    requestedDate,
    windowStart: null,
    windowEnd: null,
    coverage: { requested: 0, available: 0, withWindow: 0, delistedExcluded: 0 },
    rows: [],
    reasons: [],
  };
  const day = DAYS[requestedDate];
  if (!day) {
    return {
      ...empty,
      reasons: [
        CLOSE_SPEED_DATES.length
          ? `涨速归档没有 ${fmtDate(requestedDate)}，现有覆盖 ${fmtDate(
              CLOSE_SPEED_DATES[0],
            )} 至 ${fmtDate(CLOSE_SPEED_DATES[CLOSE_SPEED_DATES.length - 1])}；不用其他交易日顶替。`
          : '涨速归档为空，尚未生成任何交易日。',
      ],
    };
  }
  const missingWindow = day.available - day.withWindow;
  return {
    status: missingWindow > 0 ? 'DEGRADED' : 'READY',
    tradeDate: day.date,
    requestedDate,
    windowStart: day.windowStart,
    windowEnd: day.windowEnd,
    coverage: {
      requested: day.requested,
      available: day.available,
      withWindow: day.withWindow,
      delistedExcluded: day.delistedExcluded ?? 0,
    },
    rows: day.rows.slice(0, limit),
    reasons: missingWindow
      ? [
          `${missingWindow} 只股票当日缺 14:55 或 15:00 端点，未参与排序。`,
        ]
      : [],
  };
}
