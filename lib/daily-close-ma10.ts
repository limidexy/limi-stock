/**
 * 个股自身的 10 日线：用该股真实日线前复权收盘算 10 日均值。
 *
 * 为什么不能用池内涨幅重建：情绪跟踪里老高标的日涨幅只存在于它进池的那些交易日，
 * 48 个快照里常常只有 9–15 天有值。拿这些稀疏点重建的「归一化指数」既缺日、又换了口径，
 * 算出来的均线不是任何一只股票的 10 日线，所以这里直接取日线收盘。
 *
 * 边界（不可放宽）：
 *   - 只用「不晚于该日」的收盘，不做任何前视；
 *   - 不足 10 根真实收盘就是 null，并写明缺几根，不拿少于 10 根的均值冒充 MA10；
 *   - 不做插值、不用实时价补历史日、不跨复权口径混算；
 *   - 取数失败就是失败，写明原因，不退回重建口径。
 */

import type { TenLineDay } from './emotion-tracking.ts';
import { marketSymbol } from './minute-series.ts';
import { quoteForDate, type LiveQuote } from './live-quote.ts';

/** 10 日线窗口长度。 */
export const MA_WINDOW = 10;
/** 5 日线窗口长度。 */
export const MA5_WINDOW = 5;
export const TENLINE_SOURCE = '腾讯日线（前复权）';

