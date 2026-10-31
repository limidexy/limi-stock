/**
 * 当日分时：1 分钟价格、均价与每分钟成交量。
 *
 * 数据取自腾讯 1 分钟 K 线，每根即该分钟的成交价；同时给出累计成交量与累计
 * 成交额，均价由「累计成交额 ÷ 累计成交量」反推，不是拿价格再平均一次。
 *
 * 只覆盖行情源保留的最近几个交易日。更早的日期直接报缺失，
 * 不用 5 分钟线或日线拼一个看起来像分时的图。
 */

export type IntradayBar = {
  /** HHMM，例如 0930。 */
  time: string;
  price: number;
  /** 均价；累计成交量为 0 时为 null。 */
  avgPrice: number | null;
  /** 该分钟成交量，单位股。 */
  volume: number;
};

export type IntradaySeries = {
  status: 'READY' | 'DEGRADED' | 'MISSING';
  code: string;
  date: string;
  preClose: number | null;
  bars: IntradayBar[];
  expected: number;
  source: string;
  /** 只放会导致降级的问题。 */
  reasons: string[];
  /** 口径说明，不影响状态。 */
  notes: string[];
};

/** 09:30–11:30 与 13:00–15:00 各 121 个端点。 */
export const SESSION_MINUTES = 242;

const SOURCE = '腾讯 1 分钟 K 线';

type DayRow = { date?: unknown; data?: unknown; prec?: unknown };

const dayDate = (item: unknown) => {
  const value = (item as DayRow | null)?.date;
  return typeof value === 'string' ? value : '';
};

/** 连续竞价时段。 */
const inSession = (time: string) => {
  const value = Number(time);
  if (!Number.isFinite(value)) return false;
  return (value >= 930 && value <= 1130) || (value >= 1300 && value <= 1500);
};

/** 开盘前集合竞价，不属于分时曲线。 */
const preOpen = (time: string) => Number(time) < 930;

/** 盘后固定价格交易（15:06 起），不属于分时曲线。 */
const afterHours = (time: string) => Number(time) > 1500;

export function parseTencentIntraday(
  raw: unknown,
  symbol: string,
  code: string,
  date: string,
): IntradaySeries {
  const empty: IntradaySeries = {
    status: 'MISSING',
    code,
    date,
    preClose: null,
    bars: [],
    expected: SESSION_MINUTES,
    source: SOURCE,
    reasons: [],
    notes: [],
  };
  const compact = date.replaceAll('-', '');
  const payload = raw as { data?: Record<string, { data?: unknown[] }> } | null;
  const days = payload?.data?.[symbol]?.data;
  if (!Array.isArray(days)) {
    return { ...empty, reasons: ['行情源没有返回分钟序列。'] };
  }
  const available = days
    .map(dayDate)
    .filter((value) => /^\d{8}$/.test(value))
    .sort();
  const day = days.find((item) => dayDate(item) === compact) as
    | DayRow
    | undefined;
  if (!day) {
    return {
      ...empty,
      reasons: [
        available.length
          ? `行情源的 1 分钟序列只保留最近 ${available.length} 个交易日（${available[0]}–${available.at(-1)}），${compact} 不在其中。`
          : '行情源的 1 分钟序列没有可用交易日。',
      ],
    };
  }

  const rawBars = Array.isArray(day.data) ? (day.data as unknown[]) : [];
  const preCloseRaw = Number(day.prec);
  const preClose =
    Number.isFinite(preCloseRaw) && preCloseRaw > 0 ? preCloseRaw : null;

  const reasons: string[] = [];
  const notes: string[] = [];
  const bars: IntradayBar[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  let duplicates = 0;
  let preOpenSkipped = 0;
  let afterHoursSkipped = 0;
  let previousCumVolume = 0;

  for (const entry of rawBars) {
    const fields = String(entry).split(' ');
    if (fields.length < 4) {
      dropped += 1;
      continue;
    }
    const time = fields[0].trim();
    const price = Number(fields[1]);
    const cumVolume = Number(fields[2]);
    const cumAmount = Number(fields[3]);
    if (!/^\d{4}$/.test(time)) {
      dropped += 1;
      continue;
    }
    if (!inSession(time)) {
      // 集合竞价与盘后固定价格交易不在分时曲线内，静默排除但说明清楚。
      if (preOpen(time)) preOpenSkipped += 1;
      else if (afterHours(time)) afterHoursSkipped += 1;
      else dropped += 1;
      // 累计量仍要跟着走，否则 09:30 首根会带上集合竞价的量。
      if (Number.isFinite(cumVolume)) previousCumVolume = cumVolume;
      continue;
    }
    if (!Number.isFinite(price) || price <= 0) {
      dropped += 1;
      continue;
    }
    if (seen.has(time)) {
      duplicates += 1;
      continue;
    }
    seen.add(time);
    // 成交量单位是手，转成股；累计值可能因行情源修正而回退，回退时记 0。
    const volume =
      Number.isFinite(cumVolume) && cumVolume >= previousCumVolume
        ? (cumVolume - previousCumVolume) * 100
        : 0;
    if (Number.isFinite(cumVolume)) previousCumVolume = cumVolume;
    const avgPrice =
      Number.isFinite(cumVolume) && cumVolume > 0 && Number.isFinite(cumAmount)
        ? cumAmount / (cumVolume * 100)
        : null;
    bars.push({ time, price, avgPrice, volume });
  }

  if (preOpenSkipped)
    notes.push(`${preOpenSkipped} 根开盘前集合竞价不计入分时曲线。`);
  if (afterHoursSkipped)
    notes.push(
      `${afterHoursSkipped} 根盘后固定价格交易（15:00 之后）不计入分时曲线，也不计入分钟成交量合计。`,
    );
  if (dropped) reasons.push(`${dropped} 根不在交易时段或字段不完整，已剔除。`);
  if (duplicates) reasons.push(`${duplicates} 根时间戳重复，只保留第一根。`);
  if (bars.length !== SESSION_MINUTES)
    reasons.push(
      `当日应有 ${SESSION_MINUTES} 根 1 分钟数据，实际 ${bars.length} 根。`,
    );
  if (bars.length && bars[bars.length - 1].time !== '1500')
    reasons.push(`最后一根是 ${bars[bars.length - 1].time}，不是 15:00 收盘。`);

  if (!bars.length) {
    return {
      ...empty,
      preClose,
      notes,
      reasons: [...reasons, '该交易日没有可用的分钟成交记录。'],
    };
  }

  return {
    status: reasons.length ? 'DEGRADED' : 'READY',
    code,
    date,
    preClose,
    bars,
    expected: SESSION_MINUTES,
    source: SOURCE,
    reasons,
    notes,
  };
}

export function summarizeIntraday(series: IntradaySeries) {
  if (!series.bars.length) return null;
  const prices = series.bars.map((bar) => bar.price);
  const volume = series.bars.reduce((total, bar) => total + bar.volume, 0);
  return {
    first: series.bars[0].price,
    last: series.bars[series.bars.length - 1].price,
    high: Math.max(...prices),
    low: Math.min(...prices),
    volume,
    changePct:
      series.preClose && series.preClose > 0
        ? (series.bars[series.bars.length - 1].price / series.preClose - 1) * 100
        : null,
  };
}
