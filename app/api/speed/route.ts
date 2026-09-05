import { getSpeedSnapshot } from '@/lib/market';
import { loadArchivedSessionSnapshot } from '@/lib/market-session';
import {
  loadLatestModuleSnapshot,
  saveModuleSnapshot,
} from '@/lib/persistence';

export const dynamic = 'force-dynamic';
let lastSnapshot: Awaited<ReturnType<typeof getSpeedSnapshot>> | null = null;

export async function GET() {
  const archived =
    await loadArchivedSessionSnapshot<
      Awaited<ReturnType<typeof getSpeedSnapshot>>
    >('speed');
  if (archived)
    return Response.json(archived, {
      headers: { 'cache-control': 'no-store' },
    });
  try {
    const snapshot = await getSpeedSnapshot();
    if (snapshot.rows.length) {
      lastSnapshot = snapshot;
      await saveModuleSnapshot('speed', snapshot).catch(() => undefined);
    }
    return Response.json(snapshot, {
      headers: { 'cache-control': 'no-store' },
    });
  } catch {
    const fallback =
      lastSnapshot ??
      (await loadLatestModuleSnapshot<
        Awaited<ReturnType<typeof getSpeedSnapshot>>
      >('speed').catch(() => null));
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
        rows: [],
      },
      { status: 503 },
    );
  }
}
