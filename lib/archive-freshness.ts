// Only provider-verified exchange sessions are considered. Weekdays are not a
// trading calendar (notably the September/October holidays).
export function archiveFreshness(
  sessions: string[],
  archived: string[],
  now = new Date(),
  knownMissing: string[] = [],
) {
  const local = new Date(now.getTime() + 8 * 3600000).toISOString();
  const today = local.slice(0, 10);
  const completed = [...new Set(sessions)]
    .filter(
      (date) =>
        date < today || (date === today && local.slice(11, 16) >= '15:00'),
    )
    .sort();
  const expectedDate = completed.at(-1);
  const latestDate = [...archived].sort().at(-1) ?? '';
  const first = [...archived].sort()[0];
  const available = new Set(archived);
  const missingDates = [...new Set([...completed, ...knownMissing])]
    .filter(
      (date) =>
        (!first || date >= first) &&
        date <= (expectedDate ?? today) &&
        !available.has(date),
    )
    .sort();
  return {
    expectedDate,
    latestDate,
    missingDates,
    stale: !!expectedDate && latestDate < expectedDate,
  };
}
