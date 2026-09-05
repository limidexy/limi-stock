import { getMarketDateContext } from '@/lib/market';
import { loadLatestModuleSnapshot } from '@/lib/persistence';

export async function loadArchivedSessionSnapshot<
  T extends { retrievedAt: string },
>(module: string) {
  try {
    const marketDate = await getMarketDateContext();
    if (marketDate.sourceState !== 'ARCHIVED') return null;
    const snapshot = await loadLatestModuleSnapshot<T>(module);
    if (!snapshot) return null;
    return {
      ...snapshot,
      requestedDate: marketDate.requestedDate,
      phase: '休市快照',
      sessionState: 'CLOSED' as const,
      sourceState: 'ARCHIVED' as const,
      retrievedAt: new Date().toISOString(),
      reason: undefined,
    };
  } catch {
    return null;
  }
}
