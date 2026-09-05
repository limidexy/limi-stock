import { getFlowSnapshot } from '@/lib/market';
import { loadArchivedSessionSnapshot } from '@/lib/market-session';
import {
  loadLatestModuleSnapshot,
  saveModuleSnapshot,
} from '@/lib/persistence';

export const dynamic = 'force-dynamic';
let lastSnapshot: Awaited<ReturnType<typeof getFlowSnapshot>> | null = null;

export async function GET() {
  const archived =
    await loadArchivedSessionSnapshot<
      Awaited<ReturnType<typeof getFlowSnapshot>>
    >('flow');
  if (archived)
    return Response.json(archived, {
      headers: { 'cache-control': 'no-store' },
    });
  try {
    const snapshot = await getFlowSnapshot();
    if (snapshot.series.length) {
      lastSnapshot = snapshot;
      await saveModuleSnapshot('flow', snapshot).catch(() => undefined);
      return Response.json(snapshot, {
        headers: { 'cache-control': 'no-store' },
      });
    }
    const persisted = await loadLatestModuleSnapshot<typeof snapshot>(
      'flow',
    ).catch(() => null);
    if (persisted)
      return Response.json(
        {
          ...persisted,
          status: 'DEGRADED',
          curveState: 'DEGRADED',
          splitState: 'DEGRADED',
          sourceState: 'STALE',
          staleAt: persisted.persistedAt,
          retrievedAt: new Date().toISOString(),
          reason: '分钟资金端点暂时不可用，展示最近成功快照并单独重连',
        },
        { headers: { 'cache-control': 'no-store' } },
      );
    return Response.json(snapshot, {
      headers: { 'cache-control': 'no-store' },
    });
  } catch {
    const fallback =
      lastSnapshot ??
      (await loadLatestModuleSnapshot<
        Awaited<ReturnType<typeof getFlowSnapshot>>
      >('flow').catch(() => null));
    if (fallback)
      return Response.json(
        {
          ...fallback,
          status: 'DEGRADED',
          curveState: 'DEGRADED',
          splitState: 'DEGRADED',
          sourceState: 'STALE',
          staleAt:
            'persistedAt' in fallback &&
            typeof fallback.persistedAt === 'string'
              ? fallback.persistedAt
              : fallback.retrievedAt,
          retrievedAt: new Date().toISOString(),
          reason: '行情源短暂波动，展示最近成功快照并自动重连',
        },
        { headers: { 'cache-control': 'no-store' } },
      );
    return Response.json(
      {
        status: 'MISSING',
        curveState: 'MISSING',
        splitState: 'MISSING',
        retrievedAt: new Date().toISOString(),
        reason: '行情源暂时不可用，正在自动重连',
        series: [],
        split: {
          inflow: [],
          outflow: [],
          cumulativeInflow: [],
          cumulativeOutflow: [],
          persistentStrong: [],
          persistentWeak: [],
          positiveCount: 0,
          negativeCount: 0,
        },
      },
      { status: 503 },
    );
  }
}
