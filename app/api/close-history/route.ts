import seedDocument from '@/lib/close-history.generated.json';
import type { CloseHistoryDocument } from '@/lib/close-history';
import { buildLatestCloseSnapshot } from '@/lib/market';
import { loadCloseHistory, saveCloseSnapshot } from '@/lib/persistence';
import { enrichEmotionCloses } from '@/lib/emotion-tracking-source';

export const dynamic = 'force-dynamic';

export async function GET() {
  const seed = seedDocument as CloseHistoryDocument;
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
  const document: CloseHistoryDocument = {
    ...seed,
    version: Math.max(2, seed.version),
    generatedAt: new Date().toISOString(),
    snapshots: enrichedSnapshots,
    archive: {
      state: persistenceState,
      mode: persistenceMode,
      latestDate: snapshots.at(-1)?.date ?? latestDate,
      marketDate,
      requestedDate,
      sessionState,
      missingDates: [
        ...new Set(
          [
            ...(seed.knownMissingDates ?? []),
            ...enrichedSnapshots
              .map((snapshot) => snapshot.previousDate)
              .filter((date): date is string => Boolean(date)),
          ].filter((date) => !archivedDates.has(date)),
        ),
      ].sort(),
      availableDates: snapshots.length,
      message: [archiveMessage, persistenceReason].filter(Boolean).join('；'),
    },
  };
  return Response.json(document, { headers: { 'cache-control': 'no-store' } });
}
