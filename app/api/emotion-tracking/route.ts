import {
  CLOSE_HISTORY,
  type CloseSnapshot,
  type CloseStock,
} from '@/lib/close-history';
import calendar from '@/lib/trading-calendar.generated.json';
import type { getSpeedSnapshot } from '@/lib/market';
import { updateInfluenceHistory } from '@/lib/core-influence-history';
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
  loadLatestModuleSnapshot,
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
        cutoff: '15:00',
        source: evidence[day.date]?.source ?? day.source,
        sourceState: evidence[day.date]?.sourceState ?? 'ARCHIVED',
        availableAt:
          evidence[day.date]?.availableAt ?? `${day.date}T15:00:00+08:00`,
        capturedAt: evidence[day.date]?.capturedAt,
        previousDate: day.previousDate,
        quotes: day.closeQuotes,
        trends: evidence[day.date]?.trends ?? {},
        concepts: evidence[day.date]?.concepts,
        conceptsAvailableAt: evidence[day.date]?.conceptsAvailableAt,
        conceptsState: evidence[day.date]?.conceptsState,
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
    const speed = await loadExactModuleSnapshot<
      Awaited<ReturnType<typeof getSpeedSnapshot>>
    >('speed', date).catch(() => null);
    const visibleSpeed =
      speed?.tradeDate === context.tradeDate && speed.sourceState === 'LIVE'
        ? speed.rows.filter((row) => {
            const q = Date.parse(row.quoteTime ?? '');
            return (
              Number.isFinite(q) &&
              q <= Date.now() &&
              Date.now() - q <= 120_000 &&
              row.metadataState === 'READY' &&
              Boolean(row.metadataAsOf) &&
              Date.parse(row.metadataAsOf!) <= Date.now() &&
              row.concepts.length > 0
            );
          })
        : [];
    const styleRows = [...visibleSpeed]
      .filter((row) => (row.amount ?? 0) >= 1e9 && (row.changePct ?? 0) > 0)
      .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))
      .slice(0, 3);
    const styleConcepts = new Set(styleRows.flatMap((row) => row.concepts));
    const memberRows = visibleSpeed
      .filter((row) => row.concepts.some((name) => styleConcepts.has(name)))
      .slice(0, 12);
    const toStyleStock = (row: (typeof visibleSpeed)[number]): CloseStock => ({
      code: row.code,
      name: row.name,
      height: 0,
      changePct: row.changePct,
      industry: row.industry || '未分类',
      firstTouch: null,
      lastSeal: null,
      breakCount: 0,
      sealFund: null,
    });
    const codes = [
      ...new Set(
        [
          ...styleRows,
          ...memberRows,
          ...candidates.leaders,
          ...candidates.failed,
          ...stocksOf(candidates.previous),
        ].map((x) => x.code),
      ),
    ];
    const fetched = await fetchTrackingEvidence(codes, context.tradeDate);
    const captureTime = new Date().toISOString();
    // A pool endpoint failure must not delete valid independent minute captures.
    // Its old cutoff is never advanced or passed off as the fresh capture.
    const snap = await getIntradayEmotionSnapshot(true).catch(() => null);
    const poolAge =
      Date.parse(captureTime) - Date.parse(snap?.retrievedAt ?? '');
    const alignedPool =
      snap?.tradeDate === context.tradeDate &&
      snap.sourceState === 'LIVE' &&
      poolAge >= -60_000 &&
      poolAge <= 60_000;
    cutoff = alignedPool
      ? snap.cutoff
      : new Date(Date.parse(captureTime) + 8 * 3600_000)
          .toISOString()
          .slice(11, 16);
    if (cutoff > '11:30' && cutoff < '13:01') cutoff = '11:30';
    if (cutoff > '15:00') cutoff = '15:00';
    if (!alignedPool)
      storageReason =
        '情绪池暂不可用；仅保留真实分钟、报价与既有身份，池状态不确认';
    if (alignedPool) {
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
    }
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
      cutoff,
      previousDate: calendar.dates.filter((d) => d < date).at(-1),
      quotes,
      trends: { ...saved?.trends, ...fetched.trends },
      sourceState: 'LIVE',
      availableAt: alignedPool
        ? snap.retrievedAt
        : `${date}T${cutoff}:00+08:00`,
      capturedAt: captureTime,
      asOf: alignedPool ? snap.retrievedAt : `${date}T${cutoff}:00+08:00`,
      sessionState: 'LIVE',
      concepts: {
        ...saved?.concepts,
        ...evidence[date]?.concepts,
        ...Object.fromEntries(
          memberRows.map((row) => [row.code, row.concepts]),
        ),
      },
      conceptStates: {
        ...saved?.conceptStates,
        ...evidence[date]?.conceptStates,
        ...Object.fromEntries(
          memberRows.map((row) => [row.code, 'READY' as const]),
        ),
      },
      conceptsAvailableAt: memberRows.length
        ? memberRows
            .map((row) => row.metadataAsOf!)
            .sort()
            .at(-1)
        : (saved?.conceptsAvailableAt ?? evidence[date]?.conceptsAvailableAt),
      conceptsState: memberRows.length
        ? 'DEGRADED'
        : (saved?.conceptsState ?? evidence[date]?.conceptsState ?? 'MISSING'),
      styleCandidates: styleRows.map(toStyleStock),
      styleMembers: memberRows.map(toStyleStock),
      source:
        '当日独立分钟/逐股报价请求；非连板容量候选复用已保存涨速样本，仅触发观察，不授予龙头身份',
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
      cutoff: '15:00',
      quotes: close.closeQuotes ?? {},
      trends: { ...saved?.trends, ...fetched.trends },
      sourceState: 'ARCHIVED',
      availableAt: `${date}T15:00:00+08:00`,
      capturedAt: saved?.capturedAt ?? evidence[date]?.capturedAt,
      sessionState: 'CLOSED',
      concepts: saved?.concepts ?? evidence[date]?.concepts,
      conceptsAvailableAt:
        saved?.conceptsAvailableAt ?? evidence[date]?.conceptsAvailableAt,
      conceptsState:
        saved?.conceptsState ?? evidence[date]?.conceptsState ?? 'MISSING',
      source: '当日15:00收盘报价与同日分钟路径',
    };
    evidence[date] = day;
    if (JSON.stringify(day).length < 1_800_000)
      await saveModuleSnapshot('emotion-tracking-evidence', day).catch(() => {
        storageReason = '收盘分钟保存失败，已明确保留缺口';
      });
    else storageReason = '收盘分钟包超过单次归档大小限制，本次未持久化';
  }
  if (!history.some((x) => x.date === date) && !evidence[date])
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
  const priorInfluence = await loadLatestModuleSnapshot<{
    records: Parameters<typeof updateInfluenceHistory>[1];
  }>('emotion-core-influence').catch(() => null);
  const influenceHistory = updateInfluenceHistory(
    result,
    priorInfluence?.records ?? [],
  );
  const historyMonotone = !(priorInfluence?.records ?? []).some(
    (record) =>
      Date.parse(record.observedAt) > Date.parse(result.availableAt ?? ''),
  );
  if (
    live &&
    historyMonotone &&
    JSON.stringify(influenceHistory) !==
      JSON.stringify(priorInfluence?.records ?? [])
  ) {
    const storedInfluence = { date, records: influenceHistory };
    await saveModuleSnapshot('emotion-core-influence', storedInfluence).catch(
      () => {
        storageReason = [
          storageReason,
          '核心影响证据保存失败；本次仍显示已采集事实',
        ]
          .filter(Boolean)
          .join('；');
      },
    );
  }
  return {
    ...result,
    influenceHistory,
    sourceState: live ? 'LIVE' : 'ARCHIVED',
    retrievedAt: new Date().toISOString(),
    availableAt: result.availableAt,
    concepts: result.concepts,
    conceptsAvailableAt: result.conceptsAvailableAt,
    conceptsState: result.conceptsState,
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
