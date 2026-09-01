const PUBLIC_CLIENT_TOKEN = '7eea3edcaed734bea9cbfc24409ed989';
const MARKET_FILTER = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048';
const QUOTE_FIELDS = 'f12,f14,f2,f3,f5,f6,f8,f15,f18,f20,f21,f22,f62,f100,f184';

export type DataState = 'READY' | 'DEGRADED' | 'MISSING';

type CacheRecord<T> = { expiresAt: number; value: T };
const metadataCache = new Map<string, CacheRecord<StockMetadata>>();
const limitHistoryCache = new Map<string, CacheRecord<LimitHistory>>();
const clistCache = new Map<string, {
  expiresAt: number;
  staleUntil: number;
  value: { total: number; rows: ClistRow[]; host: string; stale?: boolean };
}>();

export type StockMetadata = {
  code: string;
  name: string;
  industry: string | null;
  concepts: string[];
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
  sourceState?: 'LIVE' | 'STALE';
  basis: string;
  coverage: { requested: number; available: number };
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

type ClistRow = Record<string, string | number | null>;
type PoolRow = Record<string, unknown>;
let flowSnapshotCache: CacheRecord<FlowSnapshot> | null = null;

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function fetchJson(url: string, timeoutMs = 10_000): Promise<Record<string, unknown>> {
  let lastError: unknown = new Error('unknown fetch error');
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: {
          accept: 'application/json,text/plain,*/*',
          referer: 'https://quote.eastmoney.com/',
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as Record<string, unknown>;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 180 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function fetchText(url: string, referer: string, timeoutMs = 10_000): Promise<string> {
  let lastError: unknown = new Error('unknown fetch error');
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: { referer, 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 180 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(items[index], index);
    }
  });
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
}): Promise<{ total: number; rows: ClistRow[]; host: string; stale?: boolean }> {
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
      const payload = await fetchJson(`https://${host}/api/qt/clist/get?${params}`);
      const data = (payload.data ?? {}) as Record<string, unknown>;
      const rows = Array.isArray(data.diff) ? (data.diff as ClistRow[]) : [];
      const value = { total: Number(data.total ?? rows.length), rows, host, stale: false };
      clistCache.set(cacheKey, { expiresAt: Date.now() + 850, staleUntil: Date.now() + 5 * 60_000, value });
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
  const remaining = await mapLimit(
    pages,
    3,
    (page) => fetchClist({ ...options, pageSize, page }),
  );
  const rows = [first, ...remaining].flatMap((page) => page.rows);
  const unique = new Map(rows.map((row) => [String(row.f12 ?? ''), row]));
  return { total: first.total, rows: [...unique.values()], host: first.host };
}

function shanghaiDate(value = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(value).replaceAll('-', '');
}

function subtractDays(yyyymmdd: string, days: number): string {
  const year = Number(yyyymmdd.slice(0, 4));
  const month = Number(yyyymmdd.slice(4, 6));
  const day = Number(yyyymmdd.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day - days, 12));
  return date.toISOString().slice(0, 10).replaceAll('-', '');
}

