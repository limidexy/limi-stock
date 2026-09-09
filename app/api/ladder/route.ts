import { getLadderSnapshot, repairArchivedLadder } from '@/lib/market';
import { loadArchivedSessionSnapshot } from '@/lib/market-session';
import {
  loadLatestModuleSnapshot,
  saveModuleSnapshot,
} from '@/lib/persistence';

export const dynamic = 'force-dynamic';
let lastSnapshot: Awaited<ReturnType<typeof getLadderSnapshot>> | null = null;

export async function GET() {
  const archived =
    await loadArchivedSessionSnapshot<
      Awaited<ReturnType<typeof getLadderSnapshot>>
    >('ladder');
  if (archived)
    return Response.json(await repairArchivedLadder(archived), {
      headers: { 'cache-control': 'no-store' },
    });
  try {
    const snapshot = await getLadderSnapshot();
    if (snapshot.competitors.length) {
      lastSnapshot = snapshot;
      await saveModuleSnapshot('ladder', snapshot).catch(() => undefined);
      return Response.json(snapshot, {
        headers: { 'cache-control': 'no-store' },
      });
    }
    if (
      snapshot.tradeDate &&
      snapshot.sessionState === 'CLOSED' &&
      snapshot.sourceState === 'ARCHIVED'
    )
      return Response.json(snapshot, {
        headers: { 'cache-control': 'no-store' },
      });
    const persisted = await loadLatestModuleSnapshot<typeof snapshot>(
      'ladder',
    ).catch(() => null);
    if (persisted)
      return Response.json(
        {
          ...persisted,
          status: 'DEGRADED',
          sourceState: 'STALE',
          staleAt: persisted.persistedAt,
          retrievedAt: persisted.retrievedAt,
          reason: '连板池端点暂时不可用，展示最近成功梯队并单独重连',
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
        Awaited<ReturnType<typeof getLadderSnapshot>>
      >('ladder').catch(() => null));
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
          retrievedAt: fallback.retrievedAt,
          reason: '行情源短暂波动，展示最近成功快照并自动重连',
        },
        { headers: { 'cache-control': 'no-store' } },
      );
    return Response.json(
      {
        status: 'MISSING',
        retrievedAt: new Date().toISOString(),
        reason: '行情源暂时不可用，正在自动重连',
        promotion: [],
        competitors: [],
      },
      { status: 503 },
    );
  }
}
