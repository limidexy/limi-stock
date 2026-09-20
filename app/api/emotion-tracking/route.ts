import { CLOSE_HISTORY, type CloseSnapshot } from '@/lib/close-history';
import {
  buildEmotionTracking,
  trackingCandidates,
  stocksOf,
  type TrackingDay,
  type TrackingHistory,
} from '@/lib/emotion-tracking';
import {
  TRACKING_HISTORY,
  enrichEmotionCloses,
} from '@/lib/emotion-tracking-source';
import {
  fetchTrackingEvidence,
  getIntradayEmotionSnapshot,
  getMarketDateContext,
} from '@/lib/market';
import {
  loadCloseHistory,
  loadExactModuleSnapshot,
  saveModuleSnapshot,
} from '@/lib/persistence';

export const dynamic = 'force-dynamic';
const cache = new Map<string, { at: number; value: unknown }>();
const pending = new Map<string, Promise<unknown>>();
const dashed = (d: string) =>
  d.includes('-') ? d : `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;

async function capture(requested: string, lookback: number) {
  let storageReason: string | null = null;
  const history = enrichEmotionCloses(
    await loadCloseHistory().catch(() => {
      storageReason = '归档库暂不可用，使用明确日期的本地收盘包';
      return CLOSE_HISTORY.snapshots;
    }),
  );
  const context = requested === 'latest' ? await getMarketDateContext() : null;
  const date = context ? dashed(context.tradeDate) : requested;
  const live =
    context?.sessionState === 'LIVE' && context.sourceState === 'LIVE';
  let cutoff = '15:00';
  const evidence: TrackingHistory = { ...TRACKING_HISTORY };
  for (const day of history)
    if (day.closeQuotes)
      evidence[day.date] = {
        date: day.date,
        source: evidence[day.date]?.source ?? day.source,
        previousDate: day.previousDate,
        quotes: day.closeQuotes,
        trends: evidence[day.date]?.trends ?? {},
        concepts: evidence[day.date]?.concepts,
        noTrade: evidence[day.date]?.noTrade,
      };
  const saved = await loadExactModuleSnapshot<TrackingDay>(
    'emotion-tracking-evidence',
    date,
  ).catch(() => null);
  if (saved?.date === date)
    evidence[date] = {
      ...saved,
      ...evidence[date],
      quotes: { ...saved.quotes, ...evidence[date]?.quotes },
      trends: { ...saved.trends, ...evidence[date]?.trends },
      noTrade: { ...saved.noTrade, ...evidence[date]?.noTrade },
    };
  if (live) {
    const candidates = trackingCandidates(history, date, lookback);
    const codes = [
      ...new Set(
        [
          ...candidates.leaders,
          ...candidates.failed,
          ...stocksOf(candidates.previous),
        ].map((x) => x.code),
      ),
    ];
    const fetched = await fetchTrackingEvidence(codes, context.tradeDate);
    // Refresh pools AFTER the quote capture; do not advance a stale pool snapshot's cutoff.
    const snap = await getIntradayEmotionSnapshot(true);
    if (snap.tradeDate !== context.tradeDate || snap.sourceState !== 'LIVE')
      throw Error('盘中快照日期或状态未对齐');
    cutoff = snap.cutoff;
    const current = {
      ...snap,
      date,
      cutoff: '15:00',
      status: snap.status,
      coverage: {
        reported: snap.breadth.rowsAvailable,
        available: snap.breadth.rowsAvailable,
      },
      ladders: snap.ladders ?? [],
      failedStocks: snap.failedStocks ?? [],
      limitDownStocks: snap.limitDownStocks ?? [],
    } as unknown as CloseSnapshot;
    const index = history.findIndex((x) => x.date === date);
    if (index >= 0) history[index] = current;
    else history.push(current);
    const quotes: TrackingDay['quotes'] = {};
    for (const [code, q] of fetched.quotes)
      if (q.changePct !== null && q.quoteTime)
        quotes[code] = {
          changePct: q.changePct,
          quoteTime: q.quoteTime,
          source: q.quoteSource ?? '东方财富盘中报价',
        };
    const day: TrackingDay = {
      date,
      quotes,
      trends: { ...saved?.trends, ...fetched.trends },
      asOf: snap.retrievedAt,
      sessionState: 'LIVE',
      source: '当日实时请求；截止到本次行情池核验时点，报价仅接受60秒内样本',
    };
    evidence[date] = day;
    if (JSON.stringify(day).length < 1_800_000)
      await saveModuleSnapshot('emotion-tracking-evidence', day).catch(() => {
        storageReason = '本次可显示，保存失败；跨日跟踪可能有缺口';
      });
    else storageReason = '分钟包超过单次归档大小限制，本次未持久化';
  } else if (
    context &&
    context.requestedDate === context.tradeDate &&
    !TRACKING_HISTORY[date] &&
    history.some((x) => x.date === date)
  ) {
    // Finalize the newly closed session while ndays=1 still returns this exact date.
    const candidates = trackingCandidates(history, date, lookback);
    const codes = [
      ...new Set(
        [
          ...candidates.leaders,
          ...candidates.failed,
          ...stocksOf(candidates.previous),
        ].map((x) => x.code),
      ),
    ];
    const fetched = await fetchTrackingEvidence(codes, context.tradeDate);
    const close = history.find((x) => x.date === date)!;
    const day: TrackingDay = {
      date,
      quotes: close.closeQuotes ?? {},
      trends: { ...saved?.trends, ...fetched.trends },
      sessionState: 'CLOSED',
      source: '当日15:00收盘报价与同日分钟路径',
    };
    evidence[date] = day;
    if (JSON.stringify(day).length < 1_800_000)
      await saveModuleSnapshot('emotion-tracking-evidence', day).catch(() => {
        storageReason = '收盘分钟保存失败，已明确保留缺口';
      });
    else storageReason = '收盘分钟包超过单次归档大小限制，本次未持久化';
  }
  if (!history.some((x) => x.date === date))
    return {
      status: 'MISSING',
      date,
      cutoff,
      reason: '该日期没有可核验快照，未改用其他交易日',
    };
  // A saved intraday capture may contribute paths, never midday prices to a close view.
  if (!live && evidence[date])
    evidence[date] = {
      ...evidence[date],
      sessionState: 'CLOSED',
      asOf: undefined,
    };
  const result = buildEmotionTracking(
    history,
    evidence,
    date,
    lookback,
    cutoff,
  );
  return {
    ...result,
    sourceState: live ? 'LIVE' : 'ARCHIVED',
    retrievedAt: new Date().toISOString(),
    storageReason,
    status: storageReason ? 'DEGRADED' : result.status,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url),
    date = url.searchParams.get('date') ?? 'latest';
  const lookback = Number(url.searchParams.get('lookback') ?? 10);
  if (
    (date !== 'latest' && !/^\d{4}-\d{2}-\d{2}$/.test(date)) ||
    ![5, 10, 20].includes(lookback)
  )
    return Response.json(
      { status: 'MISSING', reason: '日期或观察区间无效' },
      { status: 400 },
    );
  const key = `${date}:${lookback}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < 25_000)
    return Response.json(cached.value, {
      headers: { 'cache-control': 'no-store' },
    });
  try {
    if (!pending.has(key))
      pending.set(
        key,
        capture(date, lookback).finally(() => pending.delete(key)),
      );
    const value = await pending.get(key)!;
    cache.set(key, { at: Date.now(), value });
    if (cache.size > 30) cache.delete(cache.keys().next().value!);
    return Response.json(value, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return Response.json(
      {
        status: 'MISSING',
        date,
        reason: '目标日跟踪证据暂不可用；没有使用旧行情替代',
      },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }
}
