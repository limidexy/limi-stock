type DatedSnapshot = { tradeDate?: string; sourceState?: string };

function dateKey(value?: string | null) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length === 8 ? digits : null;
}

/** Do not let an independently cached module silently change the overview day. */
export function alignedSnapshot<T extends DatedSnapshot>(
  value: T | null,
  targetDate?: string | null,
): T | null {
  const target = dateKey(targetDate);
  return target &&
    value &&
    dateKey(value.tradeDate) === target &&
    value.sourceState !== 'STALE'
    ? value
    : null;
}

export function overviewSessionLabel(sessionState?: string | null) {
  return sessionState === 'LIVE' ? '盘中' : '最近定格';
}
