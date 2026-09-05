import { getMarketDateContext } from '@/lib/market';
import { loadLatestModuleSnapshot } from '@/lib/persistence';
import { sameTradeDate } from '@/lib/quote-evidence';

export async function loadArchivedSessionSnapshot<
  T extends { retrievedAt: string; tradeDate?: string; reason?: string },
>(module: string) {
  try {
    const marketDate = await getMarketDateContext();
    if (marketDate.sourceState !== 'ARCHIVED') return null;
    const snapshot = await loadLatestModuleSnapshot<T>(module);
    if (!snapshot) return null;
    if (!sameTradeDate(snapshot.tradeDate, marketDate.tradeDate)) return null;
    return {
      ...snapshot,
      requestedDate: marketDate.requestedDate,
      phase: '休市快照',
      sessionState: 'CLOSED' as const,
      sourceState: 'ARCHIVED' as const,
      // Reading an archive does not refresh the underlying quote timestamp.
      retrievedAt: snapshot.retrievedAt,
    };
  } catch {
    return null;
  }
}
