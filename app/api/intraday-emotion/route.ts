import type {
  CloseSnapshot,
  IntradayEmotionSnapshot,
} from '@/lib/close-history';
import { CLOSE_HISTORY } from '@/lib/close-history';
import { excludeDelistedFromSnapshot } from '@/lib/close-snapshot-filter';
import { emotionReading } from '@/lib/market-reading';
import { getIntradayEmotionSnapshot, getMarketDateContext } from '@/lib/market';
import {
  archivedAuctionEvidence,
  archivedIntradayEvidence,
} from '@/lib/close-derived-evidence';
import { loadArchivedSessionSnapshot } from '@/lib/market-session';
import {
  loadCloseHistory,
  loadLatestModuleSnapshot,
  saveModuleSnapshot,
} from '@/lib/persistence';

export const dynamic = 'force-dynamic';

function fromCloseSnapshot(
  raw: CloseSnapshot,
  reason?: string,
): IntradayEmotionSnapshot {
  // 退市整理期个股不计入三池与梯队，统计量随之重算。
  const snapshot = excludeDelistedFromSnapshot(raw);
  const reading = emotionReading({
    ...snapshot,
    poolsReady: true,
    breadthReady: true,
    stale: Boolean(reason),
  });
  return {
    status:
      reason ||
      snapshot.evidenceStatus === 'DEGRADED' ||
      !reading.usable ||
      !reading.indexReady
        ? 'DEGRADED'
        : 'READY',
    retrievedAt: `${snapshot.date}T15:00:00+08:00`,
    tradeDate: snapshot.date.replaceAll('-', ''),
    requestedDate: snapshot.date.replaceAll('-', ''),
    phase: '休市快照',
    sessionState: 'CLOSED',
    sourceState: reason ? 'STALE' : 'ARCHIVED',
    cutoff: '15:00',
    source: [snapshot.source, snapshot.breadth.scope]
      .filter(Boolean)
      .join(' · '),
    reason:
      [
        reason,
        snapshot.evidenceStatus === 'DEGRADED'
          ? '基础收盘行情已核验；行业、资金与分钟路径按独立能力展示，非完整复盘证据包。'
          : null,
      ]
        .filter(Boolean)
        .join('；') || undefined,
    limitUp: snapshot.limitUp,
    failed: snapshot.failed,
    limitDown: snapshot.limitDown,
    sealRate: snapshot.sealRate,
    highestBoard: snapshot.highestBoard,
    consecutiveCount: snapshot.consecutiveCount,
    breadth: snapshot.breadth,
    indices: snapshot.indices,
    indexMood: reading.indexMood,
    shortMood: reading.board,
    cycleNode: reading.headline,
    concentratedIndustries: snapshot.concentratedIndustries,
    leaders: snapshot.leaders,
    intradayEvidence: archivedIntradayEvidence(snapshot.date),
    auctionEvidence: archivedAuctionEvidence(snapshot.date),
    ladders: snapshot.ladders,
    failedStocks: snapshot.failedStocks,
    limitDownStocks: snapshot.limitDownStocks,
    coverage: {
      poolsReady: 3,
      poolsRequested: 3,
      breadthReady: true,
    },
  };
}

export async function GET() {
  const marketContext = await getMarketDateContext().catch(() => null);
  if (marketContext?.sessionState === 'CLOSED') {
    const history = await loadCloseHistory().catch(
      () => CLOSE_HISTORY.snapshots,
    );
    const exact = history.find(
      (snapshot) =>
        snapshot.date.replaceAll('-', '') === marketContext.tradeDate,
    );
    if (exact)
      return Response.json(
        {
          ...fromCloseSnapshot(exact),
          requestedDate: marketContext.requestedDate,
        },
        { headers: { 'cache-control': 'no-store' } },
      );
  }
  const archived =
    await loadArchivedSessionSnapshot<IntradayEmotionSnapshot>(
      'intraday-emotion',
    );
  if (archived?.status === 'READY') {
    const history = await loadCloseHistory().catch(
      () => CLOSE_HISTORY.snapshots,
    );
    const exactClose = history.find(
      (snapshot) => snapshot.date.replaceAll('-', '') === archived.tradeDate,
    );
    return Response.json(
      exactClose
        ? {
            ...fromCloseSnapshot(exactClose),
            requestedDate: archived.requestedDate,
          }
        : archived,
      { headers: { 'cache-control': 'no-store' } },
    );
  }

  try {
    const snapshot = await getIntradayEmotionSnapshot();
    await saveModuleSnapshot('intraday-emotion', snapshot).catch(
      () => undefined,
    );
    return Response.json(snapshot, {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    const persisted = await loadLatestModuleSnapshot<IntradayEmotionSnapshot>(
      'intraday-emotion',
    ).catch(() => null);
    if (
      persisted &&
      marketContext &&
      persisted.tradeDate.replaceAll('-', '') === marketContext.tradeDate
    )
      return Response.json(
        {
          ...persisted,
          status: 'DEGRADED',
          sourceState: 'STALE',
          retrievedAt: persisted.retrievedAt,
          staleAt: persisted.retrievedAt,
          reason: `盘中情绪行情源短暂波动，展示最近成功快照：${String(error)}`,
        },
        { headers: { 'cache-control': 'no-store' } },
      );
    const history = await loadCloseHistory().catch(() => []);
    const latest = marketContext
      ? history.find(
          (snapshot) =>
            snapshot.date.replaceAll('-', '') === marketContext.tradeDate,
        )
      : undefined;
    if (latest)
      return Response.json(
        fromCloseSnapshot(
          latest,
          marketContext?.sourceState === 'ARCHIVED'
            ? undefined
            : '盘中情绪行情源正在重连，暂显示最近交易日收盘定格',
        ),
        { headers: { 'cache-control': 'no-store' } },
      );
    return Response.json(
      {
        status: 'MISSING',
        retrievedAt: new Date().toISOString(),
        reason: `盘中情绪数据缺失（${String(error)}）；正在自动重连`,
      },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }
}
