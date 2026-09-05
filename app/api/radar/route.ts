import { getRadarSnapshot } from '@/lib/market';
import { loadArchivedSessionSnapshot } from '@/lib/market-session';
import {
  loadLatestModuleSnapshot,
  saveModuleSnapshot,
} from '@/lib/persistence';

export const dynamic = 'force-dynamic';
let lastSnapshot: Awaited<ReturnType<typeof getRadarSnapshot>> | null = null;

export async function GET() {
  const archived =
    await loadArchivedSessionSnapshot<
      Awaited<ReturnType<typeof getRadarSnapshot>>
    >('radar');
  if (archived)
    return Response.json(archived, {
      headers: { 'cache-control': 'no-store' },
    });
  try {
    const snapshot = await getRadarSnapshot();
    if (snapshot.events.length) {
      lastSnapshot = snapshot;
      await saveModuleSnapshot('radar', snapshot).catch(() => undefined);
      return Response.json(snapshot, {
        headers: { 'cache-control': 'no-store' },
      });
    }
    const persisted = await loadLatestModuleSnapshot<typeof snapshot>(
      'radar',
    ).catch(() => null);
    if (persisted)
      return Response.json(
        {
          ...persisted,
          status: 'DEGRADED',
          sourceState: 'STALE',
          staleAt: persisted.persistedAt,
          retrievedAt: new Date().toISOString(),
          reason: '板块端点暂时不可用，展示最近成功快照并单独重连',
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
        Awaited<ReturnType<typeof getRadarSnapshot>>
      >('radar').catch(() => null));
    if (fallback)
      return Response.json(
        {
          ...fallback,
          status: 'DEGRADED',
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
        retrievedAt: new Date().toISOString(),
        reason: '行情源暂时不可用，正在自动重连',
        events: [],
      },
      { status: 503 },
    );
  }
}
