import type { TrackingDay } from './emotion-tracking';

/** Preserve an actual saved intraday observation when final close evidence is
 * absent. Market closure changes the session, not the observed prices' cutoff. */
export function resolveTrackingCutoff(
  date: string,
  saved: TrackingDay | undefined,
  hasClose: boolean,
) {
  const clock = saved?.cutoff;
  if (
    !hasClose &&
    saved?.date === date &&
    clock &&
    /^\d{2}:\d{2}$/.test(clock) &&
    clock >= '09:30' &&
    clock < '15:00'
  ) {
    return {
      cutoff: clock,
      lastKnown: true,
      reason: `仅保留${date} ${clock}最近有效观察；完整收盘未归档，非当前实时`,
    };
  }
  return { cutoff: '15:00', lastKnown: false, reason: null };
}