function clockText(value: unknown): string | null {
  const digits = String(value ?? '').replace(/\D/g, '').padStart(6, '0');
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

export async function fetchStockMetadata(code: string): Promise<StockMetadata> {
  const cached = metadataCache.get(code);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const fields = 'f57,f58,f127,f128,f129';
  const payload = await fetchJson(
    `https://push2delay.eastmoney.com/api/qt/stock/get?secid=${secid(code)}&fields=${fields}`,
  );
  const data = (payload.data ?? {}) as Record<string, unknown>;
  const value: StockMetadata = {
    code: String(data.f57 ?? code),
    name: String(data.f58 ?? ''),
    industry: data.f127 && data.f127 !== '-' ? String(data.f127) : null,
    concepts: splitConcepts(data.f129),
  };
  metadataCache.set(code, { expiresAt: Date.now() + 6 * 60 * 60 * 1000, value });
  return value;
}

function limitBand(code: string, name: string): [number, number] {
  const upperName = name.toUpperCase();
  if (upperName.includes('ST')) return [4.7, 5.6];
  if (code.startsWith('8') || code.startsWith('9')) return [28.5, 31.5];
  if (code.startsWith('300') || code.startsWith('301') || code.startsWith('688')) return [19, 21.5];
  return [9.5, 11.2];
}

export function nominalLimitPct(code: string, name: string): number {
  if (name.toUpperCase().includes('ST')) return 5;
  if (code.startsWith('8') || code.startsWith('9')) return 30;
  if (code.startsWith('300') || code.startsWith('301') || code.startsWith('688')) return 20;
  return 10;
}

export async function fetchRecentLimitHistory(code: string, name: string): Promise<LimitHistory> {
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
      const security = ((payload.data ?? {}) as Record<string, unknown>)[symbol] as Record<string, unknown> | undefined;
      const rows = security && (Array.isArray(security.qfqday) ? security.qfqday : Array.isArray(security.day) ? security.day : []);
      closes = (rows as unknown[][] | undefined ?? [])
        .map((row) => ({ date: String(row[0] ?? ''), close: Number(row[2]) }))
        .filter((row) => row.date && Number.isFinite(row.close) && row.close > 0)
        .slice(-21);
      if (closes.length < 16) throw new Error(`腾讯日线覆盖不足 ${closes.length}`);
      method = '腾讯前复权日线相邻收盘涨幅';
    } catch (error) {
      primaryError = error;
      const url = `https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20data=/CN_MarketDataService.getKLineData?symbol=${symbol}&scale=240&ma=no&datalen=50`;
      const text = await fetchText(url, 'https://finance.sina.com.cn/');
      const match = text.match(/var\s+data=\((\[.*\])\);?\s*$/s);
      if (!match) throw new Error(`新浪日线JSONP缺失；腾讯=${String(primaryError)}`);
      const rows = JSON.parse(match[1]) as Array<Record<string, unknown>>;
      closes = rows
        .map((row) => ({ date: String(row.day ?? ''), close: Number(row.close) }))
        .filter((row) => row.date && Number.isFinite(row.close) && row.close > 0)
        .slice(-21);
      if (closes.length < 16) throw new Error(`新浪日线覆盖不足 ${closes.length}；腾讯=${String(primaryError)}`);
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
    limitHistoryCache.set(cacheKey, { expiresAt: Date.now() + 6 * 60 * 60 * 1000, value });
    return value;
  } catch (error) {
    const value: LimitHistory = { count: null, sessions: 0, status: 'MISSING', method: '日线不可用', reason: String(error) };
    limitHistoryCache.set(cacheKey, { expiresAt: Date.now() + 30 * 1000, value });
    return value;
  }
}

