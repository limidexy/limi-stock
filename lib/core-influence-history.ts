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

/** Append point-in-time sequences, NOT causal influence certifications. Keep
 * direction and concept separate; later outcomes cannot rewrite first receipt. */
export function updateInfluenceHistory(
  summary: EmotionTracking,
  previous: InfluenceRecord[],
): InfluenceRecord[] {
  const target = parse(summary.date, summary.cutoff);
  const available = summary.availableAt ? Date.parse(summary.availableAt) : NaN;
  const receiptAligned =
    Number.isFinite(available) &&
    available >= target &&
    available < target + 60_000;
  const end = receiptAligned ? available : target;
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
      const key = `${r.code}:${r.date}:${r.concept}:${r.direction ?? 'up'}`,
        old = records.get(key);
      if (!old || r.observedAt < old.observedAt) records.set(key, r);
    }
  const conceptsAt = summary.conceptsAvailableAt
    ? Date.parse(summary.conceptsAvailableAt)
    : NaN;
  if (
    !receiptAligned ||
    !Number.isFinite(conceptsAt) ||
    conceptsAt > end ||
    summary.sourceState === 'STALE'
  )
    return [...records.values()];
  const receiptBeforeEnd = (item: unknown) => {
    const receipt = (item as { availableAt?: string }).availableAt;
    return (
      !receipt ||
      (Number.isFinite(Date.parse(receipt)) && Date.parse(receipt) <= end)
    );
  };
  const stateOf = (code: string) =>
    summary.conceptStates?.[code] ?? summary.conceptsState;
  const directionalGroups = [
    ...summary.leadLag.rows.map((group) => ({
      group,
      direction: 'up' as const,
    })),
    ...(summary.negativeLeadLag?.rows ?? []).map((group) => ({
      group,
      direction: 'down' as const,
    })),
  ];
  for (const { group, direction } of directionalGroups) {
    if (
      !group.onset ||
      group.status !== 'READY' ||
      !receiptBeforeEnd(group) ||
      !Number.isFinite(group.onset.gain) ||
      (direction === 'up' ? group.onset.gain < 1 : group.onset.gain > -1) ||
      stateOf(group.core.code) !== 'READY' ||
      parse(summary.date, group.onset.time) > end
    )
      continue;
    const ownConcepts = summary.concepts?.[group.core.code] ?? [];
    for (const concept of ownConcepts) {
      const responses = group.rows.filter(
        (row) =>
          row.code !== group.core.code &&
          receiptBeforeEnd(row) &&
          row.pathState === 'READY' &&
          row.role === (direction === 'up' ? '随后响应' : '随后负向响应') &&
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
      const key = `${group.core.code}:${summary.date}:${concept}:${direction}`;
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
          direction,
        });
    }
  }
  // Keep earliest and latest observations per scope, not proof of continuous
  // trading-day influence. Sparse records must never be described as continuity.
  const byCode = new Map<string, InfluenceRecord[]>();
  for (const r of records.values()) {
    const key = `${r.code}:${r.concept}:${r.direction ?? 'up'}`;
    byCode.set(key, [...(byCode.get(key) ?? []), r]);
  }
  return [...byCode.values()].flatMap((rows) => {
    rows.sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    return [
      ...new Map(
        [...rows.slice(0, 2), ...rows.slice(-1)].map((r) => [r.date, r]),
      ).values(),
    ];
  });
}
