import type {
  CloseSnapshot,
  CloseStock,
  IntradayEmotionSnapshot,
} from '@/lib/close-history';
import { archivedQuote, archivedTrend } from '@/lib/archive-evidence';
import { CLOSE_HISTORY } from '@/lib/close-history';
import { enrichEmotionCloses } from '@/lib/emotion-tracking-source';
import { loadCloseHistory } from '@/lib/persistence';
import { emotionReading } from '@/lib/market-reading';
import { observeFundFlow, type FundFlowObservation } from './flow-observation';
import tradingCalendarDocument from '@/lib/trading-calendar.generated.json';
import {
  buildArchivedLadderSnapshot,
  consecutiveLimitHeight,
} from '@/lib/ladder-evidence';
import {
  mergeQuoteRows,
  parseTencentLiveQuotes,
  quoteComplete,
  quoteDate,
  type StockQuote,
} from '@/lib/quote-evidence';
import {
  parseTrendPoints,
  priceLimitState,
  trendWindow,
} from '@/lib/timeline-evidence';

const PUBLIC_CLIENT_TOKEN = '7eea3edcaed734bea9cbfc24409ed989';
const MARKET_FILTER = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048';
const QUOTE_FIELDS =
  'f12,f14,f2,f3,f5,f6,f8,f15,f18,f20,f21,f22,f62,f100,f124,f184';

export type DataState = 'READY' | 'DEGRADED' | 'MISSING';

export type MarketDateContext = {
  requestedDate: string;
  tradeDate: string;
  phase: string;
  sessionState: 'LIVE' | 'CLOSED';
  sourceState: 'LIVE' | 'ARCHIVED';
};

type CacheRecord<T> = { expiresAt: number; value: T };
const metadataCache = new Map<string, CacheRecord<StockMetadata>>();
const limitHistoryCache = new Map<string, CacheRecord<LimitHistory>>();
const clistCache = new Map<
  string,
  {
    expiresAt: number;
    staleUntil: number;
    value: { total: number; rows: ClistRow[]; host: string; stale?: boolean };
  }
>();
let verifiedSessionCache: CacheRecord<string[]> | null = null;

export type StockMetadata = {
  code: string;
  name: string;
  industry: string | null;
  concepts: string[];
  observedAt?: string;
};

export type LimitHistory = {
  count: number | null;
  sessions: number;
  status: DataState;
  method: string;
  reason?: string;
};

export type SectorFlowPoint = {
  time: string;
  mainNetInflow: number;
};

export type SectorFlowSeries = {
  code: string;
  name: string;
  changePct: number | null;
  latestMainNetInflow: number;
  delta5m: number | null;
  delta15m: number | null;
  delta30m: number | null;
  points: SectorFlowPoint[];
  persistenceLabel?: string;
  flowObservation?: FundFlowObservation;
  detailState?: DataState;
  detailBasis?: string;
  subgroups?: Array<{ name: string; count: number; leaders: string[] }>;
  representatives?: Array<{
    code: string;
    name: string;
    industry: string;
    changePct: number | null;
    speedPct: number | null;
    mainNetInflow: number | null;
  }>;
};

export type FlowSnapshot = {
  status: DataState;
  curveState: DataState;
  splitState: DataState;
  retrievedAt: string;
  tradeDate: string;
  phase: string;
  lastPointTime: string | null;
  source: string;
  reason?: string;
  sourceState?: 'LIVE' | 'ARCHIVED' | 'STALE';
  requestedDate?: string;
  sessionState?: 'LIVE' | 'CLOSED';
  basis: string;
  coverage: { requested: number; available: number };
  gap?: {
    gapId: string;
    tradeDate: string;
    granularity: 'DAILY_CLOSE' | 'ONE_MINUTE';
    status: string;
    classification: string;
    retryable: boolean;
    lastProbeAt: string | null;
    nextProbeAt: string | null;
    reason: string;
  } | null;
  dataAvailableThrough?: string | null;
  series: SectorFlowSeries[];
  split: {
    inflow: SectorFlowSeries[];
    outflow: SectorFlowSeries[];
    cumulativeInflow: SectorFlowSeries[];
    cumulativeOutflow: SectorFlowSeries[];
    persistentStrong: SectorFlowSeries[];
    persistentWeak: SectorFlowSeries[];
    positiveCount: number;
    negativeCount: number;
  };
};

export type MarketTimelineDriver = {
  code: string;
  name: string;
  industry: string;
  atTimeChangePct: number | null;
  windowChangePct: number | null;
  mainNetInflow: number | null;
  limitState: 'LIMIT_UP' | 'LIMIT_DOWN' | 'NONE' | 'UNKNOWN';
  role:
    | '同窗价格确认'
    | '同窗方向相反'
    | '同窗价格持平'
    | '同窗窗口缺口'
    | '分钟价格不可用';
};

export type MarketTimelineRelatedStock = {
  code: string;
  name: string;
  industry: string;
  changePct: number | null;
  speedPct: number | null;
  mainNetInflow: number | null;
};

export type MarketTimelineEvent = {
  id: string;
  kind: 'START' | 'STRONG' | 'CASHOUT' | 'WEAKEN' | 'OBSERVE';
  label: '启动' | '延续强势' | '兑现' | '走弱' | '震荡观察';
  sectorCode: string;
  sectorName: string;
  windowStartTime: string;
  time: string;
  sectorChangePct: number | null;
  sectorDailyFlow: number;
  sectorAtTimeChangePct: number | null;
  sectorWindowChangePct: number | null;
  flowDelta: number;
  flowPreviousDelta: number;
  flowAcceleration: number;
  turnReason: 'FLOW_REVERSAL' | 'FLOW_ACCELERATION';
  indices: Array<{
    code: string;
    name: string;
    changePct: number | null;
    windowChangePct: number | null;
  }>;
  drivers: MarketTimelineDriver[];
  relatedStocks: MarketTimelineRelatedStock[];
  driverState: DataState;
  driverBasis: string;
};

export type MarketTimelineSnapshot = {
  evidenceVersion?: number;
  status: DataState;
  retrievedAt: string;
  tradeDate: string;
  phase: string;
  lastPointTime: string | null;
  source: string;
  sourceState: 'LIVE' | 'ARCHIVED' | 'STALE';
  requestedDate?: string;
  sessionState?: 'LIVE' | 'CLOSED';
  reason?: string;
  basis: string;
  coverage: {
    sectors: number;
    events: number;
    timeNodes: number;
    indices: number;
    checkedDrivers: number;
    confirmedDrivers: number;
    relatedStocks: number;
  };
  events: MarketTimelineEvent[];
};

type ClistRow = Record<string, string | number | null>;
type PoolRow = Record<string, unknown>;
let flowSnapshotCache: CacheRecord<FlowSnapshot> | null = null;
let flowSnapshotPending: Promise<FlowSnapshot> | null = null;
let timelineSnapshotCache: CacheRecord<MarketTimelineSnapshot> | null = null;
let marketDateContextCache: CacheRecord<MarketDateContext> | null = null;
let intradayEmotionCache: CacheRecord<IntradayEmotionSnapshot> | null = null;
const trendCache = new Map<
  string,
  {
    expiresAt: number;
    staleUntil: number;
    value: IntradayTrend;
  }
>();
const trendPending = new Map<string, Promise<IntradayTrend>>();
const trendFailures = new Map<string, number>();

