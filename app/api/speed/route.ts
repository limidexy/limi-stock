import { CLOSE_SPEED_DATES, resolveCloseSpeed } from '@/lib/close-speed';
import {
  fetchRecentLimitHistory,
  fetchStockMetadata,
  getMarketDateContext,
  nominalLimitPct,
} from '@/lib/market';
import { isDelistedName } from '@/lib/stock-universe';

export const dynamic = 'force-dynamic';

type EnrichedRow = {
  code: string;
  name: string;
  price: number;
  changePct: number | null;
  speedPct: number;
  refPrice: number;
  amount: number | null;
  turnoverPct: null;
  high: null;
  previousClose: null;
  mainNetInflow: null;
  industry: string | null;
  concepts: string[];
  metadataState: 'READY' | 'DEGRADED' | 'MISSING';
  metadataAsOf: string | null;
  quoteTime: string;
  recentLimitCount: number | null;
  recentLimitSessions: number;
  recentLimitState: 'READY' | 'DEGRADED' | 'MISSING';
  recentLimitMethod: string | null;
  recentLimitReason: string | null;
  limitPct: number;
  distanceToLimitPct: number;
  status: string;
};

type SpeedSnapshot = {
  status: 'READY' | 'DEGRADED' | 'MISSING';
  tradeDate: string | null;
  requestedDate: string;
  windowStart: string | null;
  windowEnd: string | null;
    coverage: {
      requested: number;
      available: number;
      withWindow: number;
      delistedExcluded: number;
      conceptReady: number;
      industryReady: number;
      recentLimitReady: number;
      returned: number;
    };
  rows: EnrichedRow[];
  reasons: string[];
  source: string;
  retrievedAt: string;
};

const ROW_LIMIT = 24;
// 概念与近 20 日涨停要逐只补；归档本身是收盘定稿，同一天不必重复请求。
const cache = new Map<string, { expiresAt: number; value: SpeedSnapshot }>();

const fmtDate = (value: string) =>
  `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`;

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
) {
  const results = Array.from<R | undefined>({ length: items.length });
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index]);
      }
    }),
  );
  return results as R[];
}

function rowStatus(
  changePct: number | null,
  speedPct: number,
  limitPct: number,
) {
  const distance = Math.max(0, limitPct - (changePct ?? 0));
  if (distance <= 0.8) return '临近涨停';
  // 榜单本身按涨速排序，涨速达标是入榜条件，不再拿它当状态；
  // 这里区分的是「红盘加速」还是「跌着被拉起」，后者才是尾盘脉冲。
  if ((changePct ?? 0) < 0) return '深水脉冲';
  return speedPct >= 1 ? '尾盘加速' : '尾盘微升';
}

async function buildSnapshot(tradeDate: string): Promise<SpeedSnapshot | null> {
  const cached = cache.get(tradeDate);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const view = resolveCloseSpeed(tradeDate, ROW_LIMIT);
  if (!view.rows.length) return null;

  // 归档已在生成时剔除退市整理期个股；这里再兜一层，防止旧归档被直接复用。
  const candidates = view.rows.filter((row) => !isDelistedName(row.name));

  const rows = await mapLimit(candidates, 10, async (row) => {
    const [metadata, history] = await Promise.all([
      fetchStockMetadata(row.code).catch(() => null),
      fetchRecentLimitHistory(row.code, row.name).catch(() => null),
    ]);
    const limitPct = nominalLimitPct(row.code, row.name);
    const concepts = metadata?.concepts ?? [];
    return {
      code: row.code,
      name: row.name,
      price: row.price,
      changePct: row.changePct,
      speedPct: row.speedPct,
      refPrice: row.refPrice,
      amount: row.amount,
      turnoverPct: null,
      high: null,
      previousClose: null,
      mainNetInflow: null,
      industry: metadata?.industry ?? null,
      concepts,
      // 概念走 F10 兜底，行业来自行情详情；两者不是同一条链路，
      // 行业取不到时概念仍是当日真实分类，所以分开计数而不是整体降级成缺失。
      metadataState: concepts.length
        ? metadata?.industry
          ? ('READY' as const)
          : ('DEGRADED' as const)
        : ('MISSING' as const),
      metadataAsOf: metadata ? new Date().toISOString() : null,
      quoteTime: `${fmtDate(view.tradeDate ?? tradeDate)}T15:00:00+08:00`,
      recentLimitCount: history?.count ?? null,
      recentLimitSessions: history?.sessions ?? 20,
      recentLimitState: history?.status ?? ('MISSING' as const),
      recentLimitMethod: history?.method ?? null,
      recentLimitReason: history?.reason ?? null,
      limitPct,
      distanceToLimitPct: Math.max(0, limitPct - (row.changePct ?? 0)),
      status: rowStatus(row.changePct, row.speedPct, limitPct),
    } satisfies EnrichedRow;
  });

  const snapshot = {
    ...view,
    rows,
    coverage: {
      ...view.coverage,
      conceptReady: rows.filter((row) => row.concepts.length).length,
      industryReady: rows.filter((row) => row.industry).length,
      recentLimitReady: rows.filter(
        (row) => row.recentLimitState !== 'MISSING',
      ).length,
      returned: rows.length,
    },
    source: `腾讯 1 分钟 K 线 · 涨速 ${view.windowStart} → ${view.windowEnd}`,
    retrievedAt: new Date().toISOString(),
  };
  cache.set(tradeDate, { expiresAt: Date.now() + 5 * 60_000, value: snapshot });
  return snapshot;
}

export async function GET() {
  const context = await getMarketDateContext().catch(() => null);
  if (!context)
    return Response.json(
      {
        status: 'MISSING',
        tradeDate: null,
        rows: [],
        reason: '无法确认目标交易日，未使用其他日期行情',
      },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );

  const exact = await buildSnapshot(context.tradeDate).catch(() => null);
  if (exact)
    return Response.json(
      { ...exact, requestedDate: context.tradeDate },
      { headers: { 'cache-control': 'no-store' } },
    );

  const latest = CLOSE_SPEED_DATES.at(-1);
  if (latest && latest !== context.tradeDate) {
    const fallback = await buildSnapshot(latest).catch(() => null);
    if (fallback)
      return Response.json(
        {
          ...fallback,
          status: 'DEGRADED',
          requestedDate: context.tradeDate,
          sourceState: 'STALE',
          reasons: [
            `${fmtDate(context.tradeDate)} 还没有涨速归档；当前展示 ${fmtDate(
              latest,
            )} 收盘涨速，不是目标交易日数据。`,
            ...fallback.reasons,
          ],
        },
        { headers: { 'cache-control': 'no-store' } },
      );
  }

  return Response.json(
    {
      status: 'MISSING',
      tradeDate: null,
      requestedDate: context.tradeDate,
      rows: [],
      reasons: [
        CLOSE_SPEED_DATES.length
          ? `涨速归档没有 ${fmtDate(context.tradeDate)}，现有覆盖 ${fmtDate(
              CLOSE_SPEED_DATES[0],
            )} 至 ${fmtDate(CLOSE_SPEED_DATES.at(-1) as string)}。`
          : '涨速归档为空，先运行 npm run speed:build 生成。',
      ],
    },
    { status: 503, headers: { 'cache-control': 'no-store' } },
  );
}
