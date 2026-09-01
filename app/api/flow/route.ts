import { getFlowSnapshot } from '@/lib/market';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return Response.json(await getFlowSnapshot(), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json({
      status: 'MISSING',
      curveState: 'MISSING',
      splitState: 'MISSING',
      retrievedAt: new Date().toISOString(),
      reason: String(error),
      series: [],
      split: {
        inflow: [], outflow: [], cumulativeInflow: [], cumulativeOutflow: [],
        persistentStrong: [], persistentWeak: [], positiveCount: 0, negativeCount: 0,
      },
    }, { status: 503 });
  }
}
