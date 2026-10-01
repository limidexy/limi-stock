import { CLOSE_HISTORY, type CloseHistoryDocument } from '@/lib/close-history';
import { buildLatestCloseSnapshot, getMarketDateContext } from '@/lib/market';
import { loadCloseHistory, saveCloseSnapshot } from '@/lib/persistence';
import { enrichEmotionCloses } from '@/lib/emotion-tracking-source';
import calendar from '@/lib/trading-calendar.generated.json';
import { archiveFreshness } from '@/lib/archive-freshness';

export const dynamic = 'force-dynamic';

export async function GET() {
  const seed: CloseHistoryDocument = CLOSE_HISTORY;
  let snapshots = seed.snapshots;
  let persistenceState: 'READY' | 'DEGRADED' = 'READY';
  let persistenceMode: 'DYNAMIC' | 'BUNDLED_FALLBACK' = 'DYNAMIC';
  let persistenceReason = '';

  try {
    snapshots = await loadCloseHistory();
  } catch (error) {
    persistenceState = 'DEGRADED';
    persistenceMode = 'BUNDLED_FALLBACK';
    persistenceReason = `动态归档库暂时不可用：${String(error)}`;
  }

  const latestDate = snapshots.at(-1)?.date ?? '';
  let archiveMessage = latestDate
    ? `已归档至${latestDate} 15:00`
    : '暂无已归档收盘日';
  let marketDate: string | undefined;
  let requestedDate: string | undefined;
  let sessionState: 'LIVE' | 'CLOSED' | undefined;

  if (persistenceMode === 'DYNAMIC') {
    try {
      const context = await getMarketDateContext();
      marketDate = context.tradeDate;
      requestedDate = context.requestedDate;
      sessionState = context.sessionState;
      const capture = await buildLatestCloseSnapshot(latestDate);
      marketDate = capture.marketDate.tradeDate;
      requestedDate = capture.marketDate.requestedDate;
      sessionState = capture.marketDate.sessionState;
      archiveMessage = capture.reason;
      if (capture.snapshot) {
        await saveCloseSnapshot(capture.snapshot);
        snapshots = await loadCloseHistory();
      }
    } catch (error) {
      persistenceState = 'DEGRADED';
      archiveMessage = `已有历史仍可查看；新收盘日归档稍后重试：${String(error)}`;
    }
  }

  const enrichedSnapshots = enrichEmotionCloses(snapshots);
  const archivedDates = new Set(
    enrichedSnapshots.map((snapshot) => snapshot.date),
  );
  // The provider-confirmed completed session may be newer than this deployed
  // calendar. Report that trailing gap even when collecting its CLOSE fails.
  const confirmedDates = [...calendar.dates];
  if (sessionState === 'CLOSED' && marketDate && /^\d{8}$/.test(marketDate))
    confirmedDates.push(
      `${marketDate.slice(0, 4)}-${marketDate.slice(4, 6)}-${marketDate.slice(6)}`,
    );
  const freshness = archiveFreshness(
    confirmedDates,
    [...archivedDates],
    new Date(),
    [
      ...(seed.knownMissingDates ?? []),
      ...enrichedSnapshots
        .map((snapshot) => snapshot.previousDate)
        .filter((date): date is string => Boolean(date)),
    ],
  );
  if (freshness.stale) {
    persistenceState = 'DEGRADED';
    archiveMessage = `应归档至${freshness.expectedDate}；实际至${freshness.latestDate || '暂无'}。缺失交易日：${freshness.missingDates.join('、')}。${archiveMessage}`;
  }
  if (enrichedSnapshots.at(-1)?.evidenceStatus === 'DEGRADED') {
    persistenceState = 'DEGRADED';
    archiveMessage +=
      '；基础收盘报价与梯队已核验，行业、分钟及竞价能力按模块单独标注，非完整复盘证据包。';
  }
  const document: CloseHistoryDocument = {
    ...seed,
    version: Math.max(2, seed.version),
    generatedAt: new Date().toISOString(),
    snapshots: enrichedSnapshots,
    archive: {
      state: persistenceState,
      mode: persistenceMode,
      latestDate: snapshots.at(-1)?.date ?? latestDate,
      expectedDate: freshness.expectedDate,
      marketDate,
      requestedDate,
      sessionState,
      missingDates: freshness.missingDates,
      availableDates: snapshots.length,
      message: [archiveMessage, persistenceReason].filter(Boolean).join('；'),
    },
  };
  return Response.json(document, { headers: { 'cache-control': 'no-store' } });
}