export async function getRadarSnapshot() {
  const startedAt = Date.now();
  const queryResults = await Promise.allSettled([
    fetchClist({ fs: 'm:90+t:3', fid: 'f22', order: 1, pageSize: 12 }),
    fetchClist({ fs: 'm:90+t:3', fid: 'f22', order: 0, pageSize: 12 }),
    fetchClist({ fs: 'm:90+t:3', fid: 'f3', order: 1, pageSize: 12 }),
    fetchClist({ fs: 'm:90+t:3', fid: 'f3', order: 0, pageSize: 12 }),
  ]);
  const successful = queryResults
    .filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof fetchClist>>> => result.status === 'fulfilled')
    .map((result) => result.value);
  if (!successful.length) throw new Error('概念板块排名端点暂时不可用');
  const boardTotal = Math.max(...successful.map((result) => result.total));
  const boardMap = new Map(successful.flatMap((result) => result.rows).map((row) => [String(row.f12 ?? ''), row]));
  const boards = [...boardMap.values()]
    .map((row) => ({
      code: String(row.f12 ?? ''),
      name: String(row.f14 ?? ''),
      changePct: numberOrNull(row.f3),
      speedPct: numberOrNull(row.f22),
      mainNetInflow: numberOrNull(row.f62),
      amount: numberOrNull(row.f6),
    }))
    .filter((row) => row.code && row.name && row.changePct !== null);
  const uniqueTop = <T extends { code: string }>(primary: T[], fallback: T[]) => {
    const seen = new Set<string>();
    return [...primary, ...fallback].filter((item) => {
      if (seen.has(item.code)) return false;
      seen.add(item.code);
      return true;
    }).slice(0, 3);
  };
  const speedUp = boards.filter((row) => (row.speedPct ?? 0) > 0).sort((a, b) => (b.speedPct ?? 0) - (a.speedPct ?? 0));
  const speedDown = boards.filter((row) => (row.speedPct ?? 0) < 0).sort((a, b) => (a.speedPct ?? 0) - (b.speedPct ?? 0));
  const dayUp = boards.filter((row) => (row.changePct ?? 0) > 0).sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0));
  const dayDown = boards.filter((row) => (row.changePct ?? 0) < 0).sort((a, b) => (a.changePct ?? 0) - (b.changePct ?? 0));
  const up = uniqueTop(speedUp, dayUp);
  const down = uniqueTop(speedDown, dayDown);
  const selected = [
    ...up.map((board) => ({ ...board, selectedDirection: 'up' as const })),
    ...down.map((board) => ({ ...board, selectedDirection: 'down' as const })),
  ];

  const events = await mapLimit(selected, 3, async (board) => {
    const direction = board.selectedDirection;
    try {
      const members = await fetchClist({ fs: `b:${board.code}`, fid: 'f62', pageSize: 300 });
      const normalized = members.rows.map((row) => ({
        code: String(row.f12 ?? ''), name: String(row.f14 ?? ''),
        changePct: numberOrNull(row.f3), speedPct: numberOrNull(row.f22),
        mainNetInflow: numberOrNull(row.f62), amount: numberOrNull(row.f6),
        industry: String(row.f100 ?? ''),
      }));
      const priceDirectional = normalized.filter((row) => {
        const speed = row.speedPct ?? 0;
        return direction === 'up' ? speed > 0 : speed < 0;
      });
      const flowDirectional = priceDirectional.filter((row) => {
        const flow = row.mainNetInflow ?? 0;
        return direction === 'up' ? flow > 0 : flow < 0;
      });
      const flowCodes = new Set(flowDirectional.map((row) => row.code));
      const candidates = [
        ...flowDirectional.sort((a, b) => Math.abs(b.mainNetInflow ?? 0) - Math.abs(a.mainNetInflow ?? 0)),
        ...priceDirectional
          .filter((row) => !flowCodes.has(row.code))
          .sort((a, b) => Math.abs(b.speedPct ?? 0) - Math.abs(a.speedPct ?? 0)),
      ];
      const denominator = flowDirectional.reduce((sum, row) => sum + Math.abs(row.mainNetInflow ?? 0), 0);
      const drivers = candidates
        .slice(0, 4)
        .map((row) => ({
          ...row,
          driverRole: flowCodes.has(row.code) ? '价格与资金同向' : '价格速度拖累',
          contributionPct: flowCodes.has(row.code) && denominator > 0 ? Math.abs(row.mainNetInflow ?? 0) / denominator * 100 : null,
        }));
      const directionalCount = priceDirectional.length;
      return {
        ...board, selectedDirection: undefined, direction, memberCount: members.total, directionalCount, drivers,
        members: normalized,
        driverState: drivers.length ? 'DEGRADED' as DataState : 'MISSING' as DataState,
        driverBasis: '先按当前个股涨速识别拉动/拖累，资金同向者优先；连续打开3分钟后升级为同窗口增量',
      };
    } catch {
      return {
        ...board, selectedDirection: undefined, direction, memberCount: null, directionalCount: null, drivers: [],
        members: [],
        driverState: 'MISSING' as DataState, driverBasis: '成分股端点短暂波动，正在自动重连',
      };
    }
  });

  return {
    status: successful.length === 4 && successful.every((result) => !result.stale) && events.length === 6 && events.every((event) => event.driverState === 'READY')
      ? 'READY' as DataState : 'DEGRADED' as DataState,
    retrievedAt: new Date().toISOString(),
    tradeDate: shanghaiDate(),
    source: '东方财富公开概念板块与成分行情',
    sourceState: successful.some((result) => result.stale) ? 'STALE' : 'LIVE',
    reason: successful.some((result) => result.stale) ? '部分排名端点短暂波动，已使用同交易日最近快照' : undefined,
    coverage: { reported: boardTotal, available: boardTotal, rankedCandidates: boards.length, queryReady: successful.length, queryRequested: 4 },
    events,
    latencyMs: Date.now() - startedAt,
  };
}

