import { getMarketDateContext, getRadarSnapshot } from '@/lib/market';
import { loadArchivedSessionSnapshot } from '@/lib/market-session';
import { normalizeLegacyRadar, type RadarSnapshot } from '@/lib/radar-evidence';
import {
  loadLatestModuleSnapshot,
  saveModuleSnapshot,
} from '@/lib/persistence';

export const dynamic = 'force-dynamic';
let lastSnapshot: RadarSnapshot | null = null;
const json = (snapshot: unknown, status = 200) =>
  Response.json(snapshot, { status, headers: { 'cache-control': 'no-store' } });

export async function GET() {
  const context = await getMarketDateContext().catch(() => null);
  if (!context)
    return json(
      {
        status: 'MISSING',
        events: [],
        reason: '无法确认目标交易日，未使用其他日期行情',
      },
      503,
    );
  const archived = await loadArchivedSessionSnapshot<RadarSnapshot>('radar');
  if (archived?.dataVersion === 2 && archived.status === 'READY')
    return json(archived);
  try {
    const snapshot = await getRadarSnapshot();
    if (snapshot.tradeDate !== context.tradeDate)
      throw new Error('行情日期与目标交易日不一致');
    if (snapshot.events.length) {
      lastSnapshot = snapshot;
      await saveModuleSnapshot('radar', snapshot).catch(() => undefined);
      return json(snapshot);
    }
    throw new Error(snapshot.reason || '目标交易日板块列表不可用');
  } catch (error) {
    const persisted = await loadLatestModuleSnapshot<RadarSnapshot>(
      'radar',
    ).catch(() => null);
    const fallback = [lastSnapshot, archived, persisted].find(
      (snapshot) =>
        snapshot?.tradeDate === context.tradeDate && snapshot.events.length,
    );
    if (fallback) {
      const safe =
        fallback.dataVersion === 2 ? fallback : normalizeLegacyRadar(fallback);
      return json({
        ...safe,
        ...context,
        status: 'DEGRADED',
        sourceState: 'STALE',
        // Keep original retrieval and quote times. Serving a cache is not a new quote.
        servedAt: new Date().toISOString(),
        reason: `非当前实时：展示${fallback.tradeDate}最近成功结果（${fallback.retrievedAt}）。${String(error)}；${safe.reason ?? ''}`,
      });
    }
    return json(
      {
        ...context,
        status: 'MISSING',
        events: [],
        reason: `目标交易日行情不可用，未回退其他日期：${String(error)}`,
      },
      503,
    );
  }
}