const HEADERS = {
  referer: 'https://gu.qq.com/',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

export type DailyClosePoint = { date: string; close: number };

export type DailyCloseSeries = {
  code: string;
  symbol: string;
  status: 'READY' | 'MISSING';
  points: DailyClosePoint[];
  source: string;
  reasons: string[];
};

export type TenLineRow = {
  code: string;
  name: string;
  /** 目标日该股自身日线收盘。 */
  close: number | null;
  /** 目标日该股自身 5 日线。 */
  ma5: number | null;
  /** 目标日该股自身 10 日线。 */
  ma10: number | null;
  belowMa5: boolean | null;
  belowMa10: boolean | null;
  /** 目标日的价格与来源：优先当日实时/收盘快照，否则用日线收盘。 */
  price: number | null;
  priceLabel: string;
  priceAsOf: string | null;
  changePct: number | null;
  brokenDate: string | null;
};

export type TenLineMissing = { code: string; name: string; reason: string };

export type TenLineItem = {
  label: string;
  value: string;
  tone: 'ok' | 'info' | 'warn';
};

export type TenLineSummary = {
  reached: boolean;
  basis: string;
  window: string;
  requestedCount: number;
  readyCount: number;
  /** 目标日收盘落在 10 日线之下的只数。 */
  belowNowCount: number;
  /** 回看窗口内任一日跌破 10 日线的只数。 */
  touchedCount: number;
  rows: TenLineRow[];
  missing: TenLineMissing[];
  /** 拆开的提醒条目，UI 逐条渲染。 */
  items: TenLineItem[];
  note: string;
};

const BASIS =
  '5/10 日线都用个股自身日线前复权收盘算（含路径之前的交易日），不是池内涨幅重建';

/** 日线尚未接入时的占位汇总：reached=false，且写明原因而不是留空。 */
export function emptyTenLineSummary(reason: string): TenLineSummary {
  return {
    reached: false,
    basis: BASIS,
    window: '尚未取到日线收盘',
    requestedCount: 0,
    readyCount: 0,
    belowNowCount: 0,
    touchedCount: 0,
    rows: [],
    missing: [],
    items: [{ label: '口径', value: BASIS, tone: 'info' }],
    note: reason,
  };
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : null;
}

/**
 * 解析腾讯日线：`data.<symbol>.qfqday`（无复权事件时可能是 `day`）。
 * 行结构 `[date, open, close, high, low, volume]`，第 3 列才是收盘。
 */
export function parseTencentDailySeries(
  code: string,
  symbol: string,
  payload: unknown,
): DailyCloseSeries {
  const missing = (reason: string): DailyCloseSeries => ({
    code,
    symbol,
    status: 'MISSING',
    points: [],
    source: TENLINE_SOURCE,
    reasons: [reason],
  });
  if (!payload || typeof payload !== 'object') return missing('返回不是对象');
  const root = payload as Record<string, unknown>;
  const codeField = root.code;
  if (codeField !== undefined && finiteNumber(codeField) !== 0) {
    const codeText =
      typeof codeField === 'number' || typeof codeField === 'string'
        ? String(codeField)
        : JSON.stringify(codeField);
    const msgText = typeof root.msg === 'string' ? root.msg : '';
    return missing(`接口返回 code=${codeText}${msgText ? ` ${msgText}` : ''}`);
  }
  const data = root.data;
  if (!data || typeof data !== 'object' || Array.isArray(data))
    return missing('返回缺少 data');
  const node = (data as Record<string, unknown>)[symbol];
  if (!node || typeof node !== 'object') return missing(`返回缺少 ${symbol} 节点`);
  const record = node as Record<string, unknown>;
  const raw = Array.isArray(record.qfqday)
    ? record.qfqday
    : Array.isArray(record.day)
      ? record.day
      : [];
  if (!raw.length) return missing('返回没有日线行');

  const byDate = new Map<string, number>();
  for (const row of raw) {
    if (!Array.isArray(row)) continue;
    const date = typeof row[0] === 'string' ? row[0].slice(0, 10) : '';
    const close = finiteNumber(row[2]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || close === null || close <= 0)
      continue;
    byDate.set(date, close);
  }
  if (!byDate.size) return missing('日线行里没有可用的收盘价');

  const points = [...byDate.entries()]
    .map(([date, close]) => ({ date, close }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    code,
    symbol,
    status: 'READY',
    points,
    source: TENLINE_SOURCE,
    reasons: [],
  };
}

/**
 * 该日（含）之前最近 window 根真实日线收盘的均值。
 * 该日必须有收盘，否则返回 close=null、ma=null——停牌日没有均线。
 */
export function maAt(
  points: DailyClosePoint[],
  date: string,
  window = MA_WINDOW,
): { close: number | null; ma: number | null; used: number } {
  const upto = points.filter((point) => point.date <= date);
  const last = upto.at(-1);
  const close = last && last.date === date ? last.close : null;
  if (close === null) return { close: null, ma: null, used: upto.length };
  if (upto.length < window) return { close, ma: null, used: upto.length };
  const slice = upto.slice(-window);
  return {
    close,
    ma: slice.reduce((sum, point) => sum + point.close, 0) / window,
    used: window,
  };
}

/** 10 日线。 */
export function ma10At(points: DailyClosePoint[], date: string) {
  const { close, ma, used } = maAt(points, date, MA_WINDOW);
  return { close, ma10: ma, used };
}

function annotate(
  path: TenLineDay[],
  series: DailyCloseSeries | undefined,
): TenLineDay[] {
  if (!series || series.status !== 'READY' || !series.points.length)
    return path.map((day) => ({
      ...day,
      close: null,
      ma5: null,
      ma10: null,
      belowMa5: null,
      belowMa10: null,
      ma10Note: series?.reasons[0] ?? '该股日线收盘未取到，均线不计算',
    }));
  return path.map((day) => {
    const five = maAt(series.points, day.date, MA5_WINDOW);
    const ten = maAt(series.points, day.date, MA_WINDOW);
    const close = ten.close;
    if (close === null)
      return {
        ...day,
        close: null,
        ma5: null,
        ma10: null,
        belowMa5: null,
        belowMa10: null,
        ma10Note: '该日无日线收盘（停牌或未上市），不计算均线',
      };
    // 跌破 = 收盘严格低于均线；持平不算跌破。算不出就是 null，不是 false。
    return {
      ...day,
      close,
      ma5: five.ma,
      ma10: ten.ma,
      belowMa5: five.ma === null ? null : close < five.ma,
      belowMa10: ten.ma === null ? null : close < ten.ma,
      ma10Note:
        ten.ma === null
          ? `该日前只有 ${ten.used} 根真实日线收盘，不足 ${MA_WINDOW} 根`
          : null,
    };
  });
}

export type TenLineCarrier = {
  code: string;
  name: string;
  brokenDate: string | null;
  path: TenLineDay[];
};

/**
 * 把真实 5/10 日线写进每只老高标的逐日路径，并给出拆开的提醒条目。
 *
 * 价格口径：只有实时快照的报价日期 == 目标日时才用它（标「实时」或「收盘」），
 * 否则退回目标日的日线收盘（标「日线收盘」）。绝不把别的日子的快照当目标日价格。
 */
export function attachTenLine<T extends TenLineCarrier>(
  rows: T[],
  seriesByCode: Map<string, DailyCloseSeries>,
  targetDate: string,
  quotes?: Map<string, LiveQuote>,
): { rows: T[]; tenLine: TenLineSummary } {
  const next = rows.map((row) => ({
    ...row,
    path: annotate(row.path, seriesByCode.get(row.code)),
  }));

  const detail: TenLineRow[] = next.map((row) => {
    const today = row.path.find((day) => day.date === targetDate);
    const live = quoteForDate(quotes?.get(row.code), targetDate);
    const price = live?.price ?? today?.close ?? null;
    return {
      code: row.code,
      name: row.name,
      close: today?.close ?? null,
      ma5: today?.ma5 ?? null,
      ma10: today?.ma10 ?? null,
      belowMa5: today?.belowMa5 ?? null,
      belowMa10: today?.belowMa10 ?? null,
      price,
      priceLabel: live ? live.label : today?.close != null ? '日线收盘' : '无价格',
      priceAsOf: live ? live.asOf : (today?.date ?? null),
      changePct: live?.changePct ?? today?.changePct ?? null,
      brokenDate: row.brokenDate,
    };
  });

  const missing: TenLineMissing[] = [];
  for (const row of rows) {
    const series = seriesByCode.get(row.code);
    if (series?.status === 'READY' && series.points.length) continue;
    missing.push({
      code: row.code,
      name: row.name,
      reason: series?.reasons[0] ?? '未请求日线收盘',
    });
  }
  // 取到日线、但目标日当天没有收盘（停牌）的，也单独列出，不混进「算得出」。
  for (const row of next) {
    const series = seriesByCode.get(row.code);
    if (series?.status !== 'READY' || !series.points.length) continue;
    const today = row.path.find((day) => day.date === targetDate);
    if (today?.ma10 != null) continue;
    missing.push({
      code: row.code,
      name: row.name,
      reason: today?.ma10Note ?? '目标日不足10根真实日线收盘',
    });
  }

  const ready = detail.filter((row) => row.ma10 !== null);
  const belowNow = ready.filter((row) => row.belowMa10 === true);
  const touched = next.filter((row) =>
    row.path.some((day) => day.belowMa10 === true),
  );
  const requestedCount = rows.length;
  const reached = ready.length > 0;

  const nameList = (list: Array<{ name: string }>) =>
    list.length ? ` · ${list.map((x) => x.name).join('、')}` : '';

  const items: TenLineItem[] = [
    { label: '口径', value: BASIS, tone: 'info' },
    {
      label: '覆盖',
      value: `${ready.length}/${requestedCount} 只在 ${targetDate} 算得出自身 10 日线${
        missing.length ? `，${missing.length} 只未计算` : ''
      }`,
      tone: missing.length ? 'warn' : 'ok',
    },
    {
      label: '目标日收在 10 日线下方',
      value: `${belowNow.length} 只${nameList(belowNow)}`,
      tone: belowNow.length ? 'warn' : 'ok',
    },
    {
      label: '回看窗口内曾跌破',
      value: `${touched.length} 只${nameList(touched)}`,
      tone: touched.length ? 'info' : 'ok',
    },
  ];
  if (missing.length)
    items.push({
      label: '未计算明细',
      value: missing
        .slice(0, 8)
        .map((x) => `${x.name}（${x.reason}）`)
        .join('；'),
      tone: 'warn',
    });

  const note = reached
    ? `个股自身日线前复权收盘的 10 日均线：${ready.length}/${requestedCount} 只算得出，目标日 ${
        belowNow.length
      } 只收在 10 日线下方，回看窗口内 ${touched.length} 只曾跌破。`
    : '没有一只断板老高标在目标日算得出自身 10 日线（日线收盘未取到或不足10根），10日线提醒不触发。';

  return {
    rows: next as T[],
    tenLine: {
      reached,
      basis: BASIS,
      window: `回看 ${requestedCount} 只老高标`,
      requestedCount,
      readyCount: ready.length,
      belowNowCount: belowNow.length,
      touchedCount: touched.length,
      rows: detail,
      missing,
      items,
      note,
    },
  };
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const output: R[] = [];
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        output[index] = await worker(items[index]);
      }
    },
  );
  await Promise.all(runners);
  return output;
}

