import document from './emotion-tracking.generated.json';
import type { CloseSnapshot } from './close-history';
import type { TrackingHistory } from './emotion-tracking';

// Server-side minute evidence; never import this bundle from client components.
export const TRACKING_HISTORY = document.dates as TrackingHistory;
export function enrichEmotionCloses(
  snapshots: CloseSnapshot[],
): CloseSnapshot[] {
  return snapshots.map((snapshot) => {
    const day = TRACKING_HISTORY[snapshot.date];
    return day
      ? {
          ...snapshot,
          closeQuotes: { ...day.quotes, ...snapshot.closeQuotes },
          previousDate: day.previousDate,
        }
      : snapshot;
  });
}
