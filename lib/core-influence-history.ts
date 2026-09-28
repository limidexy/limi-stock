import type { EmotionCoreEvidence } from './market-reading';
import type { EmotionTracking } from './emotion-tracking';

export type InfluenceRecord = NonNullable<
  EmotionCoreEvidence['influenceHistory']
>[number];
const parse = (date: string, time: string) =>
  Date.parse(/^\d{2}:\d{2}$/.test(time) ? `${date}T${time}:00+08:00` : time);
const minute = (time: string) => {
  const [h, m] = time.split(':').map(Number),
    n = h * 60 + m;
  return n >= 780 ? n - 90 : n;
};

/** Append only point-in-time, per-pair confirmed observations. Preserves the
 * first observation per stock/day, so later successful outcomes cannot rewrite
 * the time at which a stock was first known to influence its group. */
export function updateInfluenceHistory(
  summary: EmotionTracking,
  previous: InfluenceRecord[],
): InfluenceRecord[] {
  const target = parse(summary.date, summary.cutoff);
  const available = summary.availableAt
    ? Date.parse(summary.availableAt)
    : target;
  const end =
    Number.isFinite(available) &&
    new Date(available + 8 * 3600000).toISOString().slice(11, 16) ===
      summary.cutoff
      ? available
      : target;
  const records = new Map<string, InfluenceRecord>();
  for (const r of previous)
    if (
      r.state === 'READY' &&
      Date.parse(r.observedAt) <= end &&
      r.date <= summary.date &&
      r.source &&
      r.concept &&
      new Set(r.respondingCodes).size >= 2
    ) {
      const key = `${r.code}:${r.date}`,
        old = records.get(key);
      if (!old || r.observedAt < old.observedAt) records.set(key, r);
    }
  const conceptsAt = summary.conceptsAvailableAt
    ? Date.parse(summary.conceptsAvailableAt)
    : NaN;
  if (
    !Number.isFinite(conceptsAt) ||
    conceptsAt > end ||
    summary.sourceState === 'STALE'
  )
    return [...records.values()];
  const stateOf = (code: string) =>
    summary.conceptStates?.[code] ?? summary.conceptsState;
  for (const group of summary.leadLag.rows) {
    if (
      !group.onset ||
      group.status !== 'READY' ||
      stateOf(group.core.code) !== 'READY' ||
      parse(summary.date, group.onset.time) > end
    )
      continue;
    const ownConcepts = summary.concepts?.[group.core.code] ?? [];
    for (const concept of ownConcepts) {
      const responses = group.rows.filter(
        (row) =>
          row.code !== group.core.code &&
          row.pathState === 'READY' &&
          row.role === '随后响应' &&
          row.time &&
          row.lag !== null &&
          row.lag >= 1 &&
          row.lag <= 10 &&
          minute(row.time) - minute(group.onset!.time) === row.lag &&
          parse(summary.date, row.time) <= end &&
          stateOf(row.code) === 'READY' &&
          summary.concepts?.[row.code]?.includes(concept),
      );
      if (new Set(responses.map((r) => r.code)).size < 2) continue;
      const key = `${group.core.code}:${summary.date}`;
      if (!records.has(key))
        records.set(key, {
          code: group.core.code,
          name: group.core.name,
          date: summary.date,
          observedAt: new Date(end).toISOString(),
          source: `${summary.source} · 同概念逐股分钟先后`,
          state: 'READY',
          respondingCodes: [...new Set(responses.map((r) => r.code))],
          concept,
        });
    }
  }
  // Keep all identities. Two earliest days establish historical continuity;
  // the latest day retains current evidence without an unbounded minute archive.
  const byCode = new Map<string, InfluenceRecord[]>();
  for (const r of records.values())
    byCode.set(r.code, [...(byCode.get(r.code) ?? []), r]);
  return [...byCode.values()].flatMap((rows) => {
    rows.sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    return [
      ...new Map(
        [...rows.slice(0, 2), ...rows.slice(-1)].map((r) => [r.date, r]),
      ).values(),
    ];
  });
}