async function fetchOnce(
  url: string,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, { headers: HEADERS, cache: 'no-store', signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

const CACHE = new Map<string, { at: number; series: DailyCloseSeries }>();
/** 日线收盘是按「当日已收盘」的事实，10 分钟内不会变；只做短缓存避免轮询打爆源站。 */
const CACHE_TTL = 10 * 60 * 1000;

async function fetchOne(
  code: string,
  count: number,
  board?: string | null,
): Promise<DailyCloseSeries> {
  const cached = CACHE.get(code);
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.series;
  const symbol = marketSymbol(code, board);
  const query = `${symbol},day,,,${count},qfq`;
  const urls = [
    `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${query}`,
    `https://proxy.finance.qq.com/ifzqgtimg/appstock/app/fqkline/get?param=${query}`,
  ];
  const reasons: string[] = [];
  for (const url of urls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const payload = await fetchOnce(url, controller.signal);
      const series = parseTencentDailySeries(code, symbol, payload);
      if (series.status === 'READY') {
        CACHE.set(code, { at: Date.now(), series });
        return series;
      }
      reasons.push(series.reasons[0]);
    } catch (error) {
      reasons.push(error instanceof Error ? error.message : '请求失败');
    } finally {
      clearTimeout(timer);
    }
  }
  const failed: DailyCloseSeries = {
    code,
    symbol,
    status: 'MISSING',
    points: [],
    source: TENLINE_SOURCE,
    reasons: reasons.length ? reasons : ['日线收盘请求失败'],
  };
  // 失败也缓存，避免同一轮 22 只反复重试拖住接口。
  CACHE.set(code, { at: Date.now(), series: failed });
  return failed;
}

/**
 * 批量取日线前复权收盘。默认 120 根，够覆盖 30 日回看路径之前再留 9 根算 10 日均线。
 */
export async function fetchDailyCloses(
  codes: Array<{ code: string; board?: string | null }>,
  count = 120,
): Promise<Map<string, DailyCloseSeries>> {
  const list = [...new Map(codes.map((x) => [x.code, x])).values()];
  const results = await mapLimit(list, 6, (item) =>
    fetchOne(item.code, count, item.board),
  );
  return new Map(results.map((series) => [series.code, series]));
}
