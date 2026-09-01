import { getMarketTimelineSnapshot } from '@/lib/market';

export const dynamic = 'force-dynamic';
let lastSnapshot: Awaited<ReturnType<typeof getMarketTimelineSnapshot>> | null = null;

export async function GET() {
  try {
    const snapshot = await getMarketTimelineSnapshot();
    lastSnapshot = snapshot;
    return Response.json(snapshot, { headers: { 'cache-control': 'no-store' } });
  } catch {
    if (lastSnapshot) return Response.json({
      ...lastSnapshot,
      status: 'DEGRADED',
      sourceState: 'STALE',
      staleAt: lastSnapshot.retrievedAt,
      retrievedAt: new Date().toISOString(),
      reason: '分钟行情源短暂波动，展示同交易日最近盘面脉络并自动重连',
    }, { headers: { 'cache-control': 'no-store' } });
    return Response.json({
      status: 'MISSING',
      retrievedAt: new Date().toISOString(),
      tradeDate: '',
      phase: '行情源重连中',
      lastPointTime: null,
      source: '东方财富公开分钟序列',
      sourceState: 'STALE',
      reason: '盘面脉络数据暂时不可用，正在自动重连',
      basis: '',
      coverage: { sectors: 0, events: 0, indices: 0, confirmedDrivers: 0 },
      events: [],
    }, { status: 503 });
  }
}