function shanghaiMarketPhase(value = new Date()): string {
  const clock = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(value);
  if (clock < '09:30') return '盘前';
  if (clock <= '11:30') return '上午盘';
  if (clock < '13:00') return '午间休市';
  if (clock <= '15:00') return '下午盘';
  return '收盘后';
}

async function fetchSectorFlowSeries(board: {
  code: string;
  name: string;
  changePct: number | null;
}, tradeDate: string): Promise<SectorFlowSeries> {
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
      payload = await fetchJson(`https://${host}/api/qt/stock/fflow/kline/get?${params}`, 12_000);
      const data = (payload.data ?? {}) as Record<string, unknown>;
      if (Array.isArray(data.klines) && data.klines.length) break;
      failures.push(`${host}:分时为空`);
      payload = null;
    } catch (error) {
      failures.push(`${host}:${String(error)}`);
    }
  }
  if (!payload) throw new Error(`${board.name}分时不可用 ${failures.join(' | ')}`);
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
  if (!points.length) throw new Error(`${board.name}未返回${tradeDate}的分钟资金`);
  const latest = points.at(-1)?.mainNetInflow ?? 0;
  const deltaFrom = (minutes: number) => points.length > minutes
    ? latest - points[points.length - 1 - minutes].mainNetInflow
    : null;
  return {
    ...board,
    latestMainNetInflow: latest,
    delta5m: deltaFrom(5),
    delta15m: deltaFrom(15),
    delta30m: deltaFrom(30),
    points,
  };
}

async function fetchSectorFlowDetail(series: SectorFlowSeries) {
  const direction: 0 | 1 = series.latestMainNetInflow >= 0 ? 1 : 0;
  const members = await fetchClist({
    fs: `b:${series.code}`, fid: 'f62', order: direction, pageSize: 100,
    fields: 'f12,f14,f3,f22,f62,f6,f100',
  });
  const rows = members.rows.map((row) => ({
    code: String(row.f12 ?? ''),
    name: String(row.f14 ?? ''),
    industry: String(row.f100 ?? '未知') || '未知',
    changePct: numberOrNull(row.f3),
    speedPct: numberOrNull(row.f22),
    mainNetInflow: numberOrNull(row.f62),
  })).filter((row) => row.code && row.name);
  const sameFlow = rows.filter((row) => series.latestMainNetInflow >= 0
    ? (row.mainNetInflow ?? 0) > 0
    : (row.mainNetInflow ?? 0) < 0);
  const representatives = (sameFlow.length ? sameFlow : rows).slice(0, 4);
  const industryMap = new Map<string, typeof rows>();
  for (const row of rows) industryMap.set(row.industry, [...(industryMap.get(row.industry) ?? []), row]);
  const subgroups = [...industryMap.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 4)
    .map(([name, items]) => ({ name, count: items.length, leaders: items.slice(0, 3).map((item) => item.name) }));
  return {
    detailState: !members.stale && rows.length >= Math.min(members.total, 100) ? 'READY' as DataState : 'DEGRADED' as DataState,
    detailBasis: `${members.stale ? '同交易日快照·' : ''}资金同向成分样本${rows.length}/${members.total}只`,
    subgroups,
    representatives,
  };
}

