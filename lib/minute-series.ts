/**
 * 单只股票、单个交易日的 5 分钟收盘序列。
 *
 * 只做两件事：把行情源返回的原始数组收敛到「该交易日」的分钟序列，并如实标注完整度。
 * 不插值、不补点、不把日线拆成分钟、不混入相邻交易日的数据。
 */

export type MinuteBar = {
  /** HH:MM，5 分钟根的区间结束时刻（首根 09:35，末根 15:00）。 */
  time: string;
  close: number;
  volume: number;
};

export type MinuteSeriesState = 'READY' | 'DEGRADED' | 'MISSING';

export type MinuteSeries = {
  code: string;
  /** YYYY-MM-DD */
  date: string;
  status: MinuteSeriesState;
  bars: MinuteBar[];
  /** 一个完整交易日的 5 分钟根数。 */
  expected: number;
  source: string;
  reasons: string[];
};

/** 沪深两市一个完整交易日按 5 分钟切分为 48 根。 */
export const SESSION_BARS = 48;
const SESSION_LAST = '15:00';

const BOARD_SYMBOL: Record<string, string> = {
  沪主板: 'sh',
  科创板: 'sh',
  深主板: 'sz',
  创业板: 'sz',
  北交所: 'bj',
};

/**
 * 六位代码 → 行情源前缀。优先用榜单自带的板块字段，缺失时才按代码段推断。
 * 推断只用于取数，不参与任何口径判断。
 */
export function marketSymbol(code: string, marketBoard?: string | null) {
  const byBoard = marketBoard ? BOARD_SYMBOL[marketBoard] : undefined;
  if (byBoard) return `${byBoard}${code}`;
  if (code.startsWith('6')) return `sh${code}`;
  if (code.startsWith('0') || code.startsWith('3')) return `sz${code}`;
  return `bj${code}`;
}

/** 5 分钟根是否落在连续竞价时段内（11:30 与 13:05 之间是午休，没有成交）。 */
export function isSessionTime(time: string) {
  if (!/^\d{2}:\d{2}$/.test(time)) return false;
  const morning = time >= '09:35' && time <= '11:30';
  const afternoon = time >= '13:05' && time <= '15:00';
  return morning || afternoon;
}

type RawRow = { day?: unknown; close?: unknown; volume?: unknown };

/**
 * 解析行情源的分钟数组。只保留 `date` 当天的根；重复时间戳保留首条并降级，
 * 缺收盘根、根数不足都如实降级，不补齐。
 */
export function parseMinuteBars(
  raw: unknown,
  code: string,
  date: string,
): MinuteSeries {
  const base: MinuteSeries = {
    code,
    date,
    status: 'MISSING',
    bars: [],
    expected: SESSION_BARS,
    source: 'SINA_CN_MARKETDATA_5MIN',
    reasons: [],
  };
  if (!Array.isArray(raw) || !raw.length) {
    return { ...base, reasons: [`行情源未返回 ${date} 的分钟数据。`] };
  }

  const seen = new Set<string>();
  const bars: MinuteBar[] = [];
  let duplicates = 0;
  let offSession = 0;

  for (const row of raw as RawRow[]) {
    const stamp = typeof row?.day === 'string' ? row.day : '';
    if (!stamp.startsWith(date)) continue;
    const time = stamp.slice(11, 16);
    if (!isSessionTime(time)) {
      offSession += 1;
      continue;
    }
    const close = Number(row.close);
    const volume = Number(row.volume);
    if (!Number.isFinite(close) || close <= 0) continue;
    if (seen.has(time)) {
      duplicates += 1;
      continue;
    }
    seen.add(time);
    bars.push({ time, close, volume: Number.isFinite(volume) ? volume : 0 });
  }

  bars.sort((a, b) => a.time.localeCompare(b.time));
  const reasons: string[] = [];

  if (!bars.length) {
    return {
      ...base,
      reasons: [`行情源没有 ${date} 的分钟根，该日可能停牌或未上市。`],
    };
  }

  const last = bars[bars.length - 1];
  let status: MinuteSeriesState = 'READY';

  if (bars.length !== SESSION_BARS) {
    status = 'DEGRADED';
    reasons.push(
      `当日仅 ${bars.length}/${SESSION_BARS} 根 5 分钟价格，按实际根数展示，未补齐。`,
    );
  }
  if (last.time !== SESSION_LAST) {
    status = 'DEGRADED';
    reasons.push(
      `末根为 ${last.time} 而非 ${SESSION_LAST}，可能是半日市或当日数据未更新。`,
    );
  }
  if (duplicates) {
    status = 'DEGRADED';
    reasons.push(`行情源有 ${duplicates} 个重复时间戳，已保留首条。`);
  }
  if (offSession) {
    status = 'DEGRADED';
    reasons.push(`已剔除 ${offSession} 根非连续竞价时段的价格。`);
  }

  return { ...base, status, bars, reasons };
}

/** 该序列的开高低收与总量，供详情面板展示。 */
export function summarizeSeries(series: MinuteSeries) {
  if (!series.bars.length) return null;
  let high = -Infinity;
  let low = Infinity;
  let volume = 0;
  for (const bar of series.bars) {
    if (bar.close > high) high = bar.close;
    if (bar.close < low) low = bar.close;
    volume += bar.volume;
  }
  return {
    first: series.bars[0].close,
    last: series.bars[series.bars.length - 1].close,
    high,
    low,
    volume,
  };
}
