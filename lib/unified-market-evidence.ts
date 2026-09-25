export type DatedEvidence = {
  status?: string;
  tradeDate?: string;
  sourceState?: string;
};

const compactDate = (value?: string) => (value ?? '').replaceAll('-', '');

export function alignedEvidence<T extends DatedEvidence>(
  targetDate: string,
  evidence?: T | null,
): T | null {
  if (
    !evidence ||
    evidence.status === 'MISSING' ||
    evidence.sourceState === 'STALE' ||
    compactDate(evidence.tradeDate) !== compactDate(targetDate)
  )
    return null;
  return evidence;
}
