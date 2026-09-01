import { getRadarSnapshot } from '@/lib/market';

export const dynamic = 'force-dynamic';
let lastSnapshot: Awaited<ReturnType<typeof getRadarSnapshot>> | null = null;

export async function GET() {
  try {
    const snapshot = await getRadarSnapshot();
    lastSnapshot = snapshot;
    return Response.json(snapshot, { headers: { 'cache-control': 'no-store' } });
  } catch {
    if (lastSnapshot) return Response.json({
      ...lastSnapshot, status: 'DEGRADED', sourceState: 'STALE', staleAt: lastSnapshot.retrievedAt,
      retrievedAt: new Date().toISOString(), reason: '行情源短暂波动，展示最近成功快照并自动重连',
    }, { headers: { 'cache-control': 'no-store' } });
    return Response.json({ status: 'MISSING', retrievedAt: new Date().toISOString(), reason: '行情源暂时不可用，正在自动重连', events: [] }, { status: 503 });
  }
}
