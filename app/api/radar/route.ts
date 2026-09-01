import { getRadarSnapshot } from '@/lib/market';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return Response.json(await getRadarSnapshot(), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json({ status: 'MISSING', retrievedAt: new Date().toISOString(), reason: String(error), events: [] }, { status: 503 });
  }
}
