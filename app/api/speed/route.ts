import { getSpeedSnapshot } from '@/lib/market';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return Response.json(await getSpeedSnapshot(), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return Response.json({ status: 'MISSING', retrievedAt: new Date().toISOString(), reason: String(error), rows: [] }, { status: 503 });
  }
}