type IntradayTrend = {
  code: string;
  name: string;
  preClose: number | null;
  points: Array<{ time: string; price: number }>;
  stale?: boolean;
};

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function fetchJson(
  url: string,
  timeoutMs = 10_000,
): Promise<Record<string, unknown>> {
  let lastError: unknown = new Error('unknown fetch error');
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: {
          accept: 'application/json,text/plain,*/*',
          referer: 'https://quote.eastmoney.com/',
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as Record<string, unknown>;
    } catch (error) {
      lastError = error;
      if (attempt < 2)
        await new Promise((resolve) => setTimeout(resolve, 180 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function fetchJsonOnce(
  url: string,
  timeoutMs = 7_000,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/json,text/plain,*/*',
        referer: 'https://quote.eastmoney.com/',
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(
  url: string,
  referer: string,
  timeoutMs = 10_000,
): Promise<string> {
  let lastError: unknown = new Error('unknown fetch error');
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: {
          referer,
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 2)
        await new Promise((resolve) => setTimeout(resolve, 180 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        output[index] = await worker(items[index], index);
      }
    },
  );
  await Promise.all(runners);
  return output;
}

async function fetchClist(options: {
  fs: string;
  fid?: string;
  order?: 0 | 1;
  pageSize?: number;
  page?: number;
  fields?: string;
}): Promise<{
  total: number;
  rows: ClistRow[];
  host: string;
  stale?: boolean;
}> {
  const params = new URLSearchParams({
    pn: String(options.page ?? 1),
    pz: String(options.pageSize ?? 1000),
    po: String(options.order ?? 1),
    np: '1',
    ut: PUBLIC_CLIENT_TOKEN,
    fltt: '2',
    invt: '2',
    fid: options.fid ?? 'f3',
    fs: options.fs,
    fields: options.fields ?? QUOTE_FIELDS,
  });
  const cacheKey = `${shanghaiDate()}:${params.toString()}`;
  const cached = clistCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const failures: string[] = [];
  for (const host of ['push2delay.eastmoney.com', 'push2.eastmoney.com']) {
    try {
      const payload = await fetchJson(
        `https://${host}/api/qt/clist/get?${params}`,
      );
      const data = (payload.data ?? {}) as Record<string, unknown>;
      if (!Array.isArray(data.diff)) throw new Error('行情列表字段缺失');
      const rows = Array.isArray(data.diff) ? (data.diff as ClistRow[]) : [];
      const value = {
        total: Number(data.total ?? rows.length),
        rows,
        host,
        stale: false,
      };
      clistCache.set(cacheKey, {
        expiresAt: Date.now() + 850,
        staleUntil: Date.now() + 5 * 60_000,
        value,
      });
      return value;
    } catch (error) {
      failures.push(`${host}:${String(error)}`);
    }
  }
  if (cached && cached.staleUntil > Date.now()) {
    return { ...cached.value, stale: true, host: `stale:${cached.value.host}` };
  }
  throw new Error(`行情列表不可用 ${failures.join(' | ')}`);
}

async function fetchAllClist(options: {
  fs: string;
  fid?: string;
  order?: 0 | 1;
  fields?: string;
}) {
  const pageSize = 100;
  const first = await fetchClist({ ...options, pageSize, page: 1 });
  const pageCount = Math.max(1, Math.ceil(first.total / pageSize));
  if (pageCount === 1) return first;
  const pages = Array.from({ length: pageCount - 1 }, (_, index) => index + 2);
  const remaining = await mapLimit(pages, 3, (page) =>
    fetchClist({ ...options, pageSize, page }),
  );
  const rows = [first, ...remaining].flatMap((page) => page.rows);
  const unique = new Map(rows.map((row) => [String(row.f12 ?? ''), row]));
  return { total: first.total, rows: [...unique.values()], host: first.host };
}

function shanghaiDate(value = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(value)
    .replaceAll('-', '');
}

function shanghaiClock(value = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(value);
}

function clockText(value: unknown): string | null {
  const digits = String(value ?? '')
    .replace(/\D/g, '')
    .padStart(6, '0');
  if (digits.length < 4) return null;
  return `${digits.slice(0, 2)}:${digits.slice(2, 4)}:${digits.slice(4, 6)}`;
}

function secid(code: string): string {
  return `${code.startsWith('6') ? '1' : '0'}.${code}`;
}

function marketSymbol(code: string): string {
  if (code.startsWith('6')) return `sh${code}`;
  if (code.startsWith('8') || code.startsWith('9')) return `bj${code}`;
  return `sz${code}`;
}

function splitConcepts(value: unknown): string[] {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5);
}

async function fetchF10Concepts(code: string): Promise<string[]> {
  const prefix = code.startsWith('6')
    ? 'SH'
    : code.startsWith('8') || code.startsWith('9')
      ? 'BJ'
      : 'SZ';
  const payload = await fetchJson(
    `https://emweb.securities.eastmoney.com/PC_HSF10/CoreConception/PageAjax?code=${prefix}${code}`,
  );
  const rows = Array.isArray(payload.ssbk)
    ? (payload.ssbk as Array<Record<string, unknown>>)
    : [];
  return [
    ...new Set(
      rows
        .map((row) => String(row.BOARD_NAME ?? '').trim())
        .filter(Boolean)
        .filter(
          (name) =>
            !name.endsWith('板块') &&
            !/[ⅡⅢ]$/.test(name) &&
            !['融资融券', '沪股通', '深股通', '转融券标的'].includes(name),
        ),
    ),
  ].slice(0, 5);
}

export async function fetchStockMetadata(code: string): Promise<StockMetadata> {
  const cached = metadataCache.get(code);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const fields = 'f57,f58,f127,f128,f129';
  let data: Record<string, unknown> = {};
  try {
    const payload = await fetchJson(
      `https://push2delay.eastmoney.com/api/qt/stock/get?secid=${secid(code)}&fields=${fields}`,
    );
    data = (payload.data ?? {}) as Record<string, unknown>;
  } catch {
    // The quote-detail host often returns an HTML gateway page while the F10
    // classification endpoint remains healthy.  Concept recovery is an
    // independent evidence lane and must still be attempted.
  }
  const primaryConcepts = splitConcepts(data.f129);
  const fallbackConcepts = primaryConcepts.length
    ? []
    : await fetchF10Concepts(code).catch(() => []);
  const value: StockMetadata = {
    code: String(data.f57 ?? code),
    name: String(data.f58 ?? ''),
    industry: data.f127 && data.f127 !== '-' ? String(data.f127) : null,
    concepts: primaryConcepts.length ? primaryConcepts : fallbackConcepts,
    observedAt: new Date().toISOString(),
  };
  metadataCache.set(code, {
    expiresAt: Date.now() + 6 * 60 * 60 * 1000,
    value,
  });
  return value;
}

// Tracking reuses the same exact-date provider contracts and bounded concurrency.
export async function fetchTrackingEvidence(
  codes: string[],
  tradeDate: string,
) {
  const selected = [...new Set(codes)].slice(0, 160);
  const started = Date.now();
  const quotes = await fetchStockChangesAndSpeeds(
    selected,
    tradeDate,
    started + 12_000,
  ).catch(() => new Map<string, StockQuote>());
  const trends: Record<string, IntradayTrend> = {};
  await mapLimit(selected, 6, async (code) => {
    if (Date.now() - started > 25_000) return;
    try {
      const trend = await fetchIntradayTrend(
        { code, secid: secid(code) },
        tradeDate,
      );
      if (!trend.stale) trends[code] = trend;
    } catch {
      /* Missing path is reported per stock, never synthesized. */
    }
  });
  return { quotes, trends, requested: codes.length, selected: selected.length };
}

async function fetchStockChangesAndSpeeds(
  codes: string[],
  tradeDate: string,
  deadline = Infinity,
) {
  const uniqueCodes = [...new Set(codes.filter(Boolean))];
  const batches = Array.from(
    { length: Math.ceil(uniqueCodes.length / 40) },
    (_, index) => uniqueCodes.slice(index * 40, index * 40 + 40),
  );
  const batchMaps = await mapLimit(batches, 2, async (batch) => {
    const quotes = new Map<string, StockQuote>();
    for (const host of ['push2delay.eastmoney.com', 'push2.eastmoney.com']) {
      if (Date.now() > deadline) break;
      const missing = batch.filter((code) => !quoteComplete(quotes.get(code)));
      if (!missing.length) break;
      const params = new URLSearchParams({
        secids: missing.map(secid).join(','),
        fields: 'f12,f3,f6,f22,f124',
        ut: PUBLIC_CLIENT_TOKEN,
        fltt: '2',
        invt: '2',
      });
      try {
        const payload = await fetchJsonOnce(
          `https://${host}/api/qt/ulist.np/get?${params}`,
          7_000,
        );
        const data = (payload.data ?? {}) as Record<string, unknown>;
        const rows = Array.isArray(data.diff) ? (data.diff as ClistRow[]) : [];
        mergeQuoteRows(quotes, rows, missing, tradeDate, host);
      } catch {
        // Try the next public quote host for this batch.
      }
    }
    // Eastmoney's list endpoint can return a valid but very sparse batch. The
    // Tencent quote line is an independent exact-date lane for current price,
    // previous close and amount. It deliberately does not invent speed.
    const tencentMissing = batch.filter(
      (code) => quotes.get(code)?.changePct == null,
    );
    if (tencentMissing.length && Date.now() <= deadline) {
      try {
        const text = await fetchText(
          `https://qt.gtimg.cn/q=${tencentMissing.map(marketSymbol).join(',')}`,
          'https://gu.qq.com/',
          5_000,
        );
        const recovered = parseTencentLiveQuotes(
          text,
          tencentMissing,
          tradeDate,
        );
        for (const [code, quote] of recovered) {
          const prior = quotes.get(code);
          quotes.set(code, {
            changePct: prior?.changePct ?? quote.changePct,
            speedPct: prior?.speedPct ?? null,
            amount: prior?.amount ?? quote.amount,
            quoteTime: quote.quoteTime,
            quoteSource: quote.quoteSource,
          });
        }
      } catch {
        // Keep the Eastmoney rows and expose remaining price gaps downstream.
      }
    }
    // A partial batch is not a complete quote result. Retry only missing codes.
    await mapLimit(
      batch.filter((code) => !quoteComplete(quotes.get(code))),
      4,
      async (code) => {
        if (Date.now() > deadline) return;
        try {
          const payload = await fetchJsonOnce(
            `https://push2delay.eastmoney.com/api/qt/ulist.np/get?secids=${secid(code)}&fltt=2&invt=2&fields=f12,f3,f6,f22,f124`,
            4_000,
          );
          const data = (payload.data ?? {}) as Record<string, unknown>;
          mergeQuoteRows(
            quotes,
            Array.isArray(data.diff) ? (data.diff as ClistRow[]) : [],
            [code],
            tradeDate,
            '东方财富个股补查',
          );
        } catch {
          /* Keep valid rows from the batch. */
        }
        if (
          !quoteComplete(quotes.get(code)) &&
          (tradeDate < shanghaiDate() || shanghaiClock() > '15:00')
        ) {
          const historical = archivedQuote(marketSymbol(code), tradeDate);
          if (historical)
            quotes.set(code, {
              ...historical,
              ...quotes.get(code),
              changePct: quotes.get(code)?.changePct ?? historical.changePct,
            });
        }
      },
    );
    return quotes;
  });
  const merged = new Map<string, StockQuote>();
  for (const batchMap of batchMaps) {
    for (const [code, quote] of batchMap) merged.set(code, quote);
  }
  if (!merged.size && uniqueCodes.length)
    throw new Error('个股涨幅与涨速不可用');
  return merged;
}

function limitBand(code: string, name: string): [number, number] {
  const upperName = name.toUpperCase();
  if (upperName.includes('ST')) return [4.7, 5.6];
  if (code.startsWith('8') || code.startsWith('9')) return [28.5, 31.5];
  if (
    code.startsWith('300') ||
    code.startsWith('301') ||
    code.startsWith('688')
  )
    return [19, 21.5];
  return [9.5, 11.2];
}

export function nominalLimitPct(code: string, name: string): number {
  if (name.toUpperCase().includes('ST')) return 5;
  if (code.startsWith('8') || code.startsWith('9')) return 30;
  if (
    code.startsWith('300') ||
    code.startsWith('301') ||
    code.startsWith('688')
  )
    return 20;
  return 10;
}

export async function fetchRecentLimitHistory(
  code: string,
  name: string,
): Promise<LimitHistory> {
  const cacheKey = `${code}:${name}`;
  const cached = limitHistoryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  try {
    const symbol = marketSymbol(code);
    let closes: Array<{ date: string; close: number }> = [];
    let method = '';
    let primaryError: unknown = null;
    try {
      const payload = await fetchJson(
        `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,,,30,qfq`,
      );
      const security = ((payload.data ?? {}) as Record<string, unknown>)[
        symbol
      ] as Record<string, unknown> | undefined;
      const rows =
        security &&
        (Array.isArray(security.qfqday)
          ? security.qfqday
          : Array.isArray(security.day)
            ? security.day
            : []);
      closes = ((rows as unknown[][] | undefined) ?? [])
        .map((row) => ({ date: String(row[0] ?? ''), close: Number(row[2]) }))
        .filter(
          (row) => row.date && Number.isFinite(row.close) && row.close > 0,
        )
        .slice(-21);
      if (closes.length < 16)
        throw new Error(`腾讯日线覆盖不足 ${closes.length}`);
      method = '腾讯前复权日线相邻收盘涨幅';
    } catch (error) {
      primaryError = error;
      const url = `https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20data=/CN_MarketDataService.getKLineData?symbol=${symbol}&scale=240&ma=no&datalen=50`;
      const text = await fetchText(url, 'https://finance.sina.com.cn/');
      const match = text.match(/var\s+data=\((\[[\s\S]*\])\);?\s*$/);
      if (!match)
        throw new Error(`新浪日线JSONP缺失；腾讯=${String(primaryError)}`);
      const rows = JSON.parse(match[1]) as Array<Record<string, unknown>>;
      closes = rows
        .map((row) => ({
          date: String(row.day ?? ''),
          close: Number(row.close),
        }))
        .filter(
          (row) => row.date && Number.isFinite(row.close) && row.close > 0,
        )
        .slice(-21);
      if (closes.length < 16)
        throw new Error(
          `新浪日线覆盖不足 ${closes.length}；腾讯=${String(primaryError)}`,
        );
      method = '新浪240分钟日线相邻收盘涨幅';
    }
    const [lower, upper] = limitBand(code, name);
    let count = 0;
    for (let index = 1; index < closes.length; index += 1) {
      const pct = (closes[index].close / closes[index - 1].close - 1) * 100;
      if (pct >= lower && pct <= upper) count += 1;
    }
    const value: LimitHistory = {
      count,
      sessions: Math.max(0, closes.length - 1),
      status: closes.length >= 20 ? 'READY' : 'DEGRADED',
      method: `${method}落入对应板制区间；新股无涨跌幅限制日不计`,
    };
    limitHistoryCache.set(cacheKey, {
      expiresAt: Date.now() + 6 * 60 * 60 * 1000,
      value,
    });
    return value;
  } catch (error) {
    const value: LimitHistory = {
      count: null,
      sessions: 0,
      status: 'MISSING',
      method: '日线不可用',
      reason: String(error),
    };
    limitHistoryCache.set(cacheKey, {
      expiresAt: Date.now() + 30 * 1000,
      value,
    });
    return value;
  }
}

function shanghaiMarketPhase(value = new Date()): string {
  const clock = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(value);
  if (clock < '09:30') return '盘前';
  if (clock <= '11:30') return '上午盘';
  if (clock < '13:00') return '午间休市';
  if (clock <= '15:00') return '下午盘';
  return '收盘后';
}

async function fetchSectorFlowSeries(
  board: {
    code: string;
    name: string;
    changePct: number | null;
  },
  tradeDate: string,
): Promise<SectorFlowSeries> {
  const params = new URLSearchParams({
    lmt: '0',
    klt: '1',
    secid: `90.${board.code}`,
    fields1: 'f1,f2,f3,f7',
    fields2: 'f51,f52,f53,f54,f55,f56',
    ut: PUBLIC_CLIENT_TOKEN,
  });
  const failures: string[] = [];
  let payload: Record<string, unknown> | null = null;
  for (const host of ['push2delay.eastmoney.com', 'push2his.eastmoney.com']) {
    try {
      payload = await fetchJson(
        `https://${host}/api/qt/stock/fflow/kline/get?${params}`,
        12_000,
      );
      const data = (payload.data ?? {}) as Record<string, unknown>;
      if (Array.isArray(data.klines) && data.klines.length) break;
      failures.push(`${host}:分时为空`);
      payload = null;
    } catch (error) {
      failures.push(`${host}:${String(error)}`);
    }
  }
  if (!payload)
    throw new Error(`${board.name}分时不可用 ${failures.join(' | ')}`);
  const data = (payload.data ?? {}) as Record<string, unknown>;
  const points = (data.klines as string[])
    .map((row) => {
      const [stamp, main] = String(row).split(',');
      const rowDate = stamp.slice(0, 10).replaceAll('-', '');
      const value = Number(main);
      if (rowDate !== tradeDate || !Number.isFinite(value)) return null;
      return { time: stamp.slice(11, 16), mainNetInflow: value };
    })
    .filter(Boolean) as SectorFlowPoint[];
  if (!points.length)
    throw new Error(`${board.name}未返回${tradeDate}的分钟资金`);
  const latest = points.at(-1)?.mainNetInflow ?? 0;
  const observation = observeFundFlow(points);
  return {
    ...board,
    latestMainNetInflow: latest,
    delta5m: observation.delta5m,
    delta15m: observation.delta15m,
    delta30m: observation.delta30m,
    persistenceLabel: observation.label,
    flowObservation: observation,
    points,
  };
}

async function fetchSectorFlowDetail(series: SectorFlowSeries) {
  const direction: 0 | 1 = series.latestMainNetInflow >= 0 ? 1 : 0;
  const members = await fetchClist({
    fs: `b:${series.code}`,
    fid: 'f62',
    order: direction,
    pageSize: 100,
    fields: 'f12,f14,f3,f22,f62,f6,f100',
  });
  const rows = members.rows
    .map((row) => ({
      code: String(row.f12 ?? ''),
      name: String(row.f14 ?? ''),
      industry: String(row.f100 ?? '未知') || '未知',
      changePct: numberOrNull(row.f3),
      speedPct: numberOrNull(row.f22),
      mainNetInflow: numberOrNull(row.f62),
    }))
    .filter((row) => row.code && row.name);
  const sameFlow = rows.filter((row) =>
    series.latestMainNetInflow >= 0
      ? (row.mainNetInflow ?? 0) > 0
      : (row.mainNetInflow ?? 0) < 0,
  );
  const representatives = (sameFlow.length ? sameFlow : rows).slice(0, 4);
  const industryMap = new Map<string, typeof rows>();
  for (const row of rows)
    industryMap.set(row.industry, [
      ...(industryMap.get(row.industry) ?? []),
      row,
    ]);
  const subgroups = [...industryMap.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 4)
    .map(([name, items]) => ({
      name,
      count: items.length,
      leaders: items.slice(0, 3).map((item) => item.name),
    }));
  return {
    detailState:
      !members.stale && rows.length >= Math.min(members.total, 100)
        ? ('READY' as DataState)
        : ('DEGRADED' as DataState),
    detailBasis: `${members.stale ? '同交易日快照·' : ''}资金同向成分样本${rows.length}/${members.total}只`,
    subgroups,
    representatives,
  };
}

async function buildFlowSnapshot(): Promise<FlowSnapshot> {
  const marketDate = await getMarketDateContext();
  const tradeDate = marketDate.tradeDate;
  const [topFlow, bottomFlow] = await Promise.all([
    fetchClist({
      fs: 'm:90+t:3',
      fid: 'f62',
      order: 1,
      pageSize: 8,
      fields: 'f12,f14,f3,f62',
    }),
    fetchClist({
      fs: 'm:90+t:3',
      fid: 'f62',
      order: 0,
      pageSize: 8,
      fields: 'f12,f14,f3,f62',
    }),
  ]);
  const boards = [...topFlow.rows, ...bottomFlow.rows]
    .map((row) => ({
      code: String(row.f12 ?? ''),
      name: String(row.f14 ?? ''),
      changePct: numberOrNull(row.f3),
      mainNetInflow: numberOrNull(row.f62),
    }))
    .filter((row) => row.code && row.name && row.mainNetInflow !== null);
  const candidates = boards.map(({ code, name, changePct }) => ({
    code,
    name,
    changePct,
  }));
  const settled = await mapLimit(candidates, 4, async (board) => {
    try {
      return await fetchSectorFlowSeries(board, tradeDate);
    } catch {
      return null;
    }
  });
  const baseSeries = settled.filter(Boolean) as SectorFlowSeries[];
  const details = await mapLimit(baseSeries, 4, async (item) => {
    try {
      return await fetchSectorFlowDetail(item);
    } catch {
      return {
        detailState: 'MISSING' as DataState,
        detailBasis: '细分成分暂时不可用',
        subgroups: [],
        representatives: [],
      };
    }
  });
  const series = baseSeries.map((item, index) => ({
    ...item,
    ...details[index],
  }));
  const splitReady = series.filter((item) => item.delta5m !== null);
  const inflow = [...splitReady]
    .filter((item) => (item.delta5m ?? 0) > 0)
    .sort((a, b) => (b.delta5m ?? 0) - (a.delta5m ?? 0))
    .slice(0, 6);
  const outflow = [...splitReady]
    .filter((item) => (item.delta5m ?? 0) < 0)
    .sort((a, b) => (a.delta5m ?? 0) - (b.delta5m ?? 0))
    .slice(0, 6);
  const cumulativeInflow = [...series]
    .filter((item) => item.latestMainNetInflow > 0)
    .sort((a, b) => b.latestMainNetInflow - a.latestMainNetInflow)
    .slice(0, 6);
  const cumulativeOutflow = [...series]
    .filter((item) => item.latestMainNetInflow < 0)
    .sort((a, b) => a.latestMainNetInflow - b.latestMainNetInflow)
    .slice(0, 6);
  const persistentStrong = [...series]
    .filter((item) => item.latestMainNetInflow > 0 && (item.changePct ?? 0) > 0)
    .map((item) => ({
      ...item,
      persistenceLabel: observeFundFlow(item.points).label,
      flowObservation: observeFundFlow(item.points),
    }))
    .sort((a, b) => {
      const rankA = a.delta30m === null ? 1 : a.delta30m > 0 ? 0 : 2;
      const rankB = b.delta30m === null ? 1 : b.delta30m > 0 ? 0 : 2;
      return rankA - rankB || b.latestMainNetInflow - a.latestMainNetInflow;
    })
    .slice(0, 6);
  const persistentWeak = [...series]
    .filter((item) => item.latestMainNetInflow < 0 && (item.changePct ?? 0) < 0)
    .map((item) => ({
      ...item,
      persistenceLabel: observeFundFlow(item.points).label,
      flowObservation: observeFundFlow(item.points),
    }))
    .sort((a, b) => {
      const rankA = a.delta30m === null ? 1 : a.delta30m < 0 ? 0 : 2;
      const rankB = b.delta30m === null ? 1 : b.delta30m < 0 ? 0 : 2;
      return rankA - rankB || a.latestMainNetInflow - b.latestMainNetInflow;
    })
    .slice(0, 6);
  const curveState: DataState =
    series.length === candidates.length
      ? 'READY'
      : series.length
        ? 'DEGRADED'
        : 'MISSING';
  const splitState: DataState =
    splitReady.length === series.length && splitReady.length > 0
      ? 'READY'
      : splitReady.length
        ? 'DEGRADED'
        : 'MISSING';
  const sourceStale = Boolean(topFlow.stale || bottomFlow.stale);
  const value: FlowSnapshot = {
    status:
      curveState === 'READY' && splitState === 'READY' && !sourceStale
        ? 'READY'
        : series.length
          ? 'DEGRADED'
          : 'MISSING',
    curveState: sourceStale && curveState === 'READY' ? 'DEGRADED' : curveState,
    splitState: sourceStale && splitState === 'READY' ? 'DEGRADED' : splitState,
    retrievedAt: new Date().toISOString(),
    tradeDate,
    phase: marketDate.phase,
    requestedDate: marketDate.requestedDate,
    sessionState: marketDate.sessionState,
    lastPointTime:
      series
        .flatMap((item) => item.points.map((point) => point.time))
        .sort()
        .at(-1) ?? null,
    source: '东方财富公开概念板块与主力资金分钟序列',
    sourceState: sourceStale ? 'STALE' : marketDate.sourceState,
    reason: sourceStale
      ? '资金排名端点短暂波动，已使用同交易日最近快照'
      : undefined,
    basis:
      '曲线为供应商累计主力净流入统计；按真实连续交易分钟计算增量，再看不重叠5分钟段的前后方向。转向延续只描述已发生的资金统计，不确认情绪反转或个股带动；概念重叠不作资金守恒解释。',
    coverage: { requested: candidates.length, available: series.length },
    series,
    split: {
      inflow,
      outflow,
      cumulativeInflow,
      cumulativeOutflow,
      persistentStrong,
      persistentWeak,
      positiveCount: splitReady.filter((item) => (item.delta5m ?? 0) > 0)
        .length,
      negativeCount: splitReady.filter((item) => (item.delta5m ?? 0) < 0)
        .length,
    },
  };
  flowSnapshotCache = { expiresAt: Date.now() + 45_000, value };
  return value;
}

export async function getFlowSnapshot(): Promise<FlowSnapshot> {
  if (flowSnapshotCache && flowSnapshotCache.expiresAt > Date.now())
    return flowSnapshotCache.value;
  if (flowSnapshotPending) return flowSnapshotPending;
  flowSnapshotPending = buildFlowSnapshot();
  try {
    return await flowSnapshotPending;
  } finally {
    flowSnapshotPending = null;
  }
}

async function fetchIntradayTrend(
  instrument: { code: string; secid: string },
  tradeDate: string,
): Promise<IntradayTrend> {
  const key = `${tradeDate}:${instrument.secid}`;
  const cached = trendCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (tradeDate < shanghaiDate() || shanghaiClock() > '15:00') {
    const symbol =
      instrument.secid === '1.000001'
        ? 'sh000001'
        : marketSymbol(instrument.code);
    const historical = archivedTrend(symbol, tradeDate);
    if (historical) return historical;
  }
  if ((trendFailures.get(key) ?? 0) > Date.now())
    throw new Error('该交易日分钟价格暂不可用');
  const pending = trendPending.get(key);
  if (pending) return pending;
  const request = fetchIntradayTrendUncached(instrument, tradeDate)
    .catch((error) => {
      trendFailures.set(key, Date.now() + 30_000);
      throw error;
    })
    .finally(() => trendPending.delete(key));
  trendPending.set(key, request);
  return request;
}

async function fetchIntradayTrendUncached(
  instrument: { code: string; secid: string },
  tradeDate: string,
): Promise<IntradayTrend> {
  const cacheKey = `${tradeDate}:${instrument.secid}`;
  const cached = trendCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const params = new URLSearchParams({
    secid: instrument.secid,
    fields1: 'f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13',
    fields2: 'f51,f52,f53,f54,f55,f56,f57,f58',
    ndays: '1',
    iscr: '0',
    iscca: '0',
    ut: PUBLIC_CLIENT_TOKEN,
  });
  const failures: string[] = [];
  for (const host of ['push2his.eastmoney.com', 'push2delay.eastmoney.com']) {
    try {
      const payload = await fetchJsonOnce(
        `https://${host}/api/qt/stock/trends2/get?${params}`,
        7_000,
      );
      const data = (payload.data ?? {}) as Record<string, unknown>;
      const points = parseTrendPoints(
        Array.isArray(data.trends) ? data.trends : [],
        tradeDate,
      );
      if (!points.length) throw new Error(`未返回${tradeDate}的分钟价格`);
      const value: IntradayTrend = {
        code: String(data.code ?? instrument.code),
        name: String(data.name ?? instrument.code),
        preClose: numberOrNull(data.preClose),
        points,
        stale: false,
      };
      trendCache.set(cacheKey, {
        expiresAt: Date.now() + 45_000,
        staleUntil: Date.now() + 5 * 60_000,
        value,
      });
      return value;
    } catch (error) {
      failures.push(`${host}:${String(error)}`);
    }
  }
  if (cached && cached.staleUntil > Date.now())
    return { ...cached.value, stale: true };
  throw new Error(`分钟价格不可用 ${failures.join(' | ')}`);
}

type TimelineBoard = {
  code: string;
  name: string;
  changePct: number | null;
  mainNetInflow: number | null;
};

type TimelineCandidate = {
  kind: 'START' | 'STRONG' | 'CASHOUT' | 'WEAKEN' | 'OBSERVE';
  label: '启动' | '延续强势' | '兑现' | '走弱' | '震荡观察';
  sector: TimelineBoard;
  windowStartTime: string;
  time: string;
  sectorAtTimeChangePct: number | null;
  sectorWindowChangePct: number;
  flowDelta: number;
  flowPreviousDelta: number;
  flowAcceleration: number;
  turnReason: 'FLOW_REVERSAL' | 'FLOW_ACCELERATION';
  turnScore: number;
};

async function fetchTimelineBoards() {
  const ranked = await Promise.allSettled([
    fetchClist({
      fs: 'm:90+t:3',
      fid: 'f22',
      order: 1,
      pageSize: 12,
      fields: 'f12,f14,f3,f22,f62',
    }),
    fetchClist({
      fs: 'm:90+t:3',
      fid: 'f22',
      order: 0,
      pageSize: 12,
      fields: 'f12,f14,f3,f22,f62',
    }),
    fetchClist({
      fs: 'm:90+t:3',
      fid: 'f3',
      order: 1,
      pageSize: 12,
      fields: 'f12,f14,f3,f22,f62',
    }),
    fetchClist({
      fs: 'm:90+t:3',
      fid: 'f3',
      order: 0,
      pageSize: 12,
      fields: 'f12,f14,f3,f22,f62',
    }),
  ]);
  const successful = ranked
    .filter(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof fetchClist>>
      > => result.status === 'fulfilled',
    )
    .map((result) => result.value);
  if (!successful.length) throw new Error('板块排名端点暂时不可用');
  const selected = new Map<string, TimelineBoard>();
  for (let rank = 0; rank < 12 && selected.size < 14; rank += 1) {
    for (const result of successful) {
      const row = result.rows[rank];
      if (!row) continue;
      const code = String(row.f12 ?? '');
      const name = String(row.f14 ?? '');
      if (
        !code ||
        !name ||
        /^(MSCI中国|融资融券|富时罗素|破增发价股|历史新高|近期新高|百元股|2026中报预增|科技风格|昨日.*)$/.test(
          name,
        )
      )
        continue;
      selected.set(code, {
        code,
        name,
        changePct: numberOrNull(row.f3),
        mainNetInflow: numberOrNull(row.f62),
      });
      if (selected.size >= 14) break;
    }
  }
  return {
    boards: [...selected.values()],
    stale: successful.some((result) => result.stale),
  };
}

function detectFlowTimelineCandidates(
  items: Array<{
    sector: TimelineBoard;
    trend: IntradayTrend;
    flow: SectorFlowSeries;
  }>,
) {
  const timeNumber = (time: string) =>
    Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const raw: TimelineCandidate[] = [];

  for (const { sector, trend, flow } of items) {
    if (flow.points.length < 9) continue;
    const threeMinuteDeltas = flow.points
      .slice(3)
      .map(
        (point, offset) =>
          point.mainNetInflow - flow.points[offset].mainNetInflow,
      );
    const scaleValues = threeMinuteDeltas.map(Math.abs).sort((a, b) => a - b);
    const scale = Math.max(
      scaleValues[Math.floor(scaleValues.length * 0.6)] ?? 0,
      1_000_000,
    );
    const signals = flow.points.slice(6).map((point, offset) => {
      const index = offset + 6;
      const recent = point.mainNetInflow - flow.points[index - 3].mainNetInflow;
      const previous =
        flow.points[index - 3].mainNetInflow -
        flow.points[index - 6].mainNetInflow;
      const acceleration = recent - previous;
      const reversal =
        (previous <= 0 && recent > 0) || (previous >= 0 && recent < 0);
      const significant = reversal
        ? Math.abs(recent) >= scale * 0.75 &&
          Math.abs(acceleration) >= scale * 1.1
        : Math.abs(recent) >= scale * 1.5 &&
          Math.abs(acceleration) >= scale * 0.9;
      return {
        index,
        time: point.time,
        recent,
        previous,
        acceleration,
        reversal,
        significant,
        score: Math.abs(acceleration) / scale + Math.abs(recent) / scale,
      };
    });
    const localTurns = signals.filter((signal, index) => {
      if (!signal.significant) return false;
      const neighbors = signals.slice(Math.max(0, index - 2), index + 3);
      return signal.score >= Math.max(...neighbors.map((item) => item.score));
    });
    const sectorTurns: typeof localTurns = [];
    for (const signal of localTurns) {
      const previous = sectorTurns.at(-1);
      if (
        previous &&
        timeNumber(signal.time) - timeNumber(previous.time) < 12
      ) {
        if (signal.score > previous.score)
          sectorTurns[sectorTurns.length - 1] = signal;
      } else {
        sectorTurns.push(signal);
      }
    }
    for (const signal of sectorTurns) {
      const priceWindow = trendWindow(
        trend,
        flow.points[signal.index - 3].time,
        signal.time,
      );
      raw.push({
        kind: 'OBSERVE',
        label: '震荡观察',
        sector,
        windowStartTime: flow.points[signal.index - 3].time,
        time: signal.time,
        sectorAtTimeChangePct: priceWindow.changePct,
        sectorWindowChangePct: priceWindow.windowChangePct ?? 0,
        flowDelta: signal.recent,
        flowPreviousDelta: signal.previous,
        flowAcceleration: signal.acceleration,
        turnReason: signal.reversal ? 'FLOW_REVERSAL' : 'FLOW_ACCELERATION',
        turnScore: signal.score,
      });
    }
  }

  const selected: TimelineCandidate[] = [];
  for (const candidate of [...raw].sort((a, b) => b.turnScore - a.turnScore)) {
    const candidateMinute = timeNumber(candidate.time);
    if (
      selected.some(
        (item) =>
          item.sector.code === candidate.sector.code &&
          Math.abs(timeNumber(item.time) - candidateMinute) < 20,
      )
    )
      continue;
    if (
      selected.filter(
        (item) => Math.abs(timeNumber(item.time) - candidateMinute) <= 3,
      ).length >= 2
    )
      continue;
    selected.push(candidate);
    if (selected.length >= 24) break;
  }

  const directionBySector = new Map<string, 'up' | 'down'>();
  return selected
    .sort((a, b) => a.time.localeCompare(b.time) || b.turnScore - a.turnScore)
    .map((candidate) => {
      const direction = candidate.flowDelta >= 0 ? 'up' : 'down';
      const previousDirection = directionBySector.get(candidate.sector.code);
      directionBySector.set(candidate.sector.code, direction);
      if (direction === 'up') {
        return {
          ...candidate,
          kind:
            previousDirection === 'up'
              ? ('STRONG' as const)
              : ('START' as const),
          label:
            previousDirection === 'up'
              ? ('延续强势' as const)
              : ('启动' as const),
        };
      }
      return {
        ...candidate,
        kind:
          previousDirection === 'up'
            ? ('CASHOUT' as const)
            : ('WEAKEN' as const),
        label:
          previousDirection === 'up' ? ('兑现' as const) : ('走弱' as const),
      };
    });
}

function timelineContextKey(candidate: TimelineCandidate) {
  return `${candidate.sector.code}:${candidate.flowDelta >= 0 ? 'up' : 'down'}`;
}

async function fetchTimelineMembers(candidate: TimelineCandidate) {
  const direction: 0 | 1 = candidate.flowDelta >= 0 ? 1 : 0;
  const members = await fetchClist({
    fs: `b:${candidate.sector.code}`,
    fid: 'f3',
    order: direction,
    pageSize: 12,
    fields: 'f12,f14,f3,f22,f62,f100',
  });
  const relatedStocks: MarketTimelineRelatedStock[] = members.rows
    .map((row) => ({
      code: String(row.f12 ?? ''),
      name: String(row.f14 ?? ''),
      industry: String(row.f100 ?? '未知') || '未知',
      changePct: numberOrNull(row.f3),
      speedPct: numberOrNull(row.f22),
      mainNetInflow: numberOrNull(row.f62),
    }))
    .filter((row) => row.code && row.name);
  return { relatedStocks, stale: Boolean(members.stale) };
}

async function confirmTimelineDrivers(
  candidate: Pick<TimelineCandidate, 'windowStartTime' | 'time' | 'flowDelta'>,
  relatedStocks: MarketTimelineRelatedStock[],
  tradeDate: string,
) {
  const drivers = await mapLimit(
    [...new Map(relatedStocks.map((stock) => [stock.code, stock])).values()],
    6,
    async (row): Promise<MarketTimelineDriver> => {
      try {
        const trend = await fetchIntradayTrend(
          { code: row.code, secid: secid(row.code) },
          tradeDate,
        );
        const {
          changePct: atTimeChangePct,
          windowChangePct,
          price,
        } = trendWindow(trend, candidate.windowStartTime, candidate.time);
        const aligns =
          windowChangePct !== null &&
          (candidate.flowDelta >= 0
            ? windowChangePct > 0
            : windowChangePct < 0);
        const role: MarketTimelineDriver['role'] =
          windowChangePct === null
            ? '同窗窗口缺口'
            : windowChangePct === 0
              ? '同窗价格持平'
              : aligns
                ? '同窗价格确认'
                : '同窗方向相反';
        return {
          code: row.code,
          name: row.name,
          industry: row.industry,
          mainNetInflow: row.mainNetInflow,
          atTimeChangePct,
          windowChangePct,
          limitState: priceLimitState(
            row.code,
            row.name,
            price,
            trend.preClose,
          ),
          role,
        };
      } catch {
        return {
          code: row.code,
          name: row.name,
          industry: row.industry,
          mainNetInflow: row.mainNetInflow,
          atTimeChangePct: null,
          windowChangePct: null,
          limitState: 'UNKNOWN',
          role: '分钟价格不可用',
        };
      }
    },
  );
  const sortedDrivers = drivers.sort((a, b) => {
    const role =
      Number(b.role === '同窗价格确认') - Number(a.role === '同窗价格确认');
    return (
      role || Math.abs(b.mainNetInflow ?? 0) - Math.abs(a.mainNetInflow ?? 0)
    );
  });
  return sortedDrivers;
}

export async function getMarketTimelineSnapshot(): Promise<MarketTimelineSnapshot> {
  if (timelineSnapshotCache && timelineSnapshotCache.expiresAt > Date.now())
    return timelineSnapshotCache.value;
  const marketDate = await getMarketDateContext();
  const tradeDate = marketDate.tradeDate;
  const ranked = await fetchTimelineBoards();
  const [boardTrendResults, indexSettled] = await Promise.all([
    mapLimit(ranked.boards, 4, async (board) => {
      const [trend, flow] = await Promise.allSettled([
        fetchIntradayTrend(
          { code: board.code, secid: `90.${board.code}` },
          tradeDate,
        ),
        fetchSectorFlowSeries(board, tradeDate),
      ]);
      if (trend.status !== 'fulfilled' || flow.status !== 'fulfilled')
        return null;
      return { sector: board, trend: trend.value, flow: flow.value };
    }),
    Promise.allSettled([
      fetchIntradayTrend({ code: '000001', secid: '1.000001' }, tradeDate),
      fetchIntradayTrend({ code: '399006', secid: '0.399006' }, tradeDate),
    ]),
  ]);
  const boardSignals = boardTrendResults.filter(Boolean) as Array<{
    sector: TimelineBoard;
    trend: IntradayTrend;
    flow: SectorFlowSeries;
  }>;
  const candidates = detectFlowTimelineCandidates(boardSignals);
  const indices = indexSettled
    .filter(
      (result): result is PromiseFulfilledResult<IntradayTrend> =>
        result.status === 'fulfilled',
    )
    .map((result) => result.value);
  const contextCandidates = [
    ...candidates
      .reduce((contexts, candidate) => {
        const key = timelineContextKey(candidate);
        if (!contexts.has(key)) contexts.set(key, candidate);
        return contexts;
      }, new Map<string, TimelineCandidate>())
      .entries(),
  ];
  const contextResults = await mapLimit(
    contextCandidates,
    6,
    async ([key, candidate]): Promise<
      readonly [
        string,
        { relatedStocks: MarketTimelineRelatedStock[]; stale: boolean },
      ]
    > => {
      try {
        return [key, await fetchTimelineMembers(candidate)] as const;
      } catch {
        return [key, { relatedStocks: [], stale: false }] as const;
      }
    },
  );
  const contexts = new Map(contextResults);
  const uniqueMembers = [
    ...new Map(
      [...contexts.values()]
        .flatMap((context) => context.relatedStocks)
        .map((stock) => [stock.code, stock]),
    ).values(),
  ];
  await mapLimit(uniqueMembers, 8, async (stock) => {
    await fetchIntradayTrend(
      { code: stock.code, secid: secid(stock.code) },
      tradeDate,
    ).catch(() => null);
  });
  const driverGroups = await mapLimit(candidates, 6, async (candidate) => {
    try {
      return await confirmTimelineDrivers(
        candidate,
        contexts.get(timelineContextKey(candidate))?.relatedStocks ?? [],
        tradeDate,
      );
    } catch {
      return [];
    }
  });
  const events: MarketTimelineEvent[] = candidates.map((candidate, index) => {
    const drivers = driverGroups[index];
    const relatedStocks =
      contexts.get(timelineContextKey(candidate))?.relatedStocks ?? [];
    const confirmed = drivers.filter(
      (driver) => driver.role === '同窗价格确认',
    ).length;
    const checked = drivers.filter(
      (driver) => driver.windowChangePct !== null,
    ).length;
    return {
      id: `${candidate.sector.code}-${candidate.kind}-${candidate.time}`,
      kind: candidate.kind,
      label: candidate.label,
      sectorCode: candidate.sector.code,
      sectorName: candidate.sector.name,
      windowStartTime: candidate.windowStartTime,
      time: candidate.time,
      sectorChangePct: candidate.sector.changePct,
      sectorDailyFlow: candidate.sector.mainNetInflow ?? 0,
      sectorAtTimeChangePct: candidate.sectorAtTimeChangePct,
      sectorWindowChangePct: candidate.sectorWindowChangePct,
      flowDelta: candidate.flowDelta,
      flowPreviousDelta: candidate.flowPreviousDelta,
      flowAcceleration: candidate.flowAcceleration,
      turnReason: candidate.turnReason,
      indices: indices.map((marketIndex) => ({
        code: marketIndex.code,
        name: marketIndex.name,
        ...trendWindow(marketIndex, candidate.windowStartTime, candidate.time),
      })),
      drivers,
      relatedStocks,
      driverState:
        checked === drivers.length &&
        drivers.length > 0 &&
        drivers.every((driver) => driver.atTimeChangePct !== null) &&
        indices.length === 2
          ? 'READY'
          : drivers.length
            ? 'DEGRADED'
            : 'MISSING',
      driverBasis:
        confirmed > 0
          ? `资金转折3分钟同窗价格确认${confirmed}/${drivers.length}只；下方扩展股为当日最新异动，不冒充事件时点因果`
          : checked > 0
            ? `已核验${checked}/${drivers.length}只同窗价格，但未与该节点资金方向同向；这是方向不一致，不是价格未确认`
            : drivers.length
              ? `已尝试核验${drivers.length}只，但该时窗分钟价格存在缺口或行情端点不可用`
              : '板块成分股列表暂时不可用，未能发起同窗价格核验',
    };
  });
  const confirmedDrivers = events
    .flatMap((event) => event.drivers)
    .filter((driver) => driver.role === '同窗价格确认').length;
  const checkedDrivers = events
    .flatMap((event) => event.drivers)
    .filter((driver) => driver.windowChangePct !== null).length;
  const sourceStale =
    ranked.stale ||
    indices.some((item) => item.stale) ||
    boardSignals.some((item) => item.trend.stale) ||
    [...contexts.values()].some((item) => item.stale);
  const status: DataState =
    events.length &&
    indices.length === 2 &&
    events.every((event) => event.relatedStocks.length) &&
    events.every((event) => event.driverState === 'READY') &&
    !sourceStale
      ? 'READY'
      : events.length
        ? 'DEGRADED'
        : 'MISSING';
  const value: MarketTimelineSnapshot = {
    evidenceVersion: 2,
    status,
    retrievedAt: new Date().toISOString(),
    tradeDate,
    phase: marketDate.phase,
    requestedDate: marketDate.requestedDate,
    sessionState: marketDate.sessionState,
    lastPointTime:
      boardSignals
        .flatMap((item) => item.flow.points.map((point) => point.time))
        .sort()
        .at(-1) ?? null,
    source: '东方财富公开板块分钟资金、板块/指数/个股分钟价格序列',
    sourceState: sourceStale ? 'STALE' : marketDate.sourceState,
    reason: sourceStale
      ? '部分分钟端点短暂波动，已使用同交易日最近快照'
      : undefined,
    basis:
      '按资金方向反转和流入/流出加速记录节点，不使用固定时间点。逐一核验已召回成分股的节点分钟收盘价，涨停/跌停按前收盘价计算的涨跌停价格确认；当天后续涨停不回填到早先节点。方向相反与行情缺失分开统计。',
    coverage: {
      sectors: boardSignals.length,
      events: events.length,
      timeNodes: new Set(events.map((event) => event.time)).size,
      indices: indices.length,
      checkedDrivers,
      confirmedDrivers,
      relatedStocks: new Set(
        events.flatMap((event) =>
          event.relatedStocks.map((stock) => stock.code),
        ),
      ).size,
    },
    events,
  };
  timelineSnapshotCache = { expiresAt: Date.now() + 45_000, value };
  return value;
}

const archivedTimelineRepairs = new Map<
  string,
  CacheRecord<MarketTimelineSnapshot>
>();

export async function repairArchivedTimeline(snapshot: MarketTimelineSnapshot) {
  const key = `${snapshot.tradeDate}:${snapshot.retrievedAt}`;
  const cached = archivedTimelineRepairs.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const members = [
    ...new Map(
      snapshot.events
        .flatMap((event) => event.relatedStocks ?? [])
        .map((stock) => [stock.code, stock]),
    ).values(),
  ];
  await mapLimit(members, 8, async (stock) => {
    await fetchIntradayTrend(
      { code: stock.code, secid: secid(stock.code) },
      snapshot.tradeDate,
    ).catch(() => null);
  });
  const indices = await Promise.all([
    fetchIntradayTrend(
      { code: '000001', secid: '1.000001' },
      snapshot.tradeDate,
    ).catch(() => null),
    fetchIntradayTrend(
      { code: '399006', secid: '0.399006' },
      snapshot.tradeDate,
    ).catch(() => null),
  ]);
  const events = await mapLimit(snapshot.events, 6, async (event) => {
    const related = event.relatedStocks ?? [];
    const drivers = await confirmTimelineDrivers(
      event,
      related,
      snapshot.tradeDate,
    );
    const checked = drivers.filter(
      (driver) =>
        driver.atTimeChangePct !== null && driver.windowChangePct !== null,
    ).length;
    const indexRows = indices
      .filter((index): index is IntradayTrend => index !== null)
      .map((index) => ({
        code: index.code,
        name: index.code === '000001' ? '上证指数' : '创业板指',
        ...trendWindow(index, event.windowStartTime, event.time),
      }));
    const indexReady =
      indexRows.length === 2 &&
      indexRows.every(
        (index) => index.changePct !== null && index.windowChangePct !== null,
      );
    return {
      ...event,
      drivers,
      indices: indexRows,
      driverState: (drivers.length && checked === drivers.length && indexReady
        ? 'READY'
        : drivers.length
          ? 'DEGRADED'
          : 'MISSING') as DataState,
      driverBasis: `节点行情完整${checked}/${drivers.length}只；逐一核验同日分钟收盘价，后续涨停不提前回填`,
    };
  });
  const checked = events
    .flatMap((event) => event.drivers)
    .filter(
      (driver) =>
        driver.atTimeChangePct !== null && driver.windowChangePct !== null,
    ).length;
  const requested = events.reduce(
    (sum, event) => sum + event.drivers.length,
    0,
  );
  const complete =
    events.length > 0 && events.every((event) => event.driverState === 'READY');
  const value: MarketTimelineSnapshot = {
    ...snapshot,
    evidenceVersion: 2,
    events,
    status: complete && snapshot.sourceState !== 'STALE' ? 'READY' : 'DEGRADED',
    reason: complete
      ? undefined
      : `节点个股分钟行情完整${checked}/${requested}条；缺失项保留空值`,
    coverage: {
      ...snapshot.coverage,
      checkedDrivers: checked,
      confirmedDrivers: events
        .flatMap((event) => event.drivers)
        .filter((driver) => driver.role === '同窗价格确认').length,
    },
  };
  archivedTimelineRepairs.set(key, {
    expiresAt: Date.now() + (complete ? 300_000 : 45_000),
    value,
  });
  return value;
}

async function fetchPool(
  pool: 'ZTPool' | 'ZBPool' | 'DTPool',
  tradeDate: string,
) {
  const params = new URLSearchParams({
    ut: PUBLIC_CLIENT_TOKEN,
    dpt: 'wz.ztzt',
    Pageindex: '0',
    pagesize: '1000',
    sort: pool === 'DTPool' ? 'fund:asc' : 'fbt:asc',
    date: tradeDate,
  });
  const payload = await fetchJson(
    `https://push2ex.eastmoney.com/getTopic${pool}?${params}`,
  );
  const data = (payload.data ?? {}) as Record<string, unknown>;
  return {
    qdate: String(data.qdate ?? ''),
    rows: Array.isArray(data.pool) ? (data.pool as PoolRow[]) : [],
  };
}

export async function getMarketDateContext(): Promise<MarketDateContext> {
  if (marketDateContextCache && marketDateContextCache.expiresAt > Date.now())
    return marketDateContextCache.value;
  const requestedDate = shanghaiDate();
  const pool = await fetchPool('ZTPool', requestedDate);
  const providerDate = String(pool.qdate ?? '').replace(/\D/g, '');
  if (!/^\d{8}$/.test(providerDate)) throw new Error('行情源未返回有效交易日');
  const isCurrentTradeDate = providerDate === requestedDate;
  const value: MarketDateContext = {
    requestedDate,
    tradeDate: providerDate,
    phase: isCurrentTradeDate ? shanghaiMarketPhase() : '休市快照',
    sessionState:
      isCurrentTradeDate &&
      shanghaiClock() >= '09:15' &&
      shanghaiClock() <= '15:00'
        ? 'LIVE'
        : 'CLOSED',
    sourceState: isCurrentTradeDate ? 'LIVE' : 'ARCHIVED',
  };
  marketDateContextCache = { expiresAt: Date.now() + 30_000, value };
  return value;
}

async function previousTradingPool(tradeDate: string) {
  const attempts: Array<{ date: string; qdate: string; rows: number }> = [];
  const closeHistory = await loadCloseHistory().catch(
    () => CLOSE_HISTORY.snapshots,
  );
  const sessions = await verifiedTradingSessions();
  const candidate = sessions.filter((date) => date < tradeDate).at(-1);
  if (!candidate) throw new Error(`未找到${tradeDate}之前的已验证交易日`);
  const archived = closeHistory.find(
    (snapshot) =>
      snapshot.date.replaceAll('-', '') === candidate &&
      snapshot.cutoff === '15:00' &&
      snapshot.status === 'READY',
  );
  if (archived) {
    return {
      tradeDate: candidate,
      rows: archived.ladders.flatMap((level) =>
        level.stocks.map((stock) => ({
          c: stock.code,
          n: stock.name,
          lbc: stock.height,
          hybk: stock.industry,
        })),
      ) as PoolRow[],
      providerQdate: '',
      dateState: 'READY' as DataState,
    };
  }
  const pool = await fetchPool('ZTPool', candidate);
  attempts.push({ date: candidate, qdate: pool.qdate, rows: pool.rows.length });
  if (pool.rows.length && pool.qdate === candidate) {
    return {
      tradeDate: candidate,
      rows: pool.rows,
      providerQdate: pool.qdate,
      dateState: 'READY' as DataState,
    };
  }
  throw new Error(
    `已验证上一交易日${candidate}的涨停池未获精确日期确认 ${JSON.stringify(attempts)}`,
  );
}

async function verifiedTradingSessions(): Promise<string[]> {
  if (verifiedSessionCache && verifiedSessionCache.expiresAt > Date.now())
    return verifiedSessionCache.value;
  const fallback = (tradingCalendarDocument.dates ?? [])
    .map((date) => String(date).replaceAll('-', ''))
    .filter((date) => /^\d{8}$/.test(date));
  try {
    const symbols = ['sh000001', 'sz399001'];
    const calendars = await Promise.all(
      symbols.map(async (symbol) => {
        const payload = await fetchJson(
          `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,,,180,qfq`,
        );
        const security = ((payload.data ?? {}) as Record<string, unknown>)[
          symbol
        ] as Record<string, unknown> | undefined;
        const rows =
          security &&
          (Array.isArray(security.qfqday)
            ? security.qfqday
            : Array.isArray(security.day)
              ? security.day
              : []);
        return ((rows as unknown[][] | undefined) ?? [])
          .map((row) => String(row[0] ?? '').replaceAll('-', ''))
          .filter((date) => /^\d{8}$/.test(date));
      }),
    );
    const intersection = calendars[0].filter((date) =>
      calendars.slice(1).every((calendar) => calendar.includes(date)),
    );
    if (!intersection.length) throw new Error('两市指数交易日无交集');
    verifiedSessionCache = {
      expiresAt: Date.now() + 6 * 60 * 60 * 1000,
      value: intersection,
    };
    return intersection;
  } catch {
    if (!fallback.length) throw new Error('本地交易日历不可用');
    verifiedSessionCache = {
      expiresAt: Date.now() + 5 * 60 * 1000,
      value: fallback,
    };
    return fallback;
  }
}

function poolCode(row: PoolRow): string {
  return String(row.c ?? '').padStart(6, '0');
}
function poolName(row: PoolRow): string {
  return String(row.n ?? '');
}
function poolNumber(row: PoolRow, key: string): number | null {
  return numberOrNull(row[key]);
}

async function fetchDailyClosesThrough(code: string, tradeDate: string) {
  const symbol = marketSymbol(code);
  const payload = await fetchJson(
    `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,,,35,qfq`,
  );
  const security = ((payload.data ?? {}) as Record<string, unknown>)[symbol] as
    | Record<string, unknown>
    | undefined;
  const raw =
    security &&
    (Array.isArray(security.qfqday)
      ? security.qfqday
      : Array.isArray(security.day)
        ? security.day
        : []);
  const closes = ((raw as unknown[][] | undefined) ?? [])
    .map((row) => ({
      date:
        typeof row[0] === 'string' || typeof row[0] === 'number'
          ? String(row[0])
          : '',
      close: Number(row[2]),
    }))
    .filter(
      (row) =>
        row.date &&
        row.date.replaceAll('-', '') <= tradeDate &&
        Number.isFinite(row.close) &&
        row.close > 0,
    );
  if (!closes.length) throw new Error(`${code}日线收盘缺失`);
  return closes;
}

async function previousLimitBoardFromCurrentSession(current: CloseSnapshot) {
  const tradeDate = current.date.replaceAll('-', '');
  const [allResult, consecutiveResult] = await Promise.all([
    fetchClist({
      fs: 'b:BK1050',
      fid: 'f3',
      pageSize: 1000,
      fields: 'f12,f14,f3,f100,f124',
    }),
    fetchClist({
      fs: 'b:BK1051',
      fid: 'f3',
      pageSize: 1000,
      fields: 'f12,f14,f3,f100,f124',
    }),
  ]);
  const exactRows = allResult.rows.filter(
    (row) => quoteDate(row.f124) === tradeDate && row.f12 && row.f14,
  );
  const exactConsecutive = new Set(
    consecutiveResult.rows
      .filter((row) => quoteDate(row.f124) === tradeDate)
      .map((row) => String(row.f12 ?? '')),
  );
  if (!exactRows.length)
    throw new Error('当日“昨日涨停”身份池为空或报价日期不符');
  const dateEvidence = await fetchDailyClosesThrough(
    String(exactRows[0].f12),
    tradeDate,
  );
  const previousTradeDate = dateEvidence
    .map((row) => row.date.replaceAll('-', ''))
    .filter((date) => date < tradeDate)
    .at(-1);
  if (!previousTradeDate) throw new Error('无法从逐股日线确认上一交易日日期');
  const heightByCode = new Map<string, number>();
  const unresolved: string[] = [];
  await mapLimit(exactRows, 4, async (row) => {
    const code = String(row.f12 ?? '');
    if (!exactConsecutive.has(code)) {
      heightByCode.set(code, 1);
      return;
    }
    try {
      const closes = await fetchDailyClosesThrough(code, previousTradeDate);
      const height = consecutiveLimitHeight(
        closes,
        previousTradeDate,
        code,
        String(row.f14 ?? ''),
      );
      if (height && height >= 2) heightByCode.set(code, height);
      else unresolved.push(code);
    } catch {
      unresolved.push(code);
    }
  });
  const stocks = exactRows.map((row) => ({
    code: String(row.f12 ?? ''),
    name: String(row.f14 ?? ''),
    changePct: numberOrNull(row.f3),
    industry: String(row.f100 ?? '未知'),
    height: heightByCode.get(String(row.f12 ?? '')) ?? 2,
    firstTouch: null,
    lastSeal: null,
    breakCount: 0,
    sealFund: null,
  }));
  const ladders = [...new Set(stocks.map((stock) => stock.height))]
    .sort((a, b) => b - a)
    .map((height) => ({
      height,
      stocks: stocks.filter((stock) => stock.height === height),
    }));
  return {
    snapshot: {
      ...current,
      date: dashedDate(previousTradeDate),
      limitUp: stocks.length,
      failed: 0,
      highestBoard: Math.max(0, ...stocks.map((stock) => stock.height)),
      consecutiveCount: stocks.filter((stock) => stock.height >= 2).length,
      ladders,
      failedStocks: [],
      limitDownStocks: [],
      closeQuotes: undefined,
    } satisfies CloseSnapshot,
    state: (unresolved.length ? 'DEGRADED' : 'READY') as DataState,
    reason: unresolved.length
      ? `${unresolved.length}只昨日连板股的连续高度未获逐股日线确认，暂按最低2板展示`
      : undefined,
    source: `东方财富${tradeDate}“昨日涨停/昨日连板”身份池 + 腾讯日线连续高度核对`,
  };
}

export async function getLadderSnapshot() {
  // After the close, prefer the immutable daily archive over the more volatile
  // topic-pool endpoint. Live sessions continue to use the live pools below.
  const session = await getMarketDateContext().catch(() => null);
  if (shanghaiClock() >= '15:05' || session?.sessionState === 'CLOSED') {
    const requestedDate = shanghaiDate();
    const closeHistory = await loadCloseHistory().catch(
      () => CLOSE_HISTORY.snapshots,
    );
    const eligible = closeHistory.filter(
      (snapshot) =>
        snapshot.status === 'READY' &&
        snapshot.cutoff === '15:00' &&
        snapshot.date.replaceAll('-', '') <= requestedDate,
    );
    const current = eligible.at(-1);
    if (current) {
      let previous = eligible.at(-2);
      let priorDateState: DataState = 'READY';
      let priorDateSource: string | undefined;
      let priorReason: string | undefined;
      const gapDays = previous
        ? (Date.parse(current.date) - Date.parse(previous.date)) / 86_400_000
        : Infinity;
      if (!previous || gapDays > 4) {
        try {
          const derived = await previousLimitBoardFromCurrentSession(current);
          previous = derived.snapshot;
          priorDateState = derived.state;
          priorDateSource = derived.source;
          priorReason = derived.reason;
        } catch (error) {
          return {
            status: 'MISSING' as DataState,
            tradeDate: current.date.replaceAll('-', ''),
            requestedDate,
            phase: '休市快照',
            sessionState: 'CLOSED' as const,
            sourceState: 'ARCHIVED' as const,
            previousTradeDate: null,
            retrievedAt: new Date().toISOString(),
            source: '目标交易日收盘归档 + 当日昨日涨停身份池',
            reason: `上一交易日候选池无法精确重建：${String(error)}；未使用更早快照替代`,
            promotion: [],
            competitors: [],
          };
        }
      }
      const codes = previous.ladders
        .flatMap((level) => level.stocks)
        .map((stock) => stock.code);
      const quotes = await fetchStockChangesAndSpeeds(
        codes,
        current.date.replaceAll('-', ''),
      ).catch(() => new Map<string, StockQuote>());
      return buildArchivedLadderSnapshot(
        current,
        previous,
        quotes,
        requestedDate,
        { priorDateState, priorDateSource, priorReason },
      );
    }
  }
  const marketDate = await getMarketDateContext();
  const tradeDate = marketDate.tradeDate;
  const [todayLimit, todayFailed, previous] = await Promise.all([
    fetchPool('ZTPool', tradeDate),
    fetchPool('ZBPool', tradeDate),
    previousTradingPool(tradeDate),
  ]);
  if (todayLimit.qdate !== tradeDate || todayFailed.qdate !== tradeDate) {
    return {
      status: 'MISSING' as DataState,
      tradeDate,
      previousTradeDate: previous.tradeDate,
      requestedDate: marketDate.requestedDate,
      phase: marketDate.phase,
      sessionState: marketDate.sessionState,
      retrievedAt: new Date().toISOString(),
      source: '东方财富公开涨停与炸板池',
      reason: '目标交易日池未返回精确日期',
      promotion: [],
      competitors: [],
    };
  }
  const sealedByCode = new Map(
    todayLimit.rows.map((row) => [poolCode(row), row]),
  );
  const failedByCode = new Map(
    todayFailed.rows.map((row) => [poolCode(row), row]),
  );
  const previousByCode = new Map<string, PoolRow>();
  for (const row of previous.rows) {
    const code = poolCode(row);
    const existing = previousByCode.get(code);
    if (!existing || Number(row.lbc ?? 1) > Number(existing.lbc ?? 1))
      previousByCode.set(code, row);
  }
  const previousRows = [...previousByCode.values()];
  const duplicatesRemoved = previous.rows.length - previousRows.length;
  const groups = new Map<number, PoolRow[]>();
  for (const row of previousRows) {
    const height = Math.max(1, Number(row.lbc ?? 1));
    groups.set(height, [...(groups.get(height) ?? []), row]);
  }
  const promotion = [...groups.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([height, rows]) => {
      const advancedRows = rows
        .map((row) => sealedByCode.get(poolCode(row)))
        .filter(Boolean) as PoolRow[];
      const failedRows = rows
        .map((row) => failedByCode.get(poolCode(row)))
        .filter(Boolean) as PoolRow[];
      const dropped = rows.length - advancedRows.length - failedRows.length;
      const lead = advancedRows
        .sort(
          (a, b) =>
            Number(a.lbt ?? a.fbt ?? 999999) - Number(b.lbt ?? b.fbt ?? 999999),
        )
        .slice(0, 3)
        .map(poolName);
      return {
        fromHeight: height,
        toHeight: height + 1,
        level: `${height}进${height + 1}`,
        started: rows.length,
        advanced: advancedRows.length,
        failed: failedRows.length,
        dropped,
        ratePct: rows.length ? (advancedRows.length / rows.length) * 100 : 0,
        lead,
      };
    });

  const competitorBase = previousRows.map((prior) => {
    const code = poolCode(prior);
    const sealed = sealedByCode.get(code);
    const failed = failedByCode.get(code);
    const current = sealed ?? failed ?? prior;
    const fromHeight = Math.max(1, Number(prior.lbc ?? 1));
    return {
      code,
      name: poolName(current),
      fromHeight,
      toHeight: fromHeight + 1,
      state: sealed ? 'SEALED' : failed ? 'FAILED' : 'DROPPED',
      changePct: sealed || failed ? poolNumber(current, 'zdp') : null,
      amount: sealed || failed ? poolNumber(current, 'amount') : null,
      firstTouch: sealed || failed ? clockText(current.fbt) : null,
      lastSeal: sealed ? clockText(current.lbt ?? current.fbt) : null,
      breakCount: sealed || failed ? Number(current.zbc ?? 0) : 0,
      industry: String(current.hybk ?? prior.hybk ?? '未知'),
      sealFund: sealed ? poolNumber(current, 'fund') : null,
    };
  });
  let quoteMap = new Map<string, StockQuote>();
  try {
    quoteMap = await fetchStockChangesAndSpeeds(
      competitorBase.map((row) => String(row.code)),
      tradeDate,
    );
  } catch {
    quoteMap = new Map();
  }
  const competitorQuotes = competitorBase.map(
    (row) => quoteMap.get(String(row.code)) ?? null,
  );
  const competitors = competitorBase.map((row, index) => {
    const quote = competitorQuotes[index];
    return {
      ...row,
      changePct: quote?.changePct ?? numberOrNull(row.changePct),
      speedPct: quote?.speedPct ?? null,
      amount: quote?.amount ?? numberOrNull(row.amount),
      quoteTime: quote?.quoteTime,
      quoteSource: quote?.quoteSource,
      quoteState: quoteComplete(quote)
        ? ('READY' as DataState)
        : quote?.changePct != null || row.changePct !== null
          ? ('DEGRADED' as DataState)
          : ('MISSING' as DataState),
    };
  });
  competitors.sort((a, b) => {
    const height = Number(b.toHeight) - Number(a.toHeight);
    if (height) return height;
    const change =
      (numberOrNull(b.changePct) ?? -Infinity) -
      (numberOrNull(a.changePct) ?? -Infinity);
    if (change) return change;
    const speed =
      (numberOrNull(b.speedPct) ?? -Infinity) -
      (numberOrNull(a.speedPct) ?? -Infinity);
    if (speed) return speed;
    return String(a.lastSeal ?? '99:99:99').localeCompare(
      String(b.lastSeal ?? '99:99:99'),
    );
  });

  const quoteReady = competitors.filter(
    (row) => row.quoteState === 'READY',
  ).length;

  return {
    status:
      previous.dateState === 'READY' && quoteReady === competitors.length
        ? ('READY' as DataState)
        : ('DEGRADED' as DataState),
    tradeDate,
    requestedDate: marketDate.requestedDate,
    phase: marketDate.phase,
    sessionState: marketDate.sessionState,
    sourceState: marketDate.sourceState,
    previousTradeDate: previous.tradeDate,
    priorDateState: previous.dateState,
    priorProviderQdate: previous.providerQdate,
    retrievedAt: new Date().toISOString(),
    source: '东方财富公开涨停、炸板池与个股实时行情',
    counts: {
      previousLimitUp: previousRows.length,
      todaySealed: todayLimit.rows.length,
      todayFailed: todayFailed.rows.length,
    },
    coverage: {
      competitors: competitors.length,
      quoteReady,
      priceReady: competitors.filter((row) => row.changePct !== null).length,
      speedReady: competitors.filter((row) => row.speedPct !== null).length,
      duplicatesRemoved,
    },
    promotion,
    sealedStocks: [...sealedByCode.values()].map((row) => closeStock(row)),
    competitors,
  };
}

let archivedLadderRepair: CacheRecord<
  Awaited<ReturnType<typeof getLadderSnapshot>>
> | null = null;

export async function repairArchivedLadder(
  snapshot: Awaited<ReturnType<typeof getLadderSnapshot>>,
) {
  // An older same-date D1 ladder may still reference the last available day,
  // rather than the actual preceding session. Rebuild it from independently
  // recovered exact-day pools; do not merely patch prices onto wrong identities.
  const recovered = CLOSE_HISTORY.snapshots.find(
    (close) =>
      close.date.replaceAll('-', '') === snapshot.tradeDate &&
      close.evidenceStatus === 'DEGRADED' &&
      close.modules?.quotes?.status === 'READY',
  );
  const recoveredPrevious = recovered?.previousDate
    ? CLOSE_HISTORY.snapshots.find(
        (close) => close.date === recovered.previousDate,
      )
    : null;
  if (snapshot.sessionState === 'CLOSED' && recovered && recoveredPrevious) {
    return buildArchivedLadderSnapshot(
      recovered,
      recoveredPrevious,
      new Map(),
      snapshot.requestedDate ?? shanghaiDate(),
    );
  }
  if (
    archivedLadderRepair &&
    archivedLadderRepair.expiresAt > Date.now() &&
    archivedLadderRepair.value.tradeDate === snapshot.tradeDate &&
    archivedLadderRepair.value.retrievedAt === snapshot.retrievedAt
  )
    return archivedLadderRepair.value;
  if (!snapshot.competitors.length || !snapshot.coverage) return snapshot;
  const archiveHistory = enrichEmotionCloses(
    await loadCloseHistory().catch(() => CLOSE_HISTORY.snapshots),
  );
  const previousClose = archiveHistory.find(
    (close) =>
      close.date.replaceAll('-', '') === snapshot.previousTradeDate &&
      close.cutoff === '15:00',
  );
  const priorStocks =
    previousClose?.ladders.flatMap((level) => level.stocks) ?? [];
  const archiveMatches =
    priorStocks.length === snapshot.competitors.length &&
    snapshot.competitors.every((row) =>
      priorStocks.some(
        (stock) => stock.code === row.code && stock.height === row.fromHeight,
      ),
    );
  const priorDateState = archiveMatches
    ? ('READY' as DataState)
    : snapshot.priorDateState;
  const currentClose = archiveHistory.find(
    (close) =>
      close.date.replaceAll('-', '') === snapshot.tradeDate &&
      close.cutoff === '15:00',
  );
  const bundledCurrentClose = CLOSE_HISTORY.snapshots.find(
    (close) =>
      close.date.replaceAll('-', '') === snapshot.tradeDate &&
      close.cutoff === '15:00',
  );
  const missing = snapshot.competitors.filter(
    (row) => !quoteComplete(row) || row.quoteState !== 'READY',
  );
  const quotes = missing.length
    ? await fetchStockChangesAndSpeeds(
        missing.map((row) => row.code),
        snapshot.tradeDate,
      ).catch(() => new Map<string, StockQuote>())
    : new Map<string, StockQuote>();
  const competitors = snapshot.competitors
    .map((row) => {
      const quote = quotes.get(row.code);
      // Emotion's 15:00 return must have an exact close-price timestamp. Keep
      // price provenance separate from the legacy last-speed quote provenance.
      const historical =
        snapshot.sessionState === 'CLOSED'
          ? archivedQuote(marketSymbol(row.code), snapshot.tradeDate)
          : null;
      const persistedExactClose = currentClose?.closeQuotes?.[row.code];
      const bundledExactClose = bundledCurrentClose?.closeQuotes?.[row.code];
      const exactCloseFromHistory = bundledExactClose
        ? { ...persistedExactClose, ...bundledExactClose }
        : persistedExactClose;
      const exactClose = exactCloseFromHistory
        ? {
            changePct: exactCloseFromHistory.changePct,
            speedPct: exactCloseFromHistory.speedPct ?? null,
            quoteTime: exactCloseFromHistory.quoteTime,
            quoteSource: exactCloseFromHistory.source,
          }
        : historical &&
            archivedTrend(
              marketSymbol(row.code),
              snapshot.tradeDate,
            )?.points.at(-1)?.time === '15:00'
          ? historical
          : null;
      const updated = {
        ...row,
        changePct: exactClose?.changePct ?? quote?.changePct ?? row.changePct,
        priceQuoteTime:
          exactClose?.quoteTime ?? quote?.quoteTime ?? row.quoteTime,
        priceQuoteSource:
          exactClose?.quoteSource ?? quote?.quoteSource ?? row.quoteSource,
        speedPct: exactClose?.speedPct ?? quote?.speedPct ?? row.speedPct,
        amount: quote?.amount ?? row.amount,
        quoteTime: quote?.quoteTime ?? row.quoteTime,
        quoteSource: quote?.quoteSource ?? row.quoteSource,
      };
      return {
        ...updated,
        quoteState: (quoteComplete(updated)
          ? 'READY'
          : updated.changePct !== null
            ? 'DEGRADED'
            : 'MISSING') as DataState,
      };
    })
    .sort(
      (a, b) =>
        b.toHeight - a.toHeight ||
        (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity) ||
        (b.speedPct ?? -Infinity) - (a.speedPct ?? -Infinity),
    );
  const quoteReady = competitors.filter(
    (row) => row.quoteState === 'READY',
  ).length;
  const currentCloseStocks = currentClose?.ladders.flatMap(
    (level) => level.stocks,
  );
  const value = {
    ...snapshot,
    priorDateState,
    sealedStocks: snapshot.sealedStocks ?? currentCloseStocks,
    priorDateSource: archiveMatches
      ? `${snapshot.previousTradeDate} 15:00收盘归档：股票代码与板位逐一匹配`
      : '东方财富涨停池返回日期',
    competitors,
    status: (priorDateState === 'READY' && quoteReady === competitors.length
      ? 'READY'
      : 'DEGRADED') as DataState,
    coverage: {
      ...snapshot.coverage,
      quoteReady,
      priceReady: competitors.filter((row) => row.changePct !== null).length,
      speedReady: competitors.filter((row) => row.speedPct !== null).length,
    },
  } as Awaited<ReturnType<typeof getLadderSnapshot>>;
  archivedLadderRepair = { expiresAt: Date.now() + 45_000, value };
  return value;
}

export async function getSpeedSnapshot() {
  const startedAt = Date.now();
  const marketDate = await getMarketDateContext();
  const quotes = await fetchClist({
    fs: MARKET_FILTER,
    fid: 'f22',
    pageSize: 30,
  });
  const baseRows = quotes.rows
    .map((row) => ({
      code: String(row.f12 ?? ''),
      name: String(row.f14 ?? ''),
      price: numberOrNull(row.f2),
      changePct: numberOrNull(row.f3),
      speedPct: numberOrNull(row.f22),
      amount: numberOrNull(row.f6),
      turnoverPct: numberOrNull(row.f8),
      high: numberOrNull(row.f15),
      previousClose: numberOrNull(row.f18),
      mainNetInflow: numberOrNull(row.f62),
      industry: String(row.f100 ?? ''),
      quoteTime:
        numberOrNull(row.f124) !== null &&
        Number(row.f124) > 0 &&
        Number(row.f124) * 1000 <= Date.now()
          ? new Date(Number(row.f124) * 1000).toISOString()
          : undefined,
    }))
    .filter(
      (row) =>
        row.code && row.name && row.price !== null && row.speedPct !== null,
    )
    .slice(0, 12);
  const metadata = await mapLimit(baseRows, 4, (row) =>
    fetchStockMetadata(row.code).catch(() => ({
      code: row.code,
      name: row.name,
      industry: row.industry || null,
      concepts: [],
    })),
  );
  const histories = await mapLimit(baseRows, 4, (row) =>
    fetchRecentLimitHistory(row.code, row.name),
  );
  const rows = baseRows.map((row, index) => {
    const metadataResult = metadata[index];
    const history = histories[index];
    const limitPct = nominalLimitPct(row.code, row.name);
    const distanceToLimitPct =
      row.changePct === null ? null : Math.max(0, limitPct - row.changePct);
    const status =
      distanceToLimitPct !== null && distanceToLimitPct <= 0.8
        ? '临近涨停'
        : (row.speedPct ?? 0) >= 1
          ? '快速拉升'
          : (row.changePct ?? 0) < 0
            ? '深水脉冲'
            : '加速';
    return {
      ...row,
      concepts: metadataResult.concepts,
      metadataAsOf:
        'observedAt' in metadataResult ? metadataResult.observedAt : undefined,
      metadataState: metadataResult.concepts.length
        ? ('READY' as DataState)
        : ('DEGRADED' as DataState),
      recentLimitCount: history.count,
      recentLimitSessions: history.sessions,
      recentLimitState: history.status,
      recentLimitMethod: history.method,
      recentLimitReason: history.reason,
      limitPct,
      distanceToLimitPct,
      status,
    };
  });
  const missingMeta = rows.filter(
    (row) => row.metadataState !== 'READY',
  ).length;
  const missingLimits = rows.filter(
    (row) => row.recentLimitState === 'MISSING',
  ).length;
  return {
    status:
      missingMeta || missingLimits || quotes.stale
        ? ('DEGRADED' as DataState)
        : ('READY' as DataState),
    retrievedAt: new Date().toISOString(),
    tradeDate: marketDate.tradeDate,
    requestedDate: marketDate.requestedDate,
    phase: marketDate.phase,
    sessionState: marketDate.sessionState,
    source: '东方财富公开沪深京行情、个股资料与日线',
    sourceState: quotes.stale ? 'STALE' : marketDate.sourceState,
    reason: quotes.stale
      ? '涨速行情端点短暂波动，已使用同交易日最近快照'
      : undefined,
    coverage: {
      requested: rows.length,
      conceptReady: rows.length - missingMeta,
      recentLimitReady: rows.length - missingLimits,
    },
    rows,
    latencyMs: Date.now() - startedAt,
  };
}

function closeStock(row: PoolRow, fallbackHeight = 1): CloseStock {
  const firstTouch =
    row.fbt == null ? null : (clockText(row.fbt)?.slice(0, 5) ?? null);
  const lastSealValue = row.lbt ?? row.fbt;
  const lastSeal =
    lastSealValue == null
      ? null
      : (clockText(lastSealValue)?.slice(0, 5) ?? null);
  return {
    code: poolCode(row),
    name: poolName(row).replace(/\s+/g, ''),
    changePct: poolNumber(row, 'zdp'),
    industry: typeof row.hybk === 'string' && row.hybk ? row.hybk : '未分类',
    height: Math.max(1, Number(row.lbc ?? fallbackHeight)),
    firstTouch,
    lastSeal,
    breakCount: Number(row.zbc ?? 0),
    sealFund: poolNumber(row, 'fund'),
  };
}

function closeIndexMood(breadth: CloseSnapshot['breadth']) {
  const available = Math.max(1, breadth.rowsAvailable);
  const upRatio = breadth.up / available;
  if (breadth.medianChangePct >= 0.8 || upRatio >= 0.68) return '强势';
  if (breadth.medianChangePct >= 0.2 || upRatio >= 0.56) return '偏强';
  if (breadth.medianChangePct > -0.25) return '震荡';
  if (breadth.medianChangePct > -0.85) return '偏弱';
  return '弱势';
}

function closeShortMood(input: {
  limitUp: number;
  failed: number;
  limitDown: number;
  sealRate: number;
  highestBoard: number;
}) {
  if (input.limitUp >= 80 && input.sealRate >= 80 && input.limitDown <= 3)
    return '高潮';
  if (input.limitUp >= 65 && input.sealRate >= 72 && input.highestBoard >= 5)
    return '强势';
  if (input.limitDown >= 12 || (input.sealRate < 58 && input.failed >= 28))
    return '退潮';
  if (input.failed >= 25 || input.sealRate < 68) return '高分歧';
  if (input.limitUp < 45 && input.limitDown >= 8) return '弱修复';
  return '轮动';
}

function closeCycleNode(input: {
  limitUp: number;
  failed: number;
  limitDown: number;
  sealRate: number;
  highestBoard: number;
  breadthMood: string;
}) {
  if (
    input.breadthMood === '强势' &&
    input.limitUp >= 75 &&
    input.sealRate >= 78
  )
    return '主升确认';
  if (input.limitDown >= 12 || (input.failed >= 30 && input.sealRate < 60))
    return '强分歧';
  if (input.breadthMood === '弱势' && input.limitUp < 60) return '退潮释放';
  if (
    (input.breadthMood === '强势' || input.breadthMood === '偏强') &&
    input.highestBoard >= 4
  )
    return '弱转强';
  if (input.failed >= 20 || input.sealRate < 72) return '分歧轮动';
  return '弱修复';
}

async function fetchCloseIndices() {
  const params = new URLSearchParams({
    secids: '1.000001,0.399001,0.399006',
    fields: 'f12,f14,f2,f3',
    ut: PUBLIC_CLIENT_TOKEN,
    fltt: '2',
    invt: '2',
  });
  const payload = await fetchJson(
    `https://push2delay.eastmoney.com/api/qt/ulist.np/get?${params}`,
  );
  const data = (payload.data ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(data.diff) ? (data.diff as ClistRow[]) : [];
  const names = new Map([
    ['000001', '上证'],
    ['399001', '深证'],
    ['399006', '创业板'],
  ]);
  return rows.map((row) => ({
    code: String(row.f12 ?? ''),
    name: names.get(String(row.f12 ?? '')) ?? String(row.f14 ?? ''),
    close: numberOrNull(row.f2),
    changePct: numberOrNull(row.f3),
  }));
}

async function fetchIntradayIndicesAndBreadth(tradeDate: string) {
  const params = new URLSearchParams({
    secids: '1.000001,0.399001,0.899050,0.399006',
    fields: 'f12,f14,f2,f3,f104,f105,f106,f124',
    ut: PUBLIC_CLIENT_TOKEN,
    fltt: '2',
    invt: '2',
  });
  const payload = await fetchJson(
    `https://push2delay.eastmoney.com/api/qt/ulist.np/get?${params}`,
  );
  const data = (payload.data ?? {}) as Record<string, unknown>;
  const rows = (
    Array.isArray(data.diff) ? (data.diff as ClistRow[]) : []
  ).filter((row) => quoteDate(row.f124) === tradeDate);
  const marketRows = rows.filter((row) =>
    ['000001', '399001', '899050'].includes(String(row.f12 ?? '')),
  );
  const up = marketRows.reduce(
    (sum, row) => sum + (numberOrNull(row.f104) ?? 0),
    0,
  );
  const down = marketRows.reduce(
    (sum, row) => sum + (numberOrNull(row.f105) ?? 0),
    0,
  );
  const flat = marketRows.reduce(
    (sum, row) => sum + (numberOrNull(row.f106) ?? 0),
    0,
  );
  const rowsAvailable = up + down + flat;
  let medianChangePct: number | null = null;
  if (rowsAvailable > 0) {
    const pageSize = 100;
    const middleRank = Math.max(1, Math.ceil(rowsAvailable / 2));
    const firstPage = await fetchClist({
      fs: MARKET_FILTER,
      fid: 'f3',
      pageSize,
      page: 1,
      fields: 'f12,f3,f124',
    });
    // Eastmoney sorts suspended rows (f3="-") between flat and falling rows.
    // Translate the active-stock median rank to its actual position in that list.
    const suspended = Math.max(0, firstPage.total - rowsAvailable);
    const globalRank =
      middleRank > up + flat ? middleRank + suspended : middleRank;
    const page = Math.ceil(globalRank / pageSize);
    const offset = (globalRank - 1) % pageSize;
    const ranked = await fetchClist({
      fs: MARKET_FILTER,
      fid: 'f3',
      pageSize,
      page,
      fields: 'f12,f3,f124',
    });
    const central = ranked.rows[offset];
    medianChangePct =
      central && quoteDate(central.f124) === tradeDate
        ? numberOrNull(central.f3)
        : null;
    if (medianChangePct !== null && rowsAvailable % 2 === 0) {
      const nextRank =
        middleRank + 1 > up + flat
          ? middleRank + 1 + suspended
          : middleRank + 1;
      const nextPage = Math.ceil(nextRank / pageSize);
      const nextRows =
        nextPage === page
          ? ranked
          : await fetchClist({
              fs: MARKET_FILTER,
              fid: 'f3',
              pageSize,
              page: nextPage,
              fields: 'f12,f3,f124',
            });
      const nextRow = nextRows.rows[(nextRank - 1) % pageSize];
      const nextValue =
        nextRow && quoteDate(nextRow.f124) === tradeDate
          ? numberOrNull(nextRow.f3)
          : null;
      medianChangePct =
        nextValue === null ? null : (medianChangePct + nextValue) / 2;
    }
  }
  const names = new Map([
    ['000001', '上证'],
    ['399001', '深证'],
    ['899050', '北证50'],
    ['399006', '创业板'],
  ]);
  return {
    breadth: { rowsAvailable, up, down, flat, medianChangePct },
    indices: rows
      .filter((row) => ['000001', '399001', '399006'].includes(String(row.f12)))
      .map((row) => ({
        code: String(row.f12 ?? ''),
        name: names.get(String(row.f12 ?? '')) ?? String(row.f14 ?? ''),
        close: numberOrNull(row.f2),
        changePct: numberOrNull(row.f3),
      })),
    ready:
      marketRows.length === 3 &&
      rowsAvailable >= 4_000 &&
      medianChangePct !== null,
  };
}

function dashedDate(value: string) {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

export async function getIntradayEmotionSnapshot(
  force = false,
): Promise<IntradayEmotionSnapshot> {
  if (
    !force &&
    intradayEmotionCache &&
    intradayEmotionCache.expiresAt > Date.now()
  )
    return intradayEmotionCache.value;
  const marketDate = await getMarketDateContext();
  const [limitPool, failedPool, downPool, market] = await Promise.all([
    fetchPool('ZTPool', marketDate.tradeDate),
    fetchPool('ZBPool', marketDate.tradeDate),
    fetchPool('DTPool', marketDate.tradeDate),
    fetchIntradayIndicesAndBreadth(marketDate.tradeDate),
  ]);
  const pools = [limitPool, failedPool, downPool];
  const poolsReady = pools.filter(
    (pool) => pool.qdate === marketDate.tradeDate,
  ).length;
  if (poolsReady !== pools.length)
    throw new Error('涨停、炸板与跌停池的交易日期未对齐');

  const limitRows = limitPool.rows.map((row) => closeStock(row));
  const limitUp = limitRows.length;
  const failed = failedPool.rows.length;
  const limitDown = downPool.rows.length;
  const sealRate = limitUp + failed ? (limitUp / (limitUp + failed)) * 100 : 0;
  const highestBoard = Math.max(0, ...limitRows.map((row) => row.height));
  const industryCounts = new Map<string, number>();
  for (const stock of limitRows)
    industryCounts.set(
      stock.industry,
      (industryCounts.get(stock.industry) ?? 0) + 1,
    );
  const concentratedIndustries = [...industryCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));
  const breadthForMood = {
    ...market.breadth,
    requested: market.breadth.rowsAvailable,
    medianChangePct: market.breadth.medianChangePct ?? 0,
  };
  const indexMood = closeIndexMood(breadthForMood);
  const moodInput = {
    limitUp,
    failed,
    limitDown,
    sealRate,
    highestBoard,
    breadthMood: indexMood,
  };
  const snapshot: IntradayEmotionSnapshot = {
    status: market.ready ? 'READY' : 'DEGRADED',
    retrievedAt: new Date().toISOString(),
    tradeDate: marketDate.tradeDate,
    requestedDate: marketDate.requestedDate,
    phase: marketDate.phase,
    sessionState: marketDate.sessionState,
    sourceState: marketDate.sourceState,
    cutoff: marketDate.sessionState === 'LIVE' ? shanghaiClock() : '15:00',
    source: '东方财富涨停、炸板、跌停池与沪深北市场宽度',
    reason: market.ready ? undefined : '全市场中位数或涨跌家数覆盖不完整',
    limitUp,
    failed,
    limitDown,
    sealRate,
    highestBoard,
    consecutiveCount: limitRows.filter((row) => row.height >= 2).length,
    breadth: market.breadth,
    indices: market.indices,
    indexMood,
    shortMood: closeShortMood(moodInput),
    cycleNode: closeCycleNode(moodInput),
    concentratedIndustries,
    leaders: limitRows
      .filter((row) => row.height === highestBoard)
      .map((row) => row.name),
    ladders: [...new Set(limitRows.map((row) => row.height))]
      .sort((a, b) => b - a)
      .map((height) => ({
        height,
        stocks: limitRows.filter((row) => row.height === height),
      })),
    failedStocks: failedPool.rows.map((row) => closeStock(row)),
    limitDownStocks: downPool.rows.map((row) => closeStock(row)),
    coverage: {
      poolsReady,
      poolsRequested: pools.length,
      breadthReady: market.ready,
    },
  };
  const reading = emotionReading({
    ...snapshot,
    date: snapshot.tradeDate,
    poolsReady: poolsReady === pools.length,
    breadthReady: market.ready,
  });
  snapshot.indexMood = reading.indexMood;
  snapshot.shortMood = reading.board;
  snapshot.cycleNode = reading.headline;
  if (!reading.indexReady) {
    snapshot.status = 'DEGRADED';
    snapshot.reason = [snapshot.reason, '三大指数报价未齐，不参与指数判断']
      .filter(Boolean)
      .join('；');
  }
  intradayEmotionCache = { expiresAt: Date.now() + 25_000, value: snapshot };
  return snapshot;
}

export async function buildLatestCloseSnapshot(
  latestArchivedDate?: string,
): Promise<{
  snapshot: CloseSnapshot | null;
  marketDate: MarketDateContext;
  reason: string;
}> {
  const marketDate = await getMarketDateContext();
  const latestDigits = String(latestArchivedDate ?? '').replace(/\D/g, '');
  if (latestDigits && marketDate.tradeDate <= latestDigits) {
    return {
      snapshot: null,
      marketDate,
      reason: `最新交易日${dashedDate(marketDate.tradeDate)}已经归档`,
    };
  }
  if (
    marketDate.tradeDate === marketDate.requestedDate &&
    shanghaiClock() < '15:05'
  ) {
    return {
      snapshot: null,
      marketDate,
      reason: '当日15:00收盘数据尚未稳定，收盘后自动归档',
    };
  }

  const [limitPool, failedPool, downPool, breadthRows, indices, previous] =
    await Promise.all([
      fetchPool('ZTPool', marketDate.tradeDate),
      fetchPool('ZBPool', marketDate.tradeDate),
      fetchPool('DTPool', marketDate.tradeDate),
      fetchAllClist({ fs: MARKET_FILTER, fid: 'f3', fields: 'f12,f3,f6,f124' }),
      fetchCloseIndices(),
      previousTradingPool(marketDate.tradeDate),
    ]);
  if (
    [limitPool, failedPool, downPool].some(
      (pool) => pool.qdate !== marketDate.tradeDate,
    )
  ) {
    throw new Error('涨停、炸板与跌停池的交易日期未对齐，暂不归档');
  }
  const marketRows = breadthRows.rows.filter(
    (row) => numberOrNull(row.f3) !== null,
  );
  if (marketRows.length < 4_000)
    throw new Error(
      `全市场收盘覆盖不足 ${marketRows.length}/${breadthRows.total}`,
    );
  const changes = marketRows
    .map((row) => numberOrNull(row.f3) ?? 0)
    .sort((a, b) => a - b);
  const middle = Math.floor(changes.length / 2);
  const medianChangePct =
    changes.length % 2
      ? changes[middle]
      : ((changes[middle - 1] ?? 0) + (changes[middle] ?? 0)) / 2;
  const breadth = {
    requested: breadthRows.total,
    rowsAvailable: marketRows.length,
    up: changes.filter((value) => value > 0).length,
    down: changes.filter((value) => value < 0).length,
    flat: changes.filter((value) => value === 0).length,
    medianChangePct,
  };
  const limitUpRows = limitPool.rows.map((row) => closeStock(row));
  const failedRows = failedPool.rows.map((row) => closeStock(row));
  const limitDownRows = downPool.rows.map((row) => closeStock(row));
  const limitUp = limitUpRows.length;
  const failed = failedRows.length;
  const limitDown = limitDownRows.length;
  const sealRate = limitUp + failed ? (limitUp / (limitUp + failed)) * 100 : 0;
  const highestBoard = Math.max(0, ...limitUpRows.map((row) => row.height));
  const industryCounts = new Map<string, number>();
  for (const stock of limitUpRows)
    industryCounts.set(
      stock.industry,
      (industryCounts.get(stock.industry) ?? 0) + 1,
    );
  const concentratedIndustries = [...industryCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));
  const ladders = [...new Set(limitUpRows.map((row) => row.height))]
    .sort((a, b) => b - a)
    .map((height) => ({
      height,
      stocks: limitUpRows
        .filter((row) => row.height === height)
        .sort(
          (a, b) =>
            (a.firstTouch ?? '99:99').localeCompare(b.firstTouch ?? '99:99') ||
            (b.sealFund ?? 0) - (a.sealFund ?? 0),
        ),
    }));
  const breadthMood = closeIndexMood(breadth);
  const moodInput = {
    limitUp,
    failed,
    limitDown,
    sealRate,
    highestBoard,
    breadthMood,
  };
  const snapshot: CloseSnapshot = {
    date: dashedDate(marketDate.tradeDate),
    previousDate: dashedDate(previous.tradeDate),
    cutoff: '15:00',
    status: 'READY',
    source: '东方财富收盘池、全市场行情与指数快照 · 自动归档',
    closeQuotes: Object.fromEntries(
      marketRows
        .filter((row) => quoteDate(row.f124) === marketDate.tradeDate)
        .map((row) => [
          String(row.f12),
          {
            changePct: Number(row.f3),
            quoteTime: `${dashedDate(marketDate.tradeDate)}T15:00:00+08:00`,
            source: '东方财富目标交易日盘后最终涨跌幅，归一到15:00收盘截止时点',
          },
        ]),
    ),
    limitUp,
    failed,
    limitDown,
    sealRate,
    highestBoard,
    consecutiveCount: limitUpRows.filter((row) => row.height >= 2).length,
    turnover: marketRows.reduce(
      (sum, row) => sum + (numberOrNull(row.f6) ?? 0),
      0,
    ),
    breadth,
    indexMood: breadthMood,
    shortMood: closeShortMood(moodInput),
    cycleNode: closeCycleNode(moodInput),
    concentratedIndustries,
    leaders: limitUpRows
      .filter((row) => row.height === highestBoard)
      .map((row) => row.name),
    indices,
    ladders,
    failedStocks: failedRows.sort(
      (a, b) => (a.changePct ?? 0) - (b.changePct ?? 0),
    ),
    limitDownStocks: limitDownRows.sort(
      (a, b) => (a.changePct ?? 0) - (b.changePct ?? 0),
    ),
    coverage: { reported: breadthRows.total, available: marketRows.length },
  };
  return {
    snapshot,
    marketDate,
    reason: `${snapshot.date} 15:00收盘快照已自动归档`,
  };
}
