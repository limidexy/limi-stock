import { getEarlySectorObservationSnapshot } from '@/lib/market';
import type { EarlyObservationSnapshot } from '@/lib/early-observation';

export const dynamic = 'force-dynamic';

let lastSnapshot: EarlyObservationSnapshot | null = null;

function shanghaiDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date())
    .replaceAll('-', '');
}

function json(snapshot: EarlyObservationSnapshot, status = 200) {
  return Response.json(snapshot, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

export async function GET() {
  try {
    const snapshot = await getEarlySectorObservationSnapshot();
    if (snapshot.rows.length && snapshot.tradeDate === shanghaiDate())
      lastSnapshot = snapshot;
    return json(snapshot);
  } catch (error) {
    const tradeDate = shanghaiDate();
    const reason = `免费行业报价请求失败：${String(error)}`;
    if (lastSnapshot?.tradeDate === tradeDate && lastSnapshot.rows.length) {
      return json({
        ...lastSnapshot,
        status: 'DEGRADED',
        sourceState: 'STALE',
        retrievedAt: new Date().toISOString(),
        reason: `${reason}；页面保留 ${lastSnapshot.quoteTime ?? '未知时点'} 的同日报价，等待自动重试`,
      });
    }
    return json(
      {
        status: 'MISSING',
        tradeDate,
        retrievedAt: new Date().toISOString(),
        quoteTime: null,
        latestQuoteTime: null,
        quoteAgeSeconds: null,
        quoteSpreadSeconds: null,
        source: '东方财富公开行业板块报价（push2delay / clist）',
        scope: '行业板块指数报价，不代表板块成分股宽度或资金净流入',
        sourceState: 'STALE',
        reason,
        coverage: {
          requested: 0,
          exactDate: 0,
          priced: 0,
          volumeAndAmount: 0,
          pagesRequested: 0,
          pagesReceived: 0,
        },
        breadth: { up: 0, down: 0, flat: 0 },
        rows: [],
      },
      503,
    );
  }
}