export async function getFlowSnapshot(): Promise<FlowSnapshot> {
  if (flowSnapshotCache && flowSnapshotCache.expiresAt > Date.now()) return flowSnapshotCache.value;
  const tradeDate = shanghaiDate();
  const [topFlow, bottomFlow] = await Promise.all([
    fetchClist({ fs: 'm:90+t:3', fid: 'f62', order: 1, pageSize: 8, fields: 'f12,f14,f3,f62' }),
    fetchClist({ fs: 'm:90+t:3', fid: 'f62', order: 0, pageSize: 8, fields: 'f12,f14,f3,f62' }),
  ]);
  const boards = [...topFlow.rows, ...bottomFlow.rows]
    .map((row) => ({
      code: String(row.f12 ?? ''),
      name: String(row.f14 ?? ''),
      changePct: numberOrNull(row.f3),
      mainNetInflow: numberOrNull(row.f62),
    }))
    .filter((row) => row.code && row.name && row.mainNetInflow !== null);
  const candidates = boards
    .map(({ code, name, changePct }) => ({ code, name, changePct }));
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
  const series = baseSeries.map((item, index) => ({ ...item, ...details[index] }));
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
      persistenceLabel: item.delta30m === null
        ? '30分钟窗口建立中'
        : item.delta30m > 0 ? '资金持续流入' : '日内强势·30分钟转弱',
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
      persistenceLabel: item.delta30m === null
        ? '30分钟窗口建立中'
        : item.delta30m < 0 ? '资金持续流出' : '日内弱势·30分钟回流',
    }))
    .sort((a, b) => {
      const rankA = a.delta30m === null ? 1 : a.delta30m < 0 ? 0 : 2;
      const rankB = b.delta30m === null ? 1 : b.delta30m < 0 ? 0 : 2;
      return rankA - rankB || a.latestMainNetInflow - b.latestMainNetInflow;
    })
    .slice(0, 6);
  const curveState: DataState = series.length === candidates.length ? 'READY' : series.length ? 'DEGRADED' : 'MISSING';
  const splitState: DataState = splitReady.length === series.length && splitReady.length > 0 ? 'READY' : splitReady.length ? 'DEGRADED' : 'MISSING';
  const sourceStale = Boolean(topFlow.stale || bottomFlow.stale);
  const value: FlowSnapshot = {
    status: curveState === 'READY' && splitState === 'READY' && !sourceStale ? 'READY' : series.length ? 'DEGRADED' : 'MISSING',
    curveState: sourceStale && curveState === 'READY' ? 'DEGRADED' : curveState,
    splitState: sourceStale && splitState === 'READY' ? 'DEGRADED' : splitState,
    retrievedAt: new Date().toISOString(),
    tradeDate,
    phase: shanghaiMarketPhase(),
    lastPointTime: series.flatMap((item) => item.points.map((point) => point.time)).sort().at(-1) ?? null,
    source: '东方财富公开概念板块与主力资金分钟序列',
    sourceState: sourceStale ? 'STALE' : 'LIVE',
    reason: sourceStale ? '资金排名端点短暂波动，已使用同交易日最近快照' : undefined,
    basis: '曲线为当日累计主力净流入；短时分流为最近5个有效交易分钟的增量。长周期强弱先看开盘至今价格与累计资金是否同向，再标注最近30分钟是持续、回流还是转弱。概念成分重叠，不作资金守恒解释。',
    coverage: { requested: candidates.length, available: series.length },
    series,
    split: {
      inflow,
      outflow,
      cumulativeInflow,
      cumulativeOutflow,
      persistentStrong,
      persistentWeak,
      positiveCount: splitReady.filter((item) => (item.delta5m ?? 0) > 0).length,
      negativeCount: splitReady.filter((item) => (item.delta5m ?? 0) < 0).length,
    },
  };
  flowSnapshotCache = { expiresAt: Date.now() + 45_000, value };
  return value;
}

async function fetchPool(pool: 'ZTPool' | 'ZBPool', tradeDate: string) {
  const params = new URLSearchParams({
    ut: PUBLIC_CLIENT_TOKEN, dpt: 'wz.ztzt', Pageindex: '0', pagesize: '1000',
    sort: pool === 'ZBPool' ? 'fbt:asc' : 'fbt:asc', date: tradeDate,
  });
  const payload = await fetchJson(`https://push2ex.eastmoney.com/getTopic${pool}?${params}`);
  const data = (payload.data ?? {}) as Record<string, unknown>;
  return {
    qdate: String(data.qdate ?? ''),
    rows: Array.isArray(data.pool) ? (data.pool as PoolRow[]) : [],
  };
}

