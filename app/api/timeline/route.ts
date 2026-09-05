import { getMarketTimelineSnapshot } from '@/lib/market';
import { loadArchivedSessionSnapshot } from '@/lib/market-session';
import {
  loadLatestModuleSnapshot,
  saveModuleSnapshot,
} from '@/lib/persistence';

export const dynamic = 'force-dynamic';
let lastSnapshot: Awaited<ReturnType<typeof getMarketTimelineSnapshot>> | null =
  null;

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('盘面脉络计算超时')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function GET() {
  const archived =
    await loadArchivedSessionSnapshot<
      Awaited<ReturnType<typeof getMarketTimelineSnapshot>>
    >('timeline');
  if (archived)
    return Response.json(archived, {
      headers: { 'cache-control': 'no-store' },
    });
  try {
    const snapshot = await withTimeout(getMarketTimelineSnapshot(), 55_000);
    if (snapshot.events.length) {
      lastSnapshot = snapshot;
      await saveModuleSnapshot('timeline', snapshot).catch(() => undefined);
      return Response.json(snapshot, {
        headers: { 'cache-control': 'no-store' },
      });
    }
    const persisted = await loadLatestModuleSnapshot<typeof snapshot>(
      'timeline',
    ).catch(() => null);
    if (persisted)
      return Response.json(
        {
          ...persisted,
          status: 'DEGRADED',
          sourceState: 'STALE',
          staleAt: persisted.persistedAt,
          retrievedAt: new Date().toISOString(),
          reason: '盘面脉络端点暂时不可用，展示最近成功时间轴并单独重连',
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
        Awaited<ReturnType<typeof getMarketTimelineSnapshot>>
      >('timeline').catch(() => null));
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
          reason: '分钟行情源短暂波动，展示同交易日最近盘面脉络并自动重连',
        },
        { headers: { 'cache-control': 'no-store' } },
      );
    return Response.json(
      {
        status: 'MISSING',
        retrievedAt: new Date().toISOString(),
        tradeDate: '',
        phase: '行情源重连中',
        lastPointTime: null,
        source: '东方财富公开分钟序列',
        sourceState: 'STALE',
        reason: '盘面脉络数据暂时不可用，正在自动重连',
        basis: '',
        coverage: {
          sectors: 0,
          events: 0,
          timeNodes: 0,
          indices: 0,
          checkedDrivers: 0,
          confirmedDrivers: 0,
          relatedStocks: 0,
        },
        events: [],
      },
      { status: 503 },
    );
  }
}
