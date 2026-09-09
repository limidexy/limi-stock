import { DYNAMIC_MAINLINE_RESEARCH } from '@/lib/dynamic-mainline-source';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(DYNAMIC_MAINLINE_RESEARCH, {
    headers: { 'cache-control': 'public, max-age=300' },
  });
}