async function previousTradingPool(tradeDate: string) {
  const attempts: Array<{ date: string; qdate: string; rows: number }> = [];
  for (let offset = 1; offset <= 10; offset += 1) {
    const candidate = subtractDays(tradeDate, offset);
    const pool = await fetchPool('ZTPool', candidate);
    attempts.push({ date: candidate, qdate: pool.qdate, rows: pool.rows.length });
    if (pool.rows.length) {
      return {
        tradeDate: candidate,
        rows: pool.rows,
        providerQdate: pool.qdate,
        dateState: pool.qdate === candidate ? 'READY' as DataState : 'DEGRADED' as DataState,
      };
    }
  }
  throw new Error(`10日内未找到上一交易日涨停池 ${JSON.stringify(attempts)}`);
}

function poolCode(row: PoolRow): string { return String(row.c ?? '').padStart(6, '0'); }
function poolName(row: PoolRow): string { return String(row.n ?? ''); }
function poolNumber(row: PoolRow, key: string): number | null { return numberOrNull(row[key]); }

export async function getLadderSnapshot() {
  const tradeDate = shanghaiDate();
  const [todayLimit, todayFailed, previous] = await Promise.all([
    fetchPool('ZTPool', tradeDate), fetchPool('ZBPool', tradeDate), previousTradingPool(tradeDate),
  ]);
  if (todayLimit.qdate !== tradeDate || todayFailed.qdate !== tradeDate) {
    return {
      status: 'MISSING' as DataState, tradeDate, previousTradeDate: previous.tradeDate,
      retrievedAt: new Date().toISOString(), source: '东方财富公开涨停与炸板池',
      reason: '目标交易日池未返回精确日期', promotion: [], competitors: [],
    };
  }
  const sealedByCode = new Map(todayLimit.rows.map((row) => [poolCode(row), row]));
  const failedByCode = new Map(todayFailed.rows.map((row) => [poolCode(row), row]));
  const groups = new Map<number, PoolRow[]>();
  for (const row of previous.rows) {
    const height = Math.max(1, Number(row.lbc ?? 1));
    groups.set(height, [...(groups.get(height) ?? []), row]);
  }
  const promotion = [...groups.entries()].sort((a, b) => b[0] - a[0]).map(([height, rows]) => {
    const advancedRows = rows.map((row) => sealedByCode.get(poolCode(row))).filter(Boolean) as PoolRow[];
    const failedRows = rows.map((row) => failedByCode.get(poolCode(row))).filter(Boolean) as PoolRow[];
    const dropped = rows.length - advancedRows.length - failedRows.length;
    const lead = advancedRows
      .sort((a, b) => Number(a.lbt ?? a.fbt ?? 999999) - Number(b.lbt ?? b.fbt ?? 999999))
      .slice(0, 3)
      .map(poolName);
    return {
      fromHeight: height, toHeight: height + 1, level: `${height}进${height + 1}`,
      started: rows.length, advanced: advancedRows.length, failed: failedRows.length, dropped,
      ratePct: rows.length ? advancedRows.length / rows.length * 100 : 0, lead,
    };
  });

  const competitors = previous.rows.map((prior) => {
    const code = poolCode(prior);
    const sealed = sealedByCode.get(code);
    const failed = failedByCode.get(code);
    const current = sealed ?? failed;
    if (!current) return null;
    const fromHeight = Math.max(1, Number(prior.lbc ?? 1));
    return {
      code, name: poolName(current), fromHeight, toHeight: fromHeight + 1,
      state: sealed ? 'SEALED' : 'FAILED',
      changePct: poolNumber(current, 'zdp'), amount: poolNumber(current, 'amount'),
      firstTouch: clockText(current.fbt), lastSeal: sealed ? clockText(current.lbt ?? current.fbt) : null,
      breakCount: Number(current.zbc ?? 0), industry: String(current.hybk ?? prior.hybk ?? '未知'),
      sealFund: sealed ? poolNumber(current, 'fund') : null,
    };
  }).filter(Boolean) as Array<Record<string, unknown>>;
  competitors.sort((a, b) => {
    const height = Number(b.toHeight) - Number(a.toHeight);
    if (height) return height;
    const state = String(a.state).localeCompare(String(b.state));
    if (state) return state;
    return String(a.lastSeal ?? '99:99:99').localeCompare(String(b.lastSeal ?? '99:99:99'));
  });

  return {
    status: previous.dateState === 'READY' ? 'READY' as DataState : 'DEGRADED' as DataState,
    tradeDate,
    previousTradeDate: previous.tradeDate,
    priorDateState: previous.dateState,
    priorProviderQdate: previous.providerQdate,
    retrievedAt: new Date().toISOString(), source: '东方财富公开涨停与炸板池',
    counts: { previousLimitUp: previous.rows.length, todaySealed: todayLimit.rows.length, todayFailed: todayFailed.rows.length },
    promotion, competitors,
  };
}

