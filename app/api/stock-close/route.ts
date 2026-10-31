import closeHistory from '@/lib/close-history.generated.json';
import {
  resolveCloseIdentity,
  type CloseIdentityView,
} from '@/lib/close-identity';

export const dynamic = 'force-dynamic';

type Snapshot = { date: string };

const SNAPSHOTS: Snapshot[] = (
  closeHistory as unknown as { snapshots: Snapshot[] }
).snapshots;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = (url.searchParams.get('code') ?? '').trim();
  const date = (url.searchParams.get('date') ?? '').trim();

  if (!/^\d{6}$/.test(code)) {
    return Response.json({ error: 'code 必须是六位股票代码' }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: 'date 必须是 YYYY-MM-DD' }, { status: 400 });
  }

  const snapshot = SNAPSHOTS.find((item) => item.date === date) ?? null;
  const view: CloseIdentityView = resolveCloseIdentity(snapshot, code);
  return Response.json(view, {
    headers: { 'cache-control': 'public, max-age=86400, immutable' },
  });
}
