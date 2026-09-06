import type {
  CloseSnapshot,
  IntradayEmotionSnapshot,
} from '@/lib/close-history';
import { CLOSE_HISTORY } from '@/lib/close-history';
import { emotionReading } from '@/lib/market-reading';
import { getIntradayEmotionSnapshot } from '@/lib/market';
import { loadArchivedSessionSnapshot } from '@/lib/market-session';
import {
  loadCloseHistory,
  loadLatestModuleSnapshot,
  saveModuleSnapshot,
} from '@/lib/persistence';

export const dynamic = 'force-dynamic';

function fromCloseSnapshot(
  snapshot: CloseSnapshot,
  reason?: string,
): IntradayEmotionSnapshot {
  const reading = emotionReading({
    ...snapshot,
    poolsReady: true,
    breadthReady: true,
    stale: Boolean(reason),
  });
  return {
    status:
      reason || !reading.usable || !reading.indexReady ? 'DEGRADED' : 'READY',
    retrievedAt: `${snapshot.date}T15:00:00+08:00`,
    tradeDate: snapshot.date.replaceAll('-', ''),
    requestedDate: snapshot.date.replaceAll('-', ''),
    phase: '休市快照',
    sessionState: 'CLOSED',
    sourceState: reason ? 'STALE' : 'ARCHIVED',
    cutoff: '15:00',
    source: snapshot.source,
    reason,
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
    if (persisted)
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
    const latest = history.at(-1);
    if (latest)
      return Response.json(
        fromCloseSnapshot(
          latest,
          '盘中情绪行情源正在重连，暂显示最近交易日收盘定格',
        ),
        { headers: { 'cache-control': 'no-store' } },
      );
    return Response.json(
      {
        status: 'MISSING',
        retrievedAt: new Date().toISOString(),
        reason: '盘中情绪数据暂时不可用，正在自动重连',
      },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }
}