export async function getSpeedSnapshot() {
  const startedAt = Date.now();
  const quotes = await fetchClist({ fs: MARKET_FILTER, fid: 'f22', pageSize: 30 });
  const baseRows = quotes.rows
    .map((row) => ({
      code: String(row.f12 ?? ''), name: String(row.f14 ?? ''), price: numberOrNull(row.f2),
      changePct: numberOrNull(row.f3), speedPct: numberOrNull(row.f22), amount: numberOrNull(row.f6),
      turnoverPct: numberOrNull(row.f8), high: numberOrNull(row.f15), previousClose: numberOrNull(row.f18),
      mainNetInflow: numberOrNull(row.f62), industry: String(row.f100 ?? ''),
    }))
    .filter((row) => row.code && row.name && row.price !== null && row.speedPct !== null)
    .slice(0, 12);
  const metadata = await mapLimit(baseRows, 4, (row) =>
    fetchStockMetadata(row.code).catch(() => ({ code: row.code, name: row.name, industry: row.industry || null, concepts: [] })),
  );
  const histories = await mapLimit(baseRows, 4, (row) => fetchRecentLimitHistory(row.code, row.name));
  const rows = baseRows.map((row, index) => {
    const metadataResult = metadata[index];
    const history = histories[index];
    const limitPct = nominalLimitPct(row.code, row.name);
    const distanceToLimitPct = row.changePct === null ? null : Math.max(0, limitPct - row.changePct);
    const status = distanceToLimitPct !== null && distanceToLimitPct <= 0.8
      ? '临近涨停'
      : (row.speedPct ?? 0) >= 1 ? '快速拉升' : (row.changePct ?? 0) < 0 ? '深水脉冲' : '加速';
    return {
      ...row, concepts: metadataResult.concepts, metadataState: metadataResult.concepts.length ? 'READY' as DataState : 'DEGRADED' as DataState,
      recentLimitCount: history.count, recentLimitSessions: history.sessions, recentLimitState: history.status,
      recentLimitMethod: history.method, recentLimitReason: history.reason, limitPct, distanceToLimitPct, status,
    };
  });
  const missingMeta = rows.filter((row) => row.metadataState !== 'READY').length;
  const missingLimits = rows.filter((row) => row.recentLimitState === 'MISSING').length;
  return {
    status: missingMeta || missingLimits || quotes.stale ? 'DEGRADED' as DataState : 'READY' as DataState,
    retrievedAt: new Date().toISOString(), tradeDate: shanghaiDate(), source: '东方财富公开沪深京行情、个股资料与日线',
    sourceState: quotes.stale ? 'STALE' : 'LIVE',
    reason: quotes.stale ? '涨速行情端点短暂波动，已使用同交易日最近快照' : undefined,
    coverage: { requested: rows.length, conceptReady: rows.length - missingMeta, recentLimitReady: rows.length - missingLimits },
    rows, latencyMs: Date.now() - startedAt,
  };
}
