import {
  CLOSE_HISTORY,
  type CloseSnapshot,
  type CloseStock,
} from '@/lib/close-history';
import calendar from '@/lib/trading-calendar.generated.json';
import type { getSpeedSnapshot } from '@/lib/market';
import { updateInfluenceHistory } from '@/lib/core-influence-history';
import { resolveTrackingCutoff } from '@/lib/tracking-cutoff';
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
import {
  attachTenLine,
  fetchDailyCloses,
  type TenLineCarrier,
} from '@/lib/daily-close-ma10';
import { fetchLiveQuotes } from '@/lib/live-quote';

export const dynamic = 'force-dynamic';
const cache = new Map<string, { at: number; value: unknown }>();
const pending = new Map<string, Promise<unknown>>();
const dashed = (d: string) =>
  d.includes('-') ? d : `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;

function preserveConceptTiming(day: TrackingDay | undefined) {
  if (!day?.concepts || !Object.keys(day.concepts).length) return day;
  const closeAt = Date.parse(`${dashed(day.date)}T15:00:00+08:00`);
  const lateAt = [day.conceptsAvailableAt, day.capturedAt]
    .map((value) => Date.parse(value ?? ''))
    .filter(Number.isFinite)
    .some((value) => value > closeAt);
  return lateAt && day.conceptsState === 'READY'
    ? { ...day, conceptsState: 'RECOVERED_LATE' as const }
    : day;
}

/**
 * 给断板老高标补上各自真实日线收盘的 10 日线。
 * 只取日线、只用不晚于目标日的收盘；取不到就由 attachTenLine 逐条写明原因。
 */
async function attachDailyTenLine<T extends TenLineCarrier>(
  rows: T[],
  date: string,
) {
  if (!rows.length) return attachTenLine(rows, new Map(), date);
  const codes = rows.map((row) => ({ code: row.code }));
  // 日线与实时快照并行取；两者互不依赖，任一失败都不影响另一个。
  const [series, quotes] = await Promise.all([
    fetchDailyCloses(codes),
    fetchLiveQuotes(codes.map((row) => row.code)).catch(() => new Map()),
  ]);
  return attachTenLine(rows, series, date, quotes);
}

async function capture(requested: string, lookback: number) {
  let storageReason: string | null = null;
  const history = enrichEmotionCloses(
    await loadCloseHistory().catch(() => {
      storageReason = '归档库暂不可用，使用明确日期的本地收盘包';
      return CLOSE_HISTORY.snapshots;
    }),
  );
  const context =
    requested === 'latest'
      ? await getMarketDateContext().catch(() => {
          storageReason =
            '行情交易日接口暂不可用；仅展示已保存且明确日期的观察';
          return null;
        })
      : null;
  const requestedDay = context
    ? dashed(context.requestedDate)
    : new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
  const sameDaySaved =
    requested === 'latest'
      ? await loadExactModuleSnapshot<TrackingDay>(
          'emotion-tracking-evidence',
          requestedDay,
        ).catch(() => null)
      : null;
  const date =
    requested === 'latest'
      ? sameDaySaved?.date === requestedDay
        ? requestedDay
        : context
          ? dashed(context.tradeDate)
          : (history.at(-1)?.date ?? requestedDay)
      : requested;
  const live =
    context?.sessionState === 'LIVE' &&
    context.sourceState === 'LIVE' &&
    dashed(context.tradeDate) === date;
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
  const saved =
    sameDaySaved?.date === date
      ? sameDaySaved
      : await loadExactModuleSnapshot<TrackingDay>(
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
  const existingEvidence = evidence[date];
  if (existingEvidence)
    evidence[date] = preserveConceptTiming(existingEvidence)!;
  if (live) {
    const candidates = trackingCandidates(history, date, lookback);
    const speed = await loadExactModuleSnapshot<
      Awaited<ReturnType<typeof getSpeedSnapshot>>
    >('speed', date).catch(() => null);
    const speedReceivedAt = Date.now();
    const visibleSpeed =
      speed?.tradeDate === context.tradeDate && speed.sourceState === 'LIVE'
        ? speed.rows.filter((row) => {
            const q = Date.parse(row.quoteTime ?? '');
            const quoteDate = Number.isFinite(q)
              ? new Date(q + 8 * 3_600_000)
                  .toISOString()
                  .slice(0, 10)
                  .replaceAll('-', '')
              : '';
            return (
              Number.isFinite(q) &&
              quoteDate === context.tradeDate &&
              q <= speedReceivedAt &&
              speedReceivedAt - q <= 120_000 &&
              row.changePct !== null &&
              row.speedPct !== null
            );
          })
        : [];
    const styleRows = [...visibleSpeed]
      .filter((row) => (row.changePct ?? 0) > 0)
      .sort(
        (a, b) =>
          (b.speedPct ?? -Infinity) - (a.speedPct ?? -Infinity) ||
          (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity),
      )
      .slice(0, 12);
    const memberRows = visibleSpeed.slice(0, 12);
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
          ...visibleSpeed,
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
          memberRows
            .filter((row) => row.concepts.length > 0)
            .map((row) => [row.code, row.concepts]),
        ),
      },
      conceptStates: {
        ...saved?.conceptStates,
        ...evidence[date]?.conceptStates,
        ...Object.fromEntries(
          memberRows.map((row) => [
            row.code,
            row.concepts.length > 0 ? ('READY' as const) : ('MISSING' as const),
          ]),
        ),
      },
      conceptsAvailableAt: memberRows.length
        ? memberRows
            .map((row) => row.metadataAsOf!)
            .sort()
            .at(-1)
        : (saved?.conceptsAvailableAt ?? evidence[date]?.conceptsAvailableAt),
      conceptsState: memberRows.length
        ? memberRows.some((row) => row.concepts.length > 0)
          ? 'DEGRADED'
          : 'MISSING'
        : (saved?.conceptsState ?? evidence[date]?.conceptsState ?? 'MISSING'),
      styleCandidates: styleRows.map(toStyleStock),
      styleMembers: memberRows.map(toStyleStock),
      source:
        '当日独立分钟/逐股报价请求；复用当日有准确quoteTime的涨速样本（最多12只）作为styleCandidates/styleMembers观察，不授予龙头身份',
    };
    const persistedDay = preserveConceptTiming(day)!;
    evidence[date] = persistedDay;
    if (JSON.stringify(persistedDay).length < 1_800_000)
      await saveModuleSnapshot('emotion-tracking-evidence', persistedDay).catch(
        () => {
          storageReason = '本次可显示，保存失败；跨日跟踪可能有缺口';
        },
      );
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
    const persistedDay = preserveConceptTiming(day)!;
    evidence[date] = persistedDay;
    if (JSON.stringify(persistedDay).length < 1_800_000)
      await saveModuleSnapshot('emotion-tracking-evidence', persistedDay).catch(
        () => {
          storageReason = '收盘分钟保存失败，已明确保留缺口';
        },
      );
    else storageReason = '收盘分钟包超过单次归档大小限制，本次未持久化';
  }
  if (!history.some((x) => x.date === date) && !evidence[date])
    return {
      status: 'MISSING',
      date,
      cutoff,
      reason: '该日期没有可核验快照，未改用其他交易日',
    };
  const fixedWindow = resolveTrackingCutoff(
    date,
    evidence[date],
    history.some(
      (snapshot) =>
        snapshot.date === date &&
        snapshot.cutoff === '15:00' &&
        snapshot.status === 'READY',
    ),
  );
  if (!live && fixedWindow.lastKnown) {
    cutoff = fixedWindow.cutoff;
    storageReason = [storageReason, fixedWindow.reason]
      .filter(Boolean)
      .join('；');
  }
  // A saved intraday capture is never relabelled as a completed close. Preserve
  // its actual cutoff when this date's close has not been archived.
  if (!live && evidence[date])
    evidence[date] = {
      ...evidence[date],
      sessionState: 'CLOSED',
      asOf: fixedWindow.lastKnown
        ? (evidence[date].asOf ?? evidence[date].availableAt)
        : undefined,
    };
  const result = buildEmotionTracking(
    history,
    evidence,
    date,
    lookback,
    cutoff,
    calendar.dates,
  );
  // 10日线必须是每只老高标自己的日线收盘 MA10，不能拿池内稀疏涨幅重建。
  // 取数失败时 attachTenLine 会逐条写明原因，绝不退回重建口径。
  // 断板老高标与「仍在板上」的高标都要 5/10 日线与现价，一起取数再拆回两组。
  const sealedRows = result.oldLeaders.stillSealed ?? [];
  const attached = await attachDailyTenLine(
    [...result.oldLeaders.rows, ...sealedRows],
    date,
  ).catch((error) => {
    storageReason = [
      storageReason,
      `日线收盘取数失败，均线不显示：${error instanceof Error ? error.message : '未知错误'}`,
    ]
      .filter(Boolean)
      .join('；');
    return null;
  });
  const withTenLine = attached
    ? (() => {
        const brokenCodes = new Set(result.oldLeaders.rows.map((x) => x.code));
        return {
          ...result,
          oldLeaders: {
            ...result.oldLeaders,
            rows: attached.rows.filter((x) => brokenCodes.has(x.code)),
            stillSealed: attached.rows.filter((x) => !brokenCodes.has(x.code)),
            tenLine: attached.tenLine,
          },
        };
      })()
    : result;
  const priorInfluence = await loadLatestModuleSnapshot<{
    records: Parameters<typeof updateInfluenceHistory>[1];
  }>('emotion-core-influence').catch(() => null);
  const influenceHistory = updateInfluenceHistory(
    withTenLine,
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
    ...withTenLine,
    observationMode:
      fixedWindow.lastKnown && !live ? 'LAST_KNOWN' : live ? 'LIVE' : 'CLOSE',
    observationReason:
      fixedWindow.lastKnown && !live ? fixedWindow.reason : null,
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
