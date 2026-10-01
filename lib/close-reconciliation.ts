import type { CloseSnapshot } from './close-history';

/** Keep stored observations unchanged. A newly hash-verified recovery bundle
 * supersedes older auto-captured same-date facts in the read model only. */
export function reconcileCloseSnapshot(
  persisted: CloseSnapshot,
  seed?: CloseSnapshot,
): CloseSnapshot {
  if (!seed || seed.date !== persisted.date) return persisted;
  if (
    seed.evidenceStatus === 'DEGRADED' &&
    seed.modules?.quotes?.status === 'READY' &&
    seed.modules?.indices?.status === 'READY'
  )
    return seed;
  if (!seed.closeQuotes) return persisted;
  return {
    ...persisted,
    closeQuotes: { ...persisted.closeQuotes, ...seed.closeQuotes },
  };
}
