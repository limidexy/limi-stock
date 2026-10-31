import { closeSpeedIndex } from '@/lib/close-speed';
import { getLadderSnapshot, repairArchivedLadder } from '@/lib/market';
import { loadArchivedSessionSnapshot } from '@/lib/market-session';
import {
  loadLatestModuleSnapshot,
  saveModuleSnapshot,
} from '@/lib/persistence';

export const dynamic = 'force-dynamic';
let lastSnapshot: Awaited<ReturnType<typeof getLadderSnapshot>> | null = null;

type LadderCompetitor = { code: string; speedPct?: number | null };

type LadderLike = {
  tradeDate?: string;
  competitors?: LadderCompetitor[];
  coverage?: { speedReady?: number } & Record<string, unknown>;
};

/**
 * 梯队竞争的涨速原本依赖行情列表，行情列表不可用时整列都是空的。
 * 这里按代码把收盘涨速归档贴回去：只补归档里真实存在的代码，
 * 归档里没有的仍留 null，并把覆盖率重新算一遍，避免"看起来都齐了"。
 */
function attachCloseSpeed<T extends LadderLike>(snapshot: T): T {
  if (!snapshot?.tradeDate || !Array.isArray(snapshot.competitors))
    return snapshot;
  const index = closeSpeedIndex(snapshot.tradeDate);
  if (!index.size) return snapshot;
  let filled = 0;
  const competitors = snapshot.competitors.map((row) => {
    if (row.speedPct !== null && row.speedPct !== undefined) return row;
    const hit = index.get(row.code);
    if (!hit) return row;
    filled += 1;
    return { ...row, speedPct: hit.speedPct };
  });
  if (!filled) return snapshot;
  const speedReady = competitors.filter(
    (row) => row.speedPct !== null && row.speedPct !== undefined,
  ).length;
  return {
    ...snapshot,
    competitors,
    coverage: snapshot.coverage
      ? { ...snapshot.coverage, speedReady }
      : snapshot.coverage,
    speedWindow: '14:55 → 15:00',
    speedSource: '腾讯 1 分钟 K 线收盘涨速归档',
  } as T;
}

export async function GET() {
  const archived =
    await loadArchivedSessionSnapshot<
      Awaited<ReturnType<typeof getLadderSnapshot>>
    >('ladder');
  if (archived)
    return Response.json(attachCloseSpeed(await repairArchivedLadder(archived)), {
      headers: { 'cache-control': 'no-store' },
    });
  try {
    const snapshot = await getLadderSnapshot();
    if (snapshot.competitors.length) {
      lastSnapshot = snapshot;
      await saveModuleSnapshot('ladder', snapshot).catch(() => undefined);
      return Response.json(attachCloseSpeed(snapshot), {
        headers: { 'cache-control': 'no-store' },
      });
    }
    if (
      snapshot.tradeDate &&
      snapshot.sessionState === 'CLOSED' &&
      snapshot.sourceState === 'ARCHIVED'
    )
      return Response.json(attachCloseSpeed(snapshot), {
        headers: { 'cache-control': 'no-store' },
      });
    const persisted = await loadLatestModuleSnapshot<typeof snapshot>(
      'ladder',
    ).catch(() => null);
    if (persisted)
      return Response.json(
        attachCloseSpeed({
          ...persisted,
          status: 'DEGRADED',
          sourceState: 'STALE',
          staleAt: persisted.persistedAt,
          retrievedAt: persisted.retrievedAt,
          reason: '连板池端点暂时不可用，展示最近成功梯队并单独重连',
        }),
        { headers: { 'cache-control': 'no-store' } },
      );
    return Response.json(attachCloseSpeed(snapshot), {
      headers: { 'cache-control': 'no-store' },
    });
  } catch (error) {
    const sourceError = String(error);
    const fallback =
      lastSnapshot ??
      (await loadLatestModuleSnapshot<
        Awaited<ReturnType<typeof getLadderSnapshot>>
      >('ladder').catch(() => null));
    if (fallback)
      return Response.json(
        attachCloseSpeed({
          ...fallback,
          status: 'DEGRADED',
          sourceState: 'STALE',
          staleAt:
            'persistedAt' in fallback &&
            typeof fallback.persistedAt === 'string'
              ? fallback.persistedAt
              : fallback.retrievedAt,
          retrievedAt: fallback.retrievedAt,
          reason: `连板行情源请求失败（${sourceError}）；展示最近成功快照并自动重连`,
        }),
        { headers: { 'cache-control': 'no-store' } },
      );
    return Response.json(
      {
        status: 'MISSING',
        retrievedAt: new Date().toISOString(),
        reason: `连板行情源请求失败（${sourceError}）；正在自动重连`,
        promotion: [],
        competitors: [],
      },
      { status: 503 },
    );
  }
}
