import type {
  CloseSnapshot,
  IntradayEmotionSnapshot,
} from '@/lib/close-history';
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
  return {
    status: reason ? 'DEGRADED' : 'READY',
    retrievedAt: new Date().toISOString(),
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
    indexMood: snapshot.indexMood,
    shortMood: snapshot.shortMood,
    cycleNode: snapshot.cycleNode,
    concentratedIndustries: snapshot.concentratedIndustries,
    leaders: snapshot.leaders,
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
  if (archived?.status === 'READY')
    return Response.json(
      { ...archived, cutoff: '15:00' },
      { headers: { 'cache-control': 'no-store' } },
    );

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
          retrievedAt: new Date().toISOString(),
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
