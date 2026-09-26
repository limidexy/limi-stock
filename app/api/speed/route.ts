import {
  fetchRecentLimitHistory,
  fetchStockMetadata,
  getMarketDateContext,
  getSpeedSnapshot,
} from '@/lib/market';
import { archivedCloseSpeed } from '@/lib/close-derived-evidence';
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
  if (archived) {
    const rows = await Promise.all(
      archived.rows.map(async (row) => {
        if (row.metadataState === 'READY' && row.concepts.length) return row;
        const metadata = await fetchStockMetadata(row.code).catch(() => null);
        return metadata?.concepts.length
          ? {
              ...row,
              concepts: metadata.concepts,
              // A concept fetched after the archived session is useful for
              // display, but is not exact-date metadata.
              metadataState: 'DEGRADED' as const,
            }
          : row;
      }),
    );
    const conceptReady = rows.filter(
      (row) => row.metadataState === 'READY',
    ).length;
    const recentLimitReady = rows.filter(
      (row) => row.recentLimitState !== 'MISSING',
    ).length;
    const repaired = {
      ...archived,
      rows,
      status:
        conceptReady === rows.length && recentLimitReady === rows.length
          ? ('READY' as const)
          : archived.status,
      coverage: {
        requested: rows.length,
        conceptReady,
        recentLimitReady,
      },
    };
    return Response.json(repaired, {
      headers: { 'cache-control': 'no-store' },
    });
  }
  const context = await getMarketDateContext().catch(() => null);
  const exactCloseFallback =
    context?.sourceState === 'ARCHIVED'
      ? archivedCloseSpeed(context.tradeDate)
      : null;
  if (exactCloseFallback) {
    const rows = await Promise.all(
      exactCloseFallback.rows.map(async (row) => {
        const [metadata, history] = await Promise.all([
          fetchStockMetadata(row.code).catch(() => null),
          fetchRecentLimitHistory(row.code, row.name).catch(() => null),
        ]);
        return {
          ...row,
          industry: metadata?.industry ?? row.industry,
          concepts: metadata?.concepts ?? row.concepts,
          metadataState:
            row.metadataState === 'READY'
              ? ('READY' as const)
              : metadata?.concepts.length
                ? ('DEGRADED' as const)
                : row.metadataState,
          recentLimitCount: history?.count ?? row.recentLimitCount,
          recentLimitSessions: history?.sessions ?? row.recentLimitSessions,
          recentLimitState: history?.status ?? row.recentLimitState,
          recentLimitMethod: history?.method ?? row.recentLimitMethod,
          recentLimitReason: history?.reason,
        };
      }),
    );
    const conceptReady = rows.filter(
      (row) => row.metadataState === 'READY',
    ).length;
    const recentLimitReady = rows.filter(
      (row) => row.recentLimitState !== 'MISSING',
    ).length;
    return Response.json(
      {
        ...exactCloseFallback,
        rows,
        status:
          conceptReady === rows.length && recentLimitReady === rows.length
            ? ('READY' as const)
            : ('DEGRADED' as const),
        coverage: {
          requested: rows.length,
          conceptReady,
          recentLimitReady,
        },
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  }
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
