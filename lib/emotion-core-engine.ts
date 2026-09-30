import type {
  CoreCandidate,
  CoreDimension,
  CoreFeedbackMetric,
  EmotionCoreEvidence,
  EmotionCoreRole,
  EmotionCoreState,
  EmotionFacts,
  EmotionStock,
  EvidenceState,
  ReadingCompetitor,
} from './market-reading';

// Point-in-time, rule-based evidence. No scalar score assigns core identity.
const finite = (x: unknown): x is number =>
  typeof x === 'number' && Number.isFinite(x);
const day = (x?: string | null) => (x ?? '').slice(0, 10).replaceAll('-', '');
const dashed = (x: string) =>
  `${x.slice(0, 4)}-${x.slice(4, 6)}-${x.slice(6, 8)}`;
const codeOf = (x: string) => x.replace(/^(sh|sz|bj)/i, '').padStart(6, '0');
const pct = (x?: number | null) =>
  finite(x) ? `${x > 0 ? '+' : ''}${x.toFixed(2)}%` : '缺失';
function stamp(date: string, value?: string | null): number | null {
  if (!value) return null;
  const s = /^\d{2}:\d{2}(:\d{2})?$/.test(value)
    ? `${dashed(day(date))}T${value.length === 5 ? `${value}:00` : value}+08:00`
    : value;
  const n = Date.parse(s);
  return Number.isFinite(n) ? n : null;
}
const dateAt = (t: number) =>
  new Date(t + 8 * 3600000).toISOString().slice(0, 10).replaceAll('-', '');
const clockAt = (t: number) =>
  new Date(t + 8 * 3600000)
    .toISOString()
    .slice(11, 23)
    .replace(/\.000$/, '');
const stocksOf = (f?: EmotionFacts | null) =>
  f?.ladders?.flatMap((x) => x.stocks) ?? [];
const unique = <T extends { code: string }>(xs: T[]) => [
  ...new Map(
    xs.map((x) => [codeOf(x.code), { ...x, code: codeOf(x.code) }]),
  ).values(),
];
const boardFamily = (code: string) =>
  /^(300|301|688|689)/.test(code)
    ? ('20cm' as const)
    : /^(4|8|92)/.test(code)
      ? ('北交所' as const)
      : ('主板' as const);
// Lunch is excluded; a one-minute response across 11:30 -> 13:01 stays one minute.
function tradingMinute(time?: string | null): number | null {
  if (!time || !/^\d{2}:\d{2}/.test(time)) return null;
  const [h, m] = time.slice(0, 5).split(':').map(Number);
  const n = h * 60 + m;
  if (n >= 570 && n <= 690) return n;
  if (n >= 781 && n <= 900) return n - 90;
  return null;
}
type Tracking = NonNullable<EmotionCoreEvidence['tracking']>;
type Rebound = NonNullable<Tracking['rebounds']>['rows'][number];
type Group = NonNullable<Tracking['leadLag']>['rows'][number];
type Pair = {
  core: string;
  coreName: string;
  member: string;
  memberName: string;
  onset: string;
  time: string;
  lag: number;
  concept: string | null;
  direction: 'up' | 'down';
  source: string;
};
type Quote = {
  value: number | null;
  time: string | null;
  state: EvidenceState;
  source: string | null;
};
type Registry = {
  code: string;
  name: string;
  roles: Set<EmotionCoreRole>;
  reasons: string[];
  firstSeen: string;
  peak: number;
  brokenDate: string | null;
};

export function readEmotionCores(
  facts: EmotionFacts,
  previous: EmotionFacts | null | undefined,
  suppliedRows: ReadingCompetitor[],
  suppliedStocks: EmotionStock[],
  evidence?: EmotionCoreEvidence | null,
) {
  const date = day(facts.date);
  const cutoffStamp = stamp(date, facts.cutoff) ?? 0;
  const captured = stamp(date, facts.retrievedAt);
  const snapshotTarget =
    facts.cutoff !== '15:00' &&
    captured !== null &&
    dateAt(captured) === date &&
    clockAt(captured).slice(0, 5) === facts.cutoff
      ? captured
      : cutoffStamp;
  // LIVE is a new decision after receipts arrive, not a rewrite of a prior
  // snapshot. FIXED replay never advances its historical cutoff.
  const requestedDecision = stamp(date, evidence?.decisionAt);
  const target =
    evidence?.decisionMode === 'LIVE' &&
    facts.cutoff !== '15:00' &&
    requestedDecision !== null &&
    dateAt(requestedDecision) === date &&
    requestedDecision >= snapshotTarget &&
    requestedDecision <= (stamp(date, '15:00') ?? 0)
      ? requestedDecision
      : evidence?.decisionMode === 'FIXED' &&
          requestedDecision !== null &&
          dateAt(requestedDecision) === date
        ? Math.min(snapshotTarget, requestedDecision)
        : snapshotTarget;
  const targetTime = target
    ? `${dashed(date)}T${clockAt(target)}+08:00`
    : `${facts.date}T${facts.cutoff}:00+08:00`;
  const lastKnown = Boolean(facts.stale) && evidence?.decisionMode !== 'LIVE';
  const atOrBefore = (time?: string | null, d = date) => {
    const n = stamp(d, time);
    return n !== null && n <= target;
  };
  const sameDayBefore = (time?: string | null) => {
    const n = stamp(date, time);
    return n !== null && dateAt(n) === date && n <= target;
  };
  const envelopeDate = day(evidence?.date ?? evidence?.tracking?.date);
  const envelopeCutoff = stamp(
    date,
    evidence?.cutoff ?? evidence?.tracking?.cutoff,
  );
  const envelopeAvailable = stamp(
    date,
    evidence?.availableAt ??
      evidence?.tracking?.availableAt ??
      evidence?.tracking?.asOf ??
      evidence?.retrievedAt ??
      evidence?.cutoff ??
      evidence?.tracking?.cutoff,
  );
  const evidenceAligned =
    envelopeDate === date &&
    envelopeCutoff !== null &&
    envelopeCutoff <= target &&
    envelopeAvailable !== null &&
    (envelopeAvailable <= target ||
      (facts.cutoff === '15:00' &&
        evidence?.sourceState === 'ARCHIVED' &&
        envelopeAvailable <= (stamp(date, '16:00') ?? 0)));
  // One late module must not discard an independent earlier module. The
  // tracking receipt and its own event cutoff are checked separately below.
  const tracking = envelopeDate === date ? evidence?.tracking : undefined;
  const trackingDateOK =
    tracking && day(tracking.date ?? evidence?.date) === date;
  const trackingStamp = stamp(date, tracking?.cutoff);
  const trackingAvailable = stamp(
    date,
    tracking?.availableAt ??
      tracking?.asOf ??
      evidence?.availableAt ??
      evidence?.retrievedAt ??
      tracking?.cutoff,
  );
  const t =
    trackingDateOK &&
    trackingStamp !== null &&
    trackingStamp <= target &&
    trackingAvailable !== null &&
    (trackingAvailable <= target ||
      (facts.cutoff === '15:00' &&
        evidence?.sourceState === 'ARCHIVED' &&
        trackingAvailable <= (stamp(date, '16:00') ?? 0)))
      ? tracking
      : undefined;
  const minuteObservedAt =
    t?.availableAt ??
    t?.asOf ??
    (t?.cutoff ? `${dashed(date)}T${t.cutoff}:00+08:00` : null);
  const minuteCurrent =
    Boolean(t) &&
    evidence?.sourceState !== 'STALE' &&
    ((facts.cutoff === '15:00' && t?.cutoff === '15:00') ||
      (trackingAvailable !== null && target - trackingAvailable <= 60_000));
  const rawTape = t?.tape;
  const tape =
    rawTape &&
    day(rawTape.date) === date &&
    atOrBefore(rawTape.observedAt) &&
    sameDayBefore(rawTape.cutoff) &&
    (!rawTape.sourceAvailableAt || atOrBefore(rawTape.sourceAvailableAt))
      ? {
          ...rawTape,
          rows: rawTape.rows.filter((row) => {
            const eventTimes = [
              row.firstTime,
              row.lastTime,
              row.firstLimitTime,
              row.openedAt,
              row.resealedAt,
              row.stableSince,
              ...row.upEvents.flatMap((event) => [event.from, event.at]),
              ...row.downEvents.flatMap((event) => [event.from, event.at]),
            ].filter((value): value is string => Boolean(value));
            return (
              row.lastTime !== null &&
              sameDayBefore(row.lastTime) &&
              row.lastTime <= rawTape.cutoff &&
              (!row.quoteTime || sameDayBefore(row.quoteTime)) &&
              eventTimes.every(
                (time) => time <= rawTape.cutoff && sameDayBefore(time),
              )
            );
          }),
        }
      : null;
  const tapeByCode = new Map(
    (tape?.rows ?? []).map((row) => [codeOf(row.code), row]),
  );
  const source = evidenceAligned
    ? (evidence?.source ?? t?.source ?? '分字段市场证据')
    : '涨停梯队与已知历史收盘';
  const history = [
    ...new Map(
      [...(evidence?.history ?? []), ...(previous ? [previous] : [])]
        .filter(
          (f) =>
            /^\d{8}$/.test(day(f.date)) &&
            day(f.date) < date &&
            f.cutoff === '15:00' &&
            !f.stale,
        )
        .map((f) => [day(f.date), f]),
    ).values(),
  ].sort((a, b) => day(a.date).localeCompare(day(b.date)));
  const adjacent = history.find((f) => day(f.date) === day(facts.previousDate));
  const prior =
    adjacent ?? (previous && day(previous.date) < date ? previous : undefined);
  const previousExact = Boolean(
    adjacent && day(facts.previousDate) === day(adjacent.date),
  );
  const rows = unique(suppliedRows);
  const rowByCode = new Map(rows.map((r) => [r.code, r]));
  const snapshotVisible =
    captured === null || captured <= target || facts.cutoff === '15:00';
  const sealedStocks = unique(snapshotVisible ? suppliedStocks : []);
  const sealedByCode = new Map(sealedStocks.map((s) => [s.code, s]));
  const boardsReady =
    (facts.coreStructureReady ?? (!facts.stale && facts.poolsReady)) &&
    sealedStocks.length === facts.limitUp;
  const failedReady =
    (facts.coreNegativePoolsReady ?? (!facts.stale && facts.poolsReady)) &&
    (facts.failedStocks?.length ?? -1) === facts.failed;
  const downReady =
    (facts.coreNegativePoolsReady ?? (!facts.stale && facts.poolsReady)) &&
    (facts.limitDownStocks?.length ?? -1) === facts.limitDown;
  const failedByCode = new Map(
    unique(facts.failedStocks ?? []).map((s) => [s.code, s]),
  );
  const downByCode = new Map(
    unique(facts.limitDownStocks ?? []).map((s) => [s.code, s]),
  );
  const priorByCode = new Map(unique(stocksOf(prior)).map((s) => [s.code, s]));
  const allMeta = new Map<string, EmotionStock>();
  for (const f of history)
    for (const s of [
      ...stocksOf(f),
      ...(f.failedStocks ?? []),
      ...(f.limitDownStocks ?? []),
    ])
      allMeta.set(codeOf(s.code), s);
  for (const s of [
    ...sealedStocks,
    ...failedByCode.values(),
    ...downByCode.values(),
  ])
    allMeta.set(codeOf(s.code), s);
  const oldRows = unique(
    (t?.oldLeaders?.rows ?? []).filter(
      (r) =>
        (!r.availableAt || atOrBefore(r.availableAt)) &&
        (!r.brokenDate || day(r.brokenDate) <= date) &&
        (r.peakHeight ?? r.height ?? 0) >= 2,
    ),
  );
  const oldByCode = new Map(oldRows.map((r) => [r.code, r]));
  const repairs = unique(
    (t?.failedRepair?.rows ?? []).filter(
      (r) => !r.availableAt || atOrBefore(r.availableAt),
    ),
  );
  const repairByCode = new Map(repairs.map((r) => [r.code, r]));
  const rebounds = new Map(
    unique(t?.rebounds?.rows ?? []).map((r) => [r.code, r]),
  );
  const extremePaths = new Map(
    unique(t?.extremePaths?.rows ?? [])
      .filter(
        (r) =>
          day(r.date) === date &&
          atOrBefore(r.observedAt) &&
          r.status === 'READY' &&
          (r.skyFloor === false ||
            (r.skyFloor === true &&
              r.upTime &&
              r.downTime &&
              sameDayBefore(r.upTime) &&
              sameDayBefore(r.downTime) &&
              r.upTime < r.downTime)),
      )
      .map((r) => [r.code, r]),
  );
  // Independent modules keep their own visibility time. A late tracking response
  // must not discard an earlier valid speed sample from the same trading date.
  const speedRows = unique(
    (envelopeDate === date ? (evidence?.speedRows ?? []) : []).filter(
      (r) =>
        (!r.availableAt || atOrBefore(r.availableAt)) &&
        (!r.quoteTime || sameDayBefore(r.quoteTime)),
    ),
  );
  const speedByCode = new Map(speedRows.map((r) => [r.code, r]));

  const concepts = new Map<
    string,
    { names: string[]; state: EvidenceState; time: string | null }
  >();
  for (const [rawCode, names] of Object.entries(t?.concepts ?? {})) {
    const c = codeOf(rawCode),
      state = t?.conceptStates?.[rawCode] ?? t?.conceptsState;
    const asOf = t?.conceptsAsOf ?? t?.conceptsAvailableAt;
    concepts.set(c, {
      names: [...new Set(names)],
      time: asOf ?? null,
      state:
        state === 'MISSING' ||
        state === 'RECOVERED_LATE' ||
        (asOf && !atOrBefore(asOf))
          ? 'MISSING'
          : state === 'READY' && asOf && atOrBefore(asOf)
            ? 'READY'
            : 'DEGRADED',
    });
  }
  for (const r of speedRows)
    if (r.concepts?.length) {
      const asOf = r.metadataAsOf;
      const state: EvidenceState =
        r.metadataState === 'RECOVERED_LATE' ||
        r.metadataState === 'MISSING' ||
        (asOf && !atOrBefore(asOf))
          ? 'MISSING'
          : r.metadataState === 'READY' && asOf && atOrBefore(asOf)
            ? 'READY'
            : 'DEGRADED';
      const existing = concepts.get(r.code);
      if (!existing || state === 'READY')
        concepts.set(r.code, {
          names: [...new Set(r.concepts)],
          state,
          time: asOf ?? null,
        });
    }
  const sharedConcept = (a: string, b: string) => {
    const x = concepts.get(a),
      y = concepts.get(b);
    return x?.state === 'READY' && y?.state === 'READY'
      ? (x.names.find((n) => y.names.includes(n)) ?? null)
      : null;
  };
  const validRebound = (r?: Rebound) => {
    const e = r?.event;
    const localEventReady =
      r?.status === 'DEGRADED' &&
      r.eventState === 'READY' &&
      r.eventWindow?.complete === true &&
      r.eventWindow.intervalMinutes === 1 &&
      r.eventWindow.samples >= 4 &&
      r.eventWindow.start === e?.lowTime &&
      r.eventWindow.end === e?.time;
    if (
      (r?.status !== 'READY' && !localEventReady) ||
      !e ||
      !sameDayBefore(e.time) ||
      !sameDayBefore(e.lowTime) ||
      !finite(e.lowPct) ||
      e.lowPct > -5 ||
      !finite(e.recoveryPp) ||
      e.recoveryPp < 4 ||
      (e.availableAt && !atOrBefore(e.availableAt)) ||
      (r.availableAt && !atOrBefore(r.availableAt))
    )
      return null;
    const low = tradingMinute(e.lowTime),
      end = tradingMinute(e.time);
    return low !== null && end !== null && end > low ? e : null;
  };
  function pairsOf(groups: Group[], direction: 'up' | 'down'): Pair[] {
    const out: Pair[] = [];
    for (const g of groups) {
      const c = codeOf(g.core.code),
        onset = g.onset;
      const corePath = rebounds.get(c);
      if (
        !onset ||
        !sameDayBefore(onset.time) ||
        (g.availableAt && !atOrBefore(g.availableAt)) ||
        (g.status !== 'READY' && corePath?.status !== 'READY')
      )
        continue;
      if (
        finite(onset.gain) &&
        (direction === 'up' ? onset.gain < 1 : onset.gain > -1)
      )
        continue;
      const start = tradingMinute(onset.time);
      if (start === null) continue;
      for (const m of g.rows ?? []) {
        const end = tradingMinute(m.time);
        if (
          m.pathState !== 'READY' ||
          !m.time ||
          !sameDayBefore(m.time) ||
          end === null ||
          (m.availableAt && !atOrBefore(m.availableAt))
        )
          continue;
        const lag = end - start;
        const follows =
          direction === 'down'
            ? m.role === '随后负向响应'
            : m.role === '随后响应';
        if (lag < 1 || lag > 10 || !finite(m.lag) || m.lag !== lag || !follows)
          continue;
        const member = codeOf(m.code);
        if (member === c) continue;
        out.push({
          core: c,
          coreName: g.core.name,
          member,
          memberName: m.name,
          onset: onset.time,
          time: m.time,
          lag,
          concept: sharedConcept(c, member),
          direction,
          source: g.source ?? t?.source ?? source,
        });
      }
    }
    return [
      ...new Map(
        out.map((p) => [`${p.core}:${p.member}:${p.onset}:${p.direction}`, p]),
      ).values(),
    ];
  }
  const upPairs = pairsOf(t?.leadLag?.rows ?? [], 'up');
  const downPairs = pairsOf(t?.negativeLeadLag?.rows ?? [], 'down');
  const registry = new Map<string, Registry>();
  const recall = (
    rawCode: string,
    name: string,
    role: EmotionCoreRole,
    reason: string,
    at = targetTime,
    peak = 0,
  ) => {
    const code = codeOf(rawCode);
    if (!/^\d{6}$/.test(code)) return;
    const r = registry.get(code) ?? {
      code,
      name,
      roles: new Set<EmotionCoreRole>(),
      reasons: [],
      firstSeen: at,
      peak: 0,
      brokenDate: null,
    };
    r.roles.add(role);
    if (!r.reasons.includes(reason)) r.reasons.push(reason);
    if ((stamp(date, at) ?? target) < (stamp(date, r.firstSeen) ?? target))
      r.firstSeen = at;
    r.peak = Math.max(r.peak, peak);
    registry.set(code, r);
  };
  const recallTiers = (ss: EmotionStock[], when: string, current: boolean) => {
    // Top two levels are ONE recall channel. First-board-only markets are not cores.
    const levels = [...new Set(ss.map((s) => s.height).filter((h) => h >= 2))]
      .sort((a, b) => b - a)
      .slice(0, 2);
    for (const s of ss)
      if (levels.includes(s.height))
        recall(
          s.code,
          s.name,
          current
            ? s.height === levels[0]
              ? '当前最高竞争者'
              : '当前次高竞争者'
            : '最近交易日最高板/核心',
          `${when.slice(0, 16)} 可见${s.height}板${s.height === levels[0] ? '空间最高层' : '同梯队次高层'}；只作空间竞争观察，非龙头认证`,
          when,
          s.height,
        );
  };
  recallTiers(
    sealedStocks,
    facts.retrievedAt && sameDayBefore(facts.retrievedAt)
      ? facts.retrievedAt
      : targetTime,
    true,
  );
  if (prior)
    recallTiers(
      stocksOf(prior),
      `${dashed(day(prior.date))}T15:00:00+08:00`,
      false,
    );
  // Full historical registry: a lookback UI control never silently deletes identity.
  for (const f of history) {
    const ss = stocksOf(f),
      max = Math.max(0, ...ss.map((s) => s.height));
    if (
      max < 2 ||
      !f.poolsReady ||
      f.status === 'MISSING' ||
      ss.length !== f.limitUp
    )
      continue;
    for (const s of ss.filter((s) => s.height === max))
      recall(
        s.code,
        s.name,
        '最近交易日最高板/核心',
        `${f.date} 曾处空间最高层${s.height}板；保留市场记忆观察，历史板数本身不证明当期带动`,
        `${dashed(day(f.date))}T15:00:00+08:00`,
        s.height,
      );
  }
  for (const old of oldRows) {
    const visibleIdentityTime =
      old.brokenDate && day(old.brokenDate) < date
        ? `${dashed(day(old.brokenDate))}T15:00:00+08:00`
        : targetTime;
    recall(
      old.code,
      old.name,
      '断板老高标',
      `历史跟踪已记录峰值${old.peakHeight ?? old.height}板${old.brokenDate ? `，断板日${old.brokenDate}` : ''}；无衰减证据不退出`,
      visibleIdentityTime,
      old.peakHeight ?? old.height ?? 0,
    );
    registry.get(old.code)!.brokenDate = old.brokenDate
      ? day(old.brokenDate)
      : null;
  }
  const verifiedInfluenceHistory = (evidence?.influenceHistory ?? []).filter(
    (proof) => {
      const knownAt = stamp(proof.date, proof.observedAt);
      return (
        proof.state === 'READY' &&
        day(proof.date) <= date &&
        knownAt !== null &&
        dateAt(knownAt) === day(proof.date) &&
        knownAt <= target &&
        new Set(
          proof.respondingCodes
            .map(codeOf)
            .filter((c) => c !== codeOf(proof.code)),
        ).size >= 2 &&
        Boolean(proof.source && proof.concept)
      );
    },
  );
  for (const proof of verifiedInfluenceHistory) {
    recall(
      proof.code,
      proof.name ?? allMeta.get(codeOf(proof.code))?.name ?? proof.code,
      proof.direction === 'down' ? '负向响应观察' : '题材响应观察',
      `${proof.date} ${proof.observedAt.slice(11, 16)}已记录${proof.concept}至少2个成员随后${proof.direction === 'down' ? '负向' : '正向'}响应；历史观察保留，今日是否仍有影响另行验证`,
      proof.observedAt,
    );
  }
  for (const r of registry.values()) {
    let wasSealed = false;
    let previousObservedDay = '';
    for (const f of history) {
      // A stock's ordinary first board BEFORE recognizable identity is not a
      // historical high-core break and cannot create a false second-wave label.
      if (day(f.date) < day(r.firstSeen)) continue;
      const present = stocksOf(f).some((s) => codeOf(s.code) === r.code);
      if (
        wasSealed &&
        !present &&
        f.poolsReady &&
        !r.brokenDate &&
        day(f.previousDate) === previousObservedDay &&
        stocksOf(f).length === f.limitUp
      )
        r.brokenDate = day(f.date);
      if (present) wasSealed = true;
      previousObservedDay = day(f.date);
    }
    if (r.brokenDate && !sealedByCode.has(r.code)) r.roles.add('断板老高标');
    if (
      priorByCode.has(r.code) &&
      !sealedByCode.has(r.code) &&
      (boardsReady || rowByCode.has(r.code))
    ) {
      r.brokenDate ??= date;
      r.roles.add('断板老高标');
      r.reasons.push('前一交易日空间候选今日未继续封板；断板不删除跟踪身份');
    }
  }
  const largeAmounts = speedRows
    .filter((r) => finite(r.amount) && r.amount > 0)
    .sort((a, b) => b.amount! - a.amount!);
  const liquid = new Set(
    largeAmounts
      .slice(0, 3)
      .filter((r) => r.amount! >= 1e9)
      .map((r) => r.code),
  );
  for (const s of speedRows) {
    const ownPairs = upPairs.filter((p) => p.core === s.code),
      related = ownPairs.filter((p) => p.concept);
    const recent = history
      .slice(-3)
      .map(
        (f) =>
          f.closeQuotes?.[s.code]?.changePct ??
          stocksOf(f).find((x) => codeOf(x.code) === s.code)?.changePct,
      )
      .filter(finite);
    const persistent =
      recent.length >= 2 && recent.filter((n) => n > 0).length >= 2;
    const capacity =
      liquid.has(s.code) &&
      (related.length >= 1 || (ownPairs.length >= 2 && persistent));
    if (capacity)
      recall(
        s.code,
        s.name,
        '趋势容量核心候选',
        `采集成交额样本${largeAmounts.length}只中位列前3、成交额${(s.amount! / 1e8).toFixed(2)}亿；另有${related.length}个已核验概念成员响应${persistent ? '及多日正反馈' : ''}。仅容量候选，不以20cm代码授予身份`,
      );
  }
  for (const p of [...upPairs, ...downPairs]) {
    const existing = registry.get(p.core),
      s = speedByCode.get(p.core),
      meta = allMeta.get(p.core);
    // Relation recall is independent of board height, speed-list membership,
    // return sign and size. An observed local sequence is not a leader award.
    if (!existing && !p.concept) continue;
    recall(
      p.core,
      existing?.name ?? s?.name ?? meta?.name ?? p.coreName ?? p.core,
      p.direction === 'down' ? '负向响应观察' : '题材响应观察',
      `${p.onset}本股先${p.direction === 'down' ? '回落' : '拉升'}，${p.member}于${p.time}随后${p.direction === 'down' ? '负向' : '正向'}响应（${p.lag}交易分钟）；${p.concept ? `同属已核验概念${p.concept}` : '仅同组时序线索，概念归属缺证据'}，不单独认定因果`,
    );
  }
  // Extreme failures/repairs only recall already recognizable stocks, never all failed first boards.
  for (const r of registry.values()) {
    const nowBad =
      failedByCode.has(r.code) ||
      downByCode.has(r.code) ||
      extremePaths.get(r.code)?.skyFloor === true;
    const priorBad =
      prior?.failedStocks?.some((s) => codeOf(s.code) === r.code) ||
      prior?.limitDownStocks?.some((s) => codeOf(s.code) === r.code);
    if (nowBad || priorBad) {
      r.roles.add(
        downByCode.has(r.code) || extremePaths.get(r.code)?.skyFloor === true
          ? '极端负反馈代表'
          : '分歧失败跟踪',
      );
      r.reasons.push(
        `${nowBad ? '当日' : '前一交易日'}已辨识股票出现炸板或跌停池记录，继续跟踪负反馈`,
      );
    }
    if (validRebound(rebounds.get(r.code))) {
      r.roles.add('反核/反包尝试');
      r.reasons.push('精确分钟路径出现深水后回拉；单股仅算反核尝试');
    }
    if (
      r.brokenDate &&
      r.brokenDate < date &&
      sealedByCode.has(r.code) &&
      boardsReady
    ) {
      r.roles.add('反核/反包尝试');
      r.reasons.push(
        '断板历史之后，当日涨停池再次出现；确认重新涨停结果，不倒推盘中主动性',
      );
    }
  }
  const quoteFor = (c: string): Quote => {
    const candidates: Quote[] = [];
    const add = (
      value: unknown,
      time: string | null | undefined,
      sourceName?: string | null,
      degraded = false,
    ) => {
      if (!finite(value) || !time || !sameDayBefore(time)) return;
      const n = stamp(date, time)!;
      const fresh =
        facts.cutoff === '15:00' ? n === cutoffStamp : target - n <= 60000;
      candidates.push({
        value,
        time,
        source: sourceName ?? source,
        state: fresh && !degraded ? 'READY' : 'DEGRADED',
      });
    };
    const row = rowByCode.get(c),
      old = oldByCode.get(c),
      repair = repairByCode.get(c),
      speed = speedByCode.get(c);
    add(row?.changePct, row?.priceQuoteTime ?? row?.quoteTime, '梯队逐股报价');
    const path = tapeByCode.get(c);
    // The actual minute quote time, never the response receipt time.
    add(path?.changePct, path?.quoteTime, path?.source);
    const q = facts.closeQuotes?.[c];
    add(q?.changePct, q?.quoteTime, q?.source, Boolean(facts.stale));
    add(
      repair?.changePct,
      repair?.quoteTime,
      repair?.quoteSource ?? t?.source,
      evidence?.sourceState === 'STALE',
    );
    add(
      old?.changePct,
      old?.quoteTime,
      old?.quoteSource ?? t?.source,
      evidence?.sourceState === 'STALE',
    );
    for (const path of old?.path ?? [])
      if (
        day(path.date) === date &&
        (!path.availableAt || atOrBefore(path.availableAt))
      )
        add(
          path.changePct,
          path.quoteTime,
          path.quoteSource ?? t?.source,
          path.quoteState !== 'READY',
        );
    add(
      speed?.changePct,
      speed?.quoteTime ??
        (evidenceAligned
          ? (evidence?.availableAt ?? evidence?.retrievedAt ?? null)
          : null),
      speed?.quoteSource ?? source,
      evidence?.sourceState === 'STALE',
    );
    const s = sealedByCode.get(c) ?? failedByCode.get(c) ?? downByCode.get(c);
    if (s && !candidates.some((candidate) => candidate.state === 'READY')) {
      const isSealed = sealedByCode.has(c);
      const poolTime = isSealed
        ? facts.retrievedAt
        : (facts.coreNegativePoolsAt ?? facts.retrievedAt);
      const stockStamp =
        (s as EmotionStock & { quoteTime?: string; priceQuoteTime?: string })
          .priceQuoteTime ??
        (s as EmotionStock & { quoteTime?: string }).quoteTime;
      add(
        s.changePct,
        stockStamp ??
          (poolTime && sameDayBefore(poolTime) ? poolTime : targetTime),
        stockStamp
          ? '目标时点逐股池报价'
          : '涨停/炸板/跌停池采集快照（非逐股成交时刻）',
        (isSealed ? !boardsReady : !(failedReady && downReady)) ||
          (facts.cutoff !== '15:00' && !stockStamp),
      );
    }
    return (
      candidates.sort(
        (a, b) =>
          (stamp(date, b.time) ?? 0) - (stamp(date, a.time) ?? 0) ||
          Number(b.state === 'READY') - Number(a.state === 'READY'),
      )[0] ?? { value: null, time: null, state: 'MISSING', source: null }
    );
  };
  const priorPrice = (c: string): number | null => {
    if (!previousExact || !adjacent) return null;
    const q = adjacent.closeQuotes?.[c];
    if (
      q &&
      finite(q.changePct) &&
      stamp(day(adjacent.date), q.quoteTime) ===
        stamp(day(adjacent.date), '15:00')
    )
      return q.changePct;
    const s = [
      ...stocksOf(adjacent),
      ...(adjacent.failedStocks ?? []),
      ...(adjacent.limitDownStocks ?? []),
    ].find((x) => codeOf(x.code) === c);
    return adjacent.poolsReady && finite(s?.changePct) ? s.changePct : null;
  };
  const dimension = (
    state: EvidenceState,
    fact: string,
    basis: string,
    time = targetTime,
    src = source,
  ): CoreDimension => ({ state, fact, basis, observedAt: time, source: src });
  const info = new Map<
    string,
    {
      sealed: boolean | null;
      broken: boolean;
      rebound: ReturnType<typeof validRebound>;
      up: Pair[];
      down: Pair[];
      repaired: boolean;
      decayReady: boolean;
      exited: boolean;
    }
  >();
  const candidates: CoreCandidate[] = [...registry.values()]
    .map((r): CoreCandidate => {
      const c = r.code,
        row = rowByCode.get(c),
        s = sealedByCode.get(c),
        meta = allMeta.get(c),
        speed = speedByCode.get(c),
        q = quoteFor(c),
        pricePath = tapeByCode.get(c);
      const own = upPairs.filter((p) => p.core === c),
        related = own.filter((p) => p.concept);
      const historicalIdentity = verifiedInfluenceHistory.filter(
        (x) => codeOf(x.code) === c && day(x.date) < date,
      );
      const negativeOwn = downPairs.filter((p) => p.core === c);
      const directional = [...related, ...negativeOwn.filter((p) => p.concept)];
      const currentGroups: CoreCandidate['interpretation']['influence']['groups'] =
        [...new Set(directional.map((p) => `${p.direction}:${p.concept}`))].map(
          (key) => {
            const pairs = directional.filter(
              (p) => `${p.direction}:${p.concept}` === key,
            );
            const first = pairs[0];
            return {
              concept: first.concept!,
              direction: first.direction,
              members: [
                ...new Map(
                  pairs.map((p) => [
                    p.member,
                    {
                      code: p.member,
                      name:
                        allMeta.get(p.member)?.name ??
                        rowByCode.get(p.member)?.name ??
                        p.memberName ??
                        p.member,
                      time: p.time,
                      lag: p.lag,
                    },
                  ]),
                ).values(),
              ],
              historyDays: [
                ...new Set(
                  verifiedInfluenceHistory
                    .filter(
                      (x) =>
                        codeOf(x.code) === c &&
                        day(x.date) < date &&
                        x.state === 'READY' &&
                        atOrBefore(x.observedAt, x.date) &&
                        x.concept === first.concept &&
                        (x.direction ?? 'up') === first.direction &&
                        Boolean(x.source) &&
                        new Set(
                          x.respondingCodes.map(codeOf).filter((z) => z !== c),
                        ).size >= 2,
                    )
                    .map((x) => day(x.date)),
                ),
              ].sort(),
            };
          },
        );
      const peerPairs = own.filter(
        (p) => row && rowByCode.get(p.member)?.fromHeight === row.fromHeight,
      );
      const following = upPairs.filter((p) => p.member === c);
      const rebound = validRebound(rebounds.get(c));
      const repaired = Boolean(
        r.brokenDate && r.brokenDate < date && s && boardsReady,
      );
      const broken = Boolean(r.brokenDate && !s);
      const trackedToday =
        Boolean(row && row.fromHeight >= 2) ||
        Boolean(prior?.failedStocks?.some((item) => codeOf(item.code) === c)) ||
        Boolean(
          prior?.limitDownStocks?.some((item) => codeOf(item.code) === c),
        );
      const observedToday =
        Boolean(s) ||
        own.length > 0 ||
        downPairs.some((pair) => pair.core === c) ||
        Boolean(rebound) ||
        (downReady && downByCode.has(c)) ||
        Boolean(
          pricePath &&
          (pricePath.support === 'RESEALED' ||
            pricePath.support === 'OPENED' ||
            pricePath.limitState === 'LIMIT_DOWN' ||
            pricePath.initiative.result === 'OBSERVED'),
        );
      const scope: NonNullable<CoreCandidate['scope']> = observedToday
        ? 'ACTIVE'
        : trackedToday
          ? 'COMPETITOR'
          : 'HISTORY';
      const scopeReason = observedToday
        ? '当日已有封板、局部价格事件或真实响应证据，列入活跃观察；不等于认证龙头'
        : trackedToday
          ? '前一交易日仍承担竞争或负反馈角色，今日继续核验，不因暂缺报价移除'
          : '保留历史身份；当前无足够活跃证据，不混入当前群体统计，也不视为影响衰减退出';
      const seenSealed = boardsReady
        ? Boolean(s)
        : row
          ? row.state === 'SEALED'
          : null;
      const actualHeight = s ? s.height : null;
      const pos = dimension(
        s ? (boardsReady ? 'READY' : 'DEGRADED') : row ? 'READY' : 'DEGRADED',
        s
          ? `${boardsReady ? '当前' : '旧快照'}${s.height}板；历史峰值${r.peak}板`
          : `当前未确认连板高度；历史峰值${r.peak}板${row ? `，昨日${row.fromHeight}板、当前${row.state}` : ''}`,
        '板位与空间竞争是召回证据，不是龙头身份；断板不显示未完成的“昨板+1”',
      );
      let initiative = own.length
        ? dimension(
            minuteCurrent ? 'READY' : 'DEGRADED',
            `${own[0].onset}先动；${own.length}个已核验成员其后响应${peerPairs.length ? `，含${peerPairs.length}个同身位` : ''}`,
            '使用同日连续分钟路径的先后；卡位还需同身位比较，不由首触时刻或日线推定' +
              (minuteCurrent ? '' : '；该分钟快照较旧，不代表当前主动性已确认'),
            minuteObservedAt ?? targetTime,
            own[0].source,
          )
        : dimension(
            'MISSING',
            following.length
              ? `本股${following[0].time}随后响应；不能继承先动者主动性`
              : rebound
                ? `${rebound.time}出现单股回拉，缺相对板块/同身位先动证据`
                : '主动先后缺少分钟证据',
            '自身反弹或涨速单值不足以证明先于板块和竞争者发动',
          );
      let leadership = directional.length
        ? dimension(
            minuteCurrent ? 'READY' : 'DEGRADED',
            currentGroups
              .map(
                (g) =>
                  `${g.concept}${g.direction === 'down' ? '负向' : '正向'}：${g.members.map((m) => `${m.name}@${m.time}(滞后${m.lag}分钟)`).join('、')}`,
              )
              .join('；'),
            '同一对股票的概念归属与分钟响应同时核验；这是观测先后，不是独立因果证明' +
              (minuteCurrent ? '' : '；分钟快照较旧，当前带动状态降级'),
            minuteObservedAt ?? targetTime,
            directional[0].source,
          )
        : dimension(
            own.length || following.length ? 'DEGRADED' : 'MISSING',
            own.length
              ? `${own.length}个同组成员随后响应，概念有效关系缺失`
              : following.length
                ? '本股是随后响应成员，不是带动者'
                : '没有已核验成员响应',
            '行业相同不等于概念主线；任何成员缺证据不会把其他已核验时序事实抹掉',
          );
      const comparable =
        q.state === 'READY' &&
        (facts.coreContextReady ?? !facts.stale) &&
        facts.breadthReady &&
        finite(facts.breadth.medianChangePct);
      let antiFall = dimension(
        comparable ? 'READY' : q.value !== null ? 'DEGRADED' : 'MISSING',
        `个股${pct(q.value)}（${q.time ?? '时刻缺失'}）；市场中位${pct(facts.breadth.medianChangePct)}`,
        comparable
          ? `同一判断时点相对市场中位差${(q.value! - facts.breadth.medianChangePct!).toFixed(2)}个百分点；仅相对结果，不推断资金意图`
          : '报价或市场参照未同时间对齐，不能确认相对抗跌',
        q.time ?? targetTime,
        q.source ?? source,
      );
      // Availability and conclusion are orthogonal. A complete comparison with
      // no new attack/response is a known negative observation, not missing data.
      if (pricePath && tape) {
        const observedDimension = (
          item: typeof pricePath.initiative,
          boundary: string,
        ): CoreDimension => ({
          state: item.state,
          result: item.result,
          fact: [item.label, ...item.facts].join('；'),
          basis: `${boundary}；比较${item.comparedCodes.join('、') || '对象不足'}；${tape.scope}`,
          observedAt: tape.observedAt,
          source: pricePath.source,
        });
        if (pricePath.initiative.state !== 'MISSING')
          initiative = observedDimension(
            pricePath.initiative,
            '只说明该可见窗口的相对先动；无需等待别人响应才记录先动',
          );
        if (
          pricePath.response.state !== 'MISSING' &&
          leadership.state !== 'READY'
        )
          leadership = observedDimension(
            pricePath.response,
            '这是可见成员价格响应观察；行业不等于概念，不能认证全市场龙头或因果带动',
          );
        if (pricePath.resilience.state !== 'MISSING')
          antiFall = observedDimension(
            pricePath.resilience,
            '抗分歧仅在同身位已比较样本中成立；市场/指数参照另行核验',
          );
      }
      const identity = dimension(
        r.peak >= 2 || directional.length || historicalIdentity.length
          ? 'READY'
          : 'MISSING',
        r.peak >= 2
          ? `历史空间记忆${r.peak}板；${r.brokenDate ? `断板自${dashed(r.brokenDate)}` : '仍跟踪当前竞争'}`
          : historicalIdentity.length && !directional.length
            ? historicalIdentity
                .map(
                  (x) =>
                    `历史${x.date} ${x.concept}${x.direction === 'down' ? '负向' : '正向'}响应观察：${new Set(x.respondingCodes.map(codeOf)).size}成员`,
                )
                .join('；')
            : `局部题材响应观察，已核验${new Set(directional.map((p) => p.member)).size}个成员；不等于容量核心`,
        'READY仅表示此处身份来源可追溯，不是市场核心认证；身份与今日强弱、影响方向独立',
      );
      const peers = row
        ? rows.filter((p) => p.code !== c && p.fromHeight === row.fromHeight)
        : [];
      const peerQuotes = peers
        .map((p) => ({ p, q: quoteFor(p.code) }))
        .filter((x) => x.q.state === 'READY');
      const expectation = dimension(
        q.state === 'READY' && peerQuotes.length ? 'DEGRADED' : 'MISSING',
        peerQuotes.length
          ? `同身位：${peerQuotes.map((x) => `${x.p.name}${pct(x.q.value)}`).join('、')}；本股${pct(q.value)}`
          : '缺少同身位同时间参照',
        '可对比当日相对表现；没有盘前预期和竞价基线，不能声称已确认“超预期”',
      );
      const volume = (
        evidenceAligned ? (evidence?.volumeEvidence ?? []) : []
      ).find(
        (v) =>
          codeOf(v.code) === c &&
          v.state === 'READY' &&
          sameDayBefore(v.observedAt) &&
          target - (stamp(date, v.observedAt) ?? 0) <= 60_000 &&
          finite(v.currentVolume) &&
          finite(v.baselineVolume) &&
          v.baselineVolume > 0 &&
          v.intervalMinutes > 0 &&
          v.intervalMinutes === v.baselineIntervalMinutes &&
          Boolean(v.source),
      );
      const volumeRatio = volume
        ? volume.currentVolume / volume.baselineVolume
        : null;
      const chips = dimension(
        volume
          ? 'READY'
          : finite(speed?.amount) || s?.breakCount !== undefined
            ? 'DEGRADED'
            : 'MISSING',
        volume
          ? `同长度${volume.intervalMinutes}分钟窗口成交量${volume.currentVolume}/${volume.baselineVolume}，比值${volumeRatio!.toFixed(2)}；开板${s?.breakCount ?? '缺失'}次`
          : `成交额${finite(speed?.amount) ? `${(speed.amount / 1e8).toFixed(2)}亿` : '缺失'}；开板${s?.breakCount ?? '缺失'}次；可比量能基线缺失`,
        '开板不等于爆量；成交额存在不等于健康承接。加速/爆量状态必须有同长度量能比较',
        volume?.observedAt ?? targetTime,
        volume?.source ?? source,
      );
      const influenceDays = [
        ...new Set(currentGroups.flatMap((g) => g.historyDays)),
      ];
      const groupInfluence = dimension(
        directional.length && minuteCurrent
          ? 'READY'
          : own.length || negativeOwn.length
            ? 'DEGRADED'
            : 'MISSING',
        directional.length
          ? currentGroups
              .map(
                (g) =>
                  `${g.concept}：${g.members.length}个${g.direction === 'down' ? '负向' : '正向'}响应，历史同题材同方向观察${g.historyDays.length}日`,
              )
              .join('；')
          : own.length
            ? '有局部先后关系，未确认概念或整体核心情绪扩散'
            : '群体影响证据缺失',
        '仅报告实际覆盖的板块/接力成员；没有跨层与市场路径时，不升级为整体情绪修复',
        minuteObservedAt ?? targetTime,
      );
      const decay = (evidence?.decayObservations ?? [])
        .filter(
          (x) =>
            codeOf(x.code) === c &&
            day(x.date) <= date &&
            x.state === 'READY' &&
            atOrBefore(x.observedAt, x.date) &&
            Boolean(x.source) &&
            finite(x.coverage) &&
            x.coverage >= 0.9 &&
            [x.liquidityShare, x.responseCount, x.recognitionCount].every(
              (n) => finite(n) && n >= 0,
            ),
        )
        .sort((a, b) => day(a.date).localeCompare(day(b.date)));
      const ds = [
        ...new Map(decay.map((x) => [day(x.date), x])).values(),
      ].slice(-3);
      const decayReady = ds.length === 3;
      const decliningProxies =
        decayReady &&
        ds.every(
          (x, i) =>
            i === 0 ||
            (x.liquidityShare < ds[i - 1].liquidityShare &&
              x.responseCount < ds[i - 1].responseCount &&
              x.recognitionCount < ds[i - 1].recognitionCount),
        );
      // These inputs have neither a fixed observation-universe identity nor
      // continuous-session/low-residual-influence evidence. Three falling
      // proxies cannot certify extinction; keep the identity in history.
      const exited = false;
      const persistence = dimension(
        influenceDays.length >= 2 ? 'READY' : 'DEGRADED',
        `身份首次可见${r.firstSeen.slice(0, 10)}；当前同题材同方向历史观察${influenceDays.length}日；三维代理量记录${ds.length}/3日${decliningProxies ? '，数值下降' : ''}`,
        '下降不等于退出：尚缺固定观察范围、连续交易日、显著衰减及当前正负两侧影响消失的证据。无当前事件只移入历史观察，不删除身份',
      );

      const transitionTrace: CoreCandidate['transitionTrace'] = [
        {
          from: null,
          to: '潜在核心',
          observedAt: r.firstSeen,
          evidence: r.reasons[0],
          source,
        },
      ];
      let state: EmotionCoreState = '潜在核心';
      const move = (next: EmotionCoreState, when: string, why: string) => {
        if (
          next === state ||
          !atOrBefore(when) ||
          (stamp(date, when) ?? 0) <
            (stamp(date, transitionTrace.at(-1)?.observedAt) ?? 0)
        )
          return;
        transitionTrace.push({
          from: state,
          to: next,
          observedAt: when,
          evidence: why,
          source,
        });
        state = next;
      };
      if (r.brokenDate && r.brokenDate < date) {
        move(
          '修复/断板',
          `${dashed(r.brokenDate)}T15:00:00+08:00`,
          '已知历史完整涨停池中断板，不删除身份',
        );
        move('老高标跟踪', targetTime, '保留历史身份；未获三类持续衰减证据');
      }
      if (
        !r.brokenDate &&
        historicalIdentity.length > 0 &&
        !own.length &&
        !negativeOwn.length
      )
        move(
          r.peak >= 2 ? '老高标跟踪' : '历史角色跟踪',
          targetTime,
          '历史题材响应观察保留；当日响应缺失不等于影响衰减，也不认证连续因果带动',
        );
      const peerLeading =
        minuteCurrent &&
        peerPairs.some((p) => {
          const pq = quoteFor(p.member);
          return (
            q.state === 'READY' && pq.state === 'READY' && q.value! > pq.value!
          );
        });
      const relativeSupport =
        pricePath?.resilience.result === 'OBSERVED' &&
        pricePath.peerRelations.some(
          (peer) =>
            peer.relation === 'MORE_STABLE' ||
            peer.relation === 'REPAIR_SEPARATION',
        );
      const localConvergence =
        minuteCurrent &&
        currentGroups.some(
          (g) => g.direction === 'up' && g.members.length >= 2,
        ) &&
        relativeSupport &&
        pricePath?.initiative.result === 'OBSERVED';
      const repairSeparation =
        pricePath?.support === 'RESEALED' &&
        q.state === 'READY' &&
        pricePath.peerRelations.some(
          (peer) => peer.relation === 'REPAIR_SEPARATION',
        );
      if (repaired)
        move(
          '反包或二波',
          targetTime,
          '已知断板后再次进入当前涨停池；此状态不等于反核或群体修复确认',
        );
      else if (repairSeparation)
        move(
          '分离/卡位',
          targetTime,
          `可见分钟${pricePath!.resealedAt}回到涨停价，并相对同身位形成修复分离；这是价格承接差异，不直接确认龙头`,
        );
      else if (peerLeading)
        move(
          '分离/卡位',
          targetTime,
          '同身位可核验分钟先动，且同时间报价相对分离；不直接授予龙头',
        );
      else if (minuteCurrent && directional.length > 0)
        move(
          localConvergence ? '龙头候选' : '局部响应观察',
          targetTime,
          localConvergence
            ? '同一可见窗口的先动、概念响应和相对承接共同支持候选；仍未确认市场核心'
            : '正负方向分别记录同题材先后；尚不能排除共同环境或其他先动者，不授予明牌核心',
        );
      else if (
        r.brokenDate === date ||
        pricePath?.support === 'OPENED' ||
        pricePath?.support === 'RESEALED' ||
        (failedReady && failedByCode.has(c)) ||
        rebound
      )
        move(
          '修复/断板',
          targetTime,
          pricePath?.support === 'OPENED' || pricePath?.support === 'RESEALED'
            ? pricePath.supportLabel + '；分钟采样事实，不把开板称为爆量'
            : rebound
              ? '自身深水回拉属于修复尝试，尚不等于群体扩散'
              : '当前未继续封板或出现炸板；保留空间/历史跟踪',
        );
      else if (peers.length || following.length)
        move(
          '同身位竞争',
          targetTime,
          following.length
            ? '本股属于随后响应成员，不是主动带动者'
            : '同身位竞争仍在进行，仅有板位或价格结果',
        );
      if (localConvergence && volumeRatio !== null && s && boardsReady) {
        if (volumeRatio >= 2 && (s.breakCount ?? 0) > 0)
          move('爆量分歧', targetTime, chips.fact);
        else if (
          volumeRatio < 0.8 &&
          s.breakCount === 0 &&
          q.value !== null &&
          q.value > 0
        )
          move(
            '加速一致',
            targetTime,
            '局部响应候选缩量且未开板；这是量价状态，不是核心身份升级',
          );
      }
      const dimensions = {
        position: pos,
        initiative,
        leadership,
        antiFall,
        identity,
        expectation,
        chips,
        groupInfluence,
        persistence,
      };
      const currentRole = negativeOwn.length
        ? related.length
          ? '正负响应并存 · 分歧观察'
          : '负向响应源观察 · 不因下跌丢失身份'
        : pricePath?.support === 'OPENED'
          ? '同身位打开回落 · 承接分歧'
          : pricePath?.support === 'STABLE_SEAL' && relativeSupport
            ? '空间承接角色 · 同身位较稳定'
            : repairSeparation
              ? '修复回封 · 同身位相对分离'
              : pricePath?.support === 'RESEALED'
                ? '局部修复回封观察'
                : localConvergence
                  ? '局部主动/响应/承接共现 · 核心候选'
                  : following.length && !own.length
                    ? '同身位被动跟随观察'
                    : peerLeading
                      ? '主动分离候选'
                      : r.roles.has('趋势容量核心候选')
                        ? `${boardFamily(c)}趋势容量候选`
                        : related.length
                          ? minuteCurrent
                            ? '板块先动候选'
                            : '曾先动候选（旧分钟观察）'
                          : historicalIdentity.length && !s
                            ? '历史题材响应角色跟踪'
                            : broken
                              ? '断板空间股/老高标跟踪'
                              : '空间竞争观察（未认证龙头）';
      info.set(c, {
        sealed: seenSealed,
        broken,
        rebound,
        up: own,
        down: negativeOwn,
        repaired,
        decayReady,
        exited,
      });
      return {
        code: c,
        name: r.name,
        roles: [...r.roles],
        currentRole,
        scope,
        scopeReason,
        pricePath,
        historicalHeight: r.peak || null,
        state,
        // A local price sequence cannot alone certify a market-wide core.
        provisional: true,
        interpretation: {
          identity: {
            label: broken
              ? '断板后保留空间身份'
              : r.roles.has('当前最高竞争者')
                ? '当前空间锚 · 非龙头认证'
                : r.roles.has('当前次高竞争者')
                  ? '次高空间竞争'
                  : r.peak >= 2
                    ? '历史空间身份'
                    : historicalIdentity.length && !directional.length
                      ? '历史题材响应身份'
                      : '题材局部响应身份',
            basis: identity.fact,
          },
          feedback: {
            label:
              q.state !== 'READY'
                ? '当前反馈数据不足'
                : (pricePath?.supportLabel ??
                  (q.value! < 0
                    ? '当前负反馈'
                    : q.value! > 0
                      ? '当前正反馈'
                      : '当前平盘')),
            basis: `截至${q.time ?? '报价时刻缺失'} ${pct(q.value)}；${pricePath ? '依据已见分钟路径，不扩展为全天结论' : '只有报价结果，未据此声称主动承接'}`,
          },
          influence: {
            direction:
              related.length && negativeOwn.some((p) => p.concept)
                ? 'MIXED'
                : related.length
                  ? 'UP'
                  : negativeOwn.some((p) => p.concept)
                    ? 'DOWN'
                    : 'UNRESOLVED',
            label: directional.length
              ? `${minuteCurrent ? '' : '旧观察 · '}${related.length && negativeOwn.some((p) => p.concept) ? '正负响应并存' : related.length ? '局部正向响应' : '局部负向响应'}，非因果认证`
              : '群体影响尚未确认',
            basis: directional.length
              ? '只覆盖列出的题材成员；不同概念、方向与历史观察不拼接认证。时间先后也可能来自共同消息或行情。'
              : leadership.fact + '；未观测到与证据缺失分开，不解释成没有影响',
            groups: currentGroups,
          },
          counterEvidence: [
            ...(following.length
              ? [
                  `本股也在${following[0].time}作为随后响应成员；不能把所有波动都解释为它发动`,
                ]
              : []),
            ...(q.state === 'READY' && q.value! < 0
              ? ['当前报价为负反馈；不能因历史地位仍在就描述为强势承接']
              : []),
            ...(negativeOwn.length
              ? ['已出现负向先后响应；影响仍在可能代表风险传播，而非走强']
              : []),
            ...(pricePath?.support === 'OPENED'
              ? ['可见封板后已打开，未维持先前强度']
              : []),
            ...(pricePath?.peerRelations.filter(
              (p) => p.relation === 'WEAKER_SUPPORT',
            ).length
              ? ['同身位存在更稳定对象，不能仅因板高授予核心地位']
              : []),
            ...(!directional.length
              ? ['缺少同时点概念成员响应，空间身份不能代替带动证据']
              : ['共同环境、消息驱动与其他先动者尚未排除']),
          ],
          nextCheck: negativeOwn.length
            ? '若本股修复，继续看同题材与中位负反馈是否同步收窄；只有自身反弹，仍只算单股修复'
            : broken || rebound
              ? '若回拉后低点抬高、同身位不再继续恶化且题材成员随后改善，再升级为局部修复扩散；重新回落则保留修复失败事实'
              : '继续核对后续助攻、分歧时相对承接及回踩后的再次响应；若成员先涨、本股后涨或响应未延续，应下调带动假设',
        },
        height: actualHeight,
        trend: boardFamily(c),
        changePct: q.value,
        quoteTime: q.time,
        quoteSource: q.source,
        quoteState: q.state,
        speedPct:
          q.state === 'READY'
            ? (speed?.speedPct ?? row?.speedPct ?? null)
            : null,
        amount: speed?.amount ?? row?.amount ?? null,
        concepts:
          concepts.get(c)?.state !== 'MISSING'
            ? (concepts.get(c)?.names ?? [])
            : [],
        reasons: [
          ...new Set([
            ...r.reasons,
            ...(pricePath && scope !== 'HISTORY'
              ? [pricePath.supportLabel]
              : []),
          ]),
        ],
        confirmedEvidence: Object.values(dimensions)
          .filter((d) => d.state === 'READY')
          .map((d) => d.fact),
        missingEvidence: Object.values(dimensions)
          .filter((d) => d.state !== 'READY')
          .map((d) => d.basis),
        dimensions,
        statusBasis: transitionTrace.at(-1)!.evidence,
        transitionTrace,
        impact: {
          sector: directional.length
            ? currentGroups
                .map(
                  (g) =>
                    `${g.concept}：${g.members.length}个${g.direction === 'down' ? '负向' : '正向'}响应成员`,
                )
                .join('；')
            : `行业线索${meta?.industry ?? row?.industry ?? '缺失'}，概念带动未确认`,
          relay: peerPairs.length
            ? `${peerPairs.length}个同身位响应`
            : following.length
              ? '自身为随后响应成员'
              : '接力先后未确认',
          group:
            directional.length >= 2
              ? '局部板块成员响应已见；整体市场扩散仍未确认'
              : '整体核心情绪影响MISSING',
        },
      };
    })
    .sort(
      (a, b) =>
        Number(a.provisional) - Number(b.provisional) ||
        Number(Boolean(sealedByCode.get(b.code))) -
          Number(Boolean(sealedByCode.get(a.code))) ||
        (b.height ?? -1) - (a.height ?? -1) ||
        (b.historicalHeight ?? 0) - (a.historicalHeight ?? 0) ||
        a.code.localeCompare(b.code),
    );
  const byCode = new Map(candidates.map((c) => [c.code, c]));
  const activeCandidates = candidates.filter(
    (candidate) =>
      candidate.scope !== 'HISTORY' && candidate.state !== '影响衰减退出',
  );
  const historicalCandidates = candidates.filter(
    (candidate) =>
      candidate.scope === 'HISTORY' || candidate.state === '影响衰减退出',
  );
  const attackerObservations = (tape?.rows ?? [])
    .filter(
      (row) =>
        !byCode.has(codeOf(row.code)) &&
        row.upEvents.some((event) => event.toPct > 0) &&
        row.changePct !== null &&
        row.changePct >= 0 &&
        (row.initiative.state === 'READY' || row.response.state === 'READY'),
    )
    .sort(
      (a, b) =>
        (a.upEvents[0]?.at ?? '99:99').localeCompare(
          b.upEvents[0]?.at ?? '99:99',
        ) || a.code.localeCompare(b.code),
    );
  const relayRows = rows.filter((r) => r.fromHeight >= 2);
  const middleReasons = new Map<string, string[]>();
  const midAdd = (c: string, why: string) =>
    middleReasons.set(c, [...(middleReasons.get(c) ?? []), why]);
  for (const family of ['主板', '20cm', '北交所']) {
    const rr = relayRows.filter((r) => boardFamily(r.code) === family);
    const levels = [...new Set(rr.map((r) => r.fromHeight))].sort(
      (a, b) => b - a,
    );
    for (const r of rr) {
      if (levels.length > 1 && r.fromHeight === levels[1])
        midAdd(r.code, `${family}次高传递层`);
      if (r.fromHeight === 3 || r.fromHeight === 4)
        midAdd(r.code, `${r.fromHeight}进${r.toHeight}主要传递层`);
      if (
        r.state !== 'SEALED' &&
        rr.some(
          (p) =>
            p.code !== r.code &&
            p.fromHeight === r.fromHeight &&
            p.state === 'SEALED',
        )
      )
        midAdd(r.code, '同身位竞争掉队（结果观察）');
    }
  }
  const beforePrior = prior?.previousDate
    ? history.find((f) => day(f.date) === day(prior.previousDate))
    : undefined;
  const beforePriorHeights = new Map(
    stocksOf(beforePrior).map((s) => [codeOf(s.code), s.height]),
  );
  if (previousExact && prior)
    for (const s of [
      ...(prior.failedStocks ?? []),
      ...(prior.limitDownStocks ?? []),
    ]) {
      const c = codeOf(s.code),
        h = beforePriorHeights.get(c) ?? s.height;
      if (h === 3 || h === 4 || (h >= 2 && oldByCode.has(c)))
        midAdd(c, `昨日断板/负反馈中位（此前${h}板）`);
    }
  for (const p of upPairs)
    if (p.concept && (rowByCode.get(p.member)?.fromHeight ?? 0) >= 2)
      midAdd(p.member, `已核验概念${p.concept}承接成员`);
  const middleRows = relayRows.filter((r) => middleReasons.has(r.code));
  const middleCodes = [...middleReasons.keys()];
  const middleQuotes = new Map(middleCodes.map((c) => [c, quoteFor(c)]));
  const middleTiers = [...new Set(middleRows.map((row) => row.fromHeight))]
    .sort((a, b) => b - a)
    .map((height) => {
      const members = middleRows.filter((row) => row.fromHeight === height);
      return {
        fromHeight: height,
        toHeight: height + 1,
        denominator: members.length,
        promoted: members.filter((row) => row.state === 'SEALED').length,
        deepKnown: members.filter((row) => {
          const q = middleQuotes.get(row.code);
          return q?.state === 'READY' && q.value! <= -5;
        }).length,
        priceCovered: members.filter(
          (row) => middleQuotes.get(row.code)?.state === 'READY',
        ).length,
        members: members.map((row) => row.code),
      };
    });
  const middleQuoteReady = middleCodes.filter(
    (c) => middleQuotes.get(c)!.state === 'READY',
  );
  const brokenMiddleCodes = middleCodes.filter(
    (c) => !middleRows.some((r) => r.code === c),
  );
  const twoKnown = middleCodes.filter(
    (c) => middleQuotes.get(c)!.state === 'READY' && priorPrice(c) !== null,
  );
  const twoNegative = twoKnown.filter(
    (c) => middleQuotes.get(c)!.value! < 0 && priorPrice(c)! < 0,
  );
  const currentMinute = tradingMinute(facts.cutoff);
  const midDown = downPairs.filter((p) => {
    const responseMinute = tradingMinute(p.time);
    const coreQuote = quoteFor(p.core),
      memberQuote = quoteFor(p.member);
    return (
      minuteCurrent &&
      middleReasons.has(p.core) &&
      currentMinute !== null &&
      responseMinute !== null &&
      currentMinute - responseMinute >= 0 &&
      currentMinute - responseMinute <= 10 &&
      coreQuote.state === 'READY' &&
      memberQuote.state === 'READY' &&
      coreQuote.value! < 0 &&
      memberQuote.value! < 0
    );
  });
  const upwardNegative = midDown.filter((p) =>
    activeCandidates.some((candidate) => candidate.code === p.member),
  );
  const lowerNegative = midDown.filter(
    (p) => rowByCode.get(p.member)?.fromHeight === 1,
  );
  const metric = (
    values: Array<boolean | null>,
    detail: string,
  ): CoreFeedbackMetric => {
    const covered = values.filter((v) => v !== null).length,
      knownCount = values.filter((v) => v === true).length;
    return {
      state:
        !values.length || !covered
          ? 'MISSING'
          : covered === values.length
            ? 'READY'
            : 'DEGRADED',
      value: covered === values.length && values.length > 0 ? knownCount : null,
      denominator: values.length || null,
      knownCount,
      covered,
      unknown: values.length - covered,
      detail: covered
        ? `${detail}；已知命中${knownCount}，证据覆盖${covered}/${values.length}`
        : `${detail}；暂无可计数证据，覆盖0/${values.length}`,
    };
  };
  const highFeedback = {
    state: activeCandidates.length
      ? activeCandidates.every((c) => c.quoteState === 'READY')
        ? ('READY' as const)
        : ('DEGRADED' as const)
      : ('MISSING' as const),
    denominator: activeCandidates.length || null,
    covered: activeCandidates.filter((c) => c.quoteState === 'READY').length,
    strong: metric(
      activeCandidates.map((c) =>
        info.get(c.code)!.sealed === true
          ? true
          : c.quoteState === 'READY'
            ? c.changePct! >= 5 && info.get(c.code)!.up.length > 0
            : null,
      ),
      '当前封板或已核验响应伴随强势报价；不把“被召回”直接算走强',
    ),
    disagreement: metric(
      activeCandidates.map((c) =>
        failedReady && failedByCode.has(c.code)
          ? true
          : c.quoteState === 'READY'
            ? c.changePct! < 0 || c.state === '爆量分歧'
            : null,
      ),
      '分歧/负向报价与确认爆量分别保留依据',
    ),
    brokenImpact: metric(
      activeCandidates.map((c) =>
        !info.get(c.code)!.broken
          ? false
          : info.get(c.code)!.up.length || info.get(c.code)!.down.length
            ? true
            : null,
      ),
      `断板跟踪${activeCandidates.filter((c) => info.get(c.code)!.broken).length}只；当期影响与仅保留身份分开`,
    ),
    deepWater: metric(
      activeCandidates.map((c) =>
        c.quoteState === 'READY' ? c.changePct! <= -5 : null,
      ),
      '仅当前可用报价统计深水',
    ),
    extreme: metric(
      activeCandidates.map((c) =>
        extremePaths.get(c.code)?.skyFloor === true
          ? true
          : downReady
            ? downByCode.has(c.code)
            : null,
      ),
      '当前精确跌停池或完整分钟涨停后跌停序列；不按统一百分比猜天地板',
    ),
    antiAttempt: metric(
      activeCandidates.map((c) =>
        info.get(c.code)!.rebound
          ? true
          : rebounds.get(c.code)?.status === 'READY'
            ? false
            : null,
      ),
      '逐股有效分钟路径的反核尝试；无路径不计零',
    ),
    repairSpread: metric(
      activeCandidates.map((c) => {
        const i = info.get(c.code)!,
          e = i.rebound;
        if (!e) return rebounds.get(c.code)?.status === 'READY' ? false : null;
        const end = tradingMinute(e.time);
        const responses = i.up.filter(
          (p) =>
            p.concept &&
            end !== null &&
            tradingMinute(p.time)! > end &&
            tradingMinute(p.time)! - end <= 10,
        );
        return responses.length >= 2 ? true : t?.leadLag ? false : null;
      }),
      '必须反核发生后其他至少两只已核验概念成员响应；反核前的响应不能算修复扩散',
    ),
    exits: metric(
      candidates.map((c) => info.get(c.code)!.exited),
      '实际执行退出数；现有三维下降代理量不足以证明退出，保留历史身份，不用暴跌或缺数据代替',
    ),
  };
  const midDeep = middleQuoteReady.filter(
    (c) => middleQuotes.get(c)!.value! <= -5,
  );
  const midSky = metric(
    middleCodes.map((c) => extremePaths.get(c)?.skyFloor ?? null),
    '完整1分钟收盘采样先涨停后跌停；没有分钟路径不从日线高低价倒推天地板',
  );
  const fullMidPrices =
    middleQuoteReady.length === middleCodes.length && middleCodes.length > 0;
  const relayQuotes = relayRows.map((r) => quoteFor(r.code));
  const completeRelay =
    relayQuotes.length > 0 && relayQuotes.every((q) => q.state === 'READY');
  const feedback = {
    state: rows.length
      ? completeRelay
        ? ('READY' as const)
        : ('DEGRADED' as const)
      : ('MISSING' as const),
    denominator: relayRows.length || null,
    attempted: relayRows.length
      ? relayRows.filter((r) => r.state === 'SEALED' || r.state === 'FAILED')
          .length
      : null,
    promoted: relayRows.length
      ? relayRows.filter((r) => r.state === 'SEALED').length
      : null,
    sealed: relayRows.length
      ? relayRows.filter((r) => r.state === 'SEALED').length
      : null,
    deepWater: completeRelay
      ? relayQuotes.filter((q) => q.value! <= -5).length
      : null,
    limitDown:
      downReady && relayRows.length
        ? relayRows.filter((r) => downByCode.has(r.code)).length
        : null,
    extreme:
      downReady && relayRows.length
        ? relayRows.filter((r) => downByCode.has(r.code)).length
        : null,
    failed: relayRows.length
      ? relayRows.filter((r) => r.state === 'FAILED').length
      : null,
    consecutiveNegative:
      completeRelay && previousExact
        ? relayRows.filter(
            (r) => quoteFor(r.code).value! < 0 && (priorPrice(r.code) ?? 0) < 0,
          ).length
        : null,
    detail: `昨日连板固定分母${relayRows.length}；报价覆盖${relayQuotes.filter((q) => q.state === 'READY').length}/${relayRows.length}；不与高标候选分母互换`,
  };
  const middle = {
    tiers: middleTiers,
    state: middleCodes.length
      ? fullMidPrices
        ? ('READY' as const)
        : ('DEGRADED' as const)
      : ('MISSING' as const),
    denominator: middleRows.length || null,
    sampleCount: middleCodes.length,
    priceCovered: middleQuoteReady.length,
    promoted: middleRows.length
      ? middleRows.filter((r) => r.state === 'SEALED').length
      : null,
    failed:
      failedReady && middleCodes.length
        ? middleCodes.filter(
            (c) => failedByCode.has(c) || rowByCode.get(c)?.state === 'FAILED',
          ).length
        : null,
    deepWater: fullMidPrices ? midDeep.length : null,
    deepWaterKnown: midDeep.length,
    limitDown:
      downReady && middleCodes.length
        ? middleCodes.filter((c) => downByCode.has(c)).length
        : null,
    twoDayNegative:
      twoKnown.length === middleCodes.length && middleCodes.length > 0
        ? twoNegative.length
        : null,
    twoDayNegativeKnown: twoNegative.length,
    twoDayCovered: twoKnown.length,
    skyFloor: midSky,
    broken: brokenMiddleCodes.map((c) => allMeta.get(c)?.name ?? c),
    rows: middleCodes.map((c) => ({
      code: c,
      name: rowByCode.get(c)?.name ?? allMeta.get(c)?.name ?? c,
      reasons: middleReasons.get(c)!,
      eligibleForPromotion: middleRows.some((r) => r.code === c),
      quote: middleQuotes.get(c)!,
      previousChangePct: priorPrice(c),
    })),
    spread: {
      state:
        upwardNegative.length || lowerNegative.length
          ? ('READY' as const)
          : t?.negativeLeadLag
            ? ('DEGRADED' as const)
            : ('MISSING' as const),
      up: upwardNegative.length || null,
      down: lowerNegative.length || null,
      detail:
        upwardNegative.length || lowerNegative.length
          ? `中位负向先动后，高标响应${upwardNegative.length}、低位响应${lowerNegative.length}；仅限已采集分钟成员，不作因果认定`
          : '负反馈可以同现，但缺少已核验负向分钟先后，不宣称向高标或低位扩散',
    },
    detail: `次高/3进4、4进5传递层/同身位掉队/昨日断板中位独立召回；中位样本${middleCodes.length}，其中${middleRows.length}具有晋级资格、${brokenMiddleCodes.length}只断板跟踪不混入晋级分母。`,
  };
  const spatialStrongKnown = activeCandidates.filter(
    (c) =>
      (c.historicalHeight ?? 0) >= 2 &&
      (info.get(c.code)!.sealed === true ||
        (c.quoteState === 'READY' &&
          c.changePct! >= 5 &&
          info.get(c.code)!.up.length > 0)),
  ).length;
  const retreatWarning =
    (middleCodes.length >= 2 &&
      midDeep.length >= Math.ceil(middleCodes.length / 2)) ||
    twoNegative.length >= 2 ||
    middleTiers.some((tier) => tier.deepKnown >= 2);
  const negativeKnown = highFeedback.deepWater.knownCount ?? 0;
  const extremeKnown = highFeedback.extreme.knownCount ?? 0;
  const leadingNames = activeCandidates
    .filter((c) => info.get(c.code)!.sealed || info.get(c.code)!.up.length)
    .slice(0, 4)
    .map(
      (c) =>
        `${c.name}${c.height ? `位于${c.height}板空间层` : `为${c.currentRole}`}，${c.pricePath?.supportLabel ?? (c.quoteState === 'READY' ? `报价${pct(c.changePct)}` : '以已标注快照观察')}`,
    )
    .join('；');
  const deepDescription = highFeedback.deepWater.covered
    ? `已知深水${negativeKnown}只`
    : '深水计数证据缺失';
  const extremeDescription = highFeedback.extreme.covered
    ? `已知跌停/极端${extremeKnown}只`
    : '跌停/极端计数证据缺失';
  const supportDivergence = activeCandidates
    .filter(
      (candidate) =>
        candidate.pricePath?.support === 'OPENED' ||
        (candidate.quoteState === 'READY' &&
          candidate.changePct !== null &&
          (candidate.changePct < 0 ||
            ((rowByCode.get(candidate.code)?.fromHeight ?? 0) >= 2 &&
              rowByCode.get(candidate.code)?.state !== 'SEALED'))),
    )
    .sort(
      (a, b) =>
        (rowByCode.get(b.code)?.fromHeight ?? 0) -
          (rowByCode.get(a.code)?.fromHeight ?? 0) ||
        (a.changePct ?? Infinity) - (b.changePct ?? Infinity),
    )
    .slice(0, 4)
    .map(
      (candidate) =>
        `${candidate.name}：${candidate.pricePath?.supportLabel ?? pct(candidate.changePct)}`,
    )
    .join('；');
  const tierFacts = middleTiers
    .filter((tier) => tier.fromHeight >= 3 || tier.deepKnown > 0)
    .map(
      (tier) =>
        `${tier.fromHeight}进${tier.toHeight}有${tier.promoted}/${tier.denominator}处于封板，已知深水${tier.deepKnown}只（报价覆盖${tier.priceCovered}/${tier.denominator}）`,
    )
    .join('；');
  const summary =
    (lastKnown ? `最近有效观察 ${targetTime}（非实时，未冒充收盘）：` : '') +
    `${leadingNames || '目前无可核查的走强核心，但已知风险仍单独报告'}。` +
    (supportDivergence ? `分歧端：${supportDivergence}。` : '') +
    (tierFacts ? `传递层：${tierFacts}。` : '') +
    `当前活跃/竞争观察${activeCandidates.length}只，${deepDescription}、${extremeDescription}，报价覆盖${highFeedback.covered}/${activeCandidates.length}；另${historicalCandidates.length}只保留历史身份，不混入该分母。` +
    (retreatWarning
      ? spatialStrongKnown > 0
        ? '空间高位仍有强势表现，但中位已出现集中负反馈；不能据此确认核心仍强或生态健康。'
        : '中位已出现集中负反馈；未确认空间高位仍强，局部题材上涨不能抵消传递层风险。'
      : negativeKnown || extremeKnown
        ? '个别高位存活也不能判生态健康；负反馈先后扩散需看独立分钟证据。'
        : '缺失价格、概念或分钟证据不计作无风险；候选不等于已确认龙头。');
  return {
    version: 'emotion-core-v5',
    observationMode: lastKnown
      ? ('LAST_KNOWN' as const)
      : facts.cutoff === '15:00'
        ? ('CLOSE' as const)
        : ('POINT_IN_TIME' as const),
    decisionMode:
      evidence?.decisionMode === 'LIVE' &&
      facts.cutoff !== '15:00' &&
      requestedDecision !== null &&
      target === requestedDecision
        ? ('LIVE' as const)
        : ('FIXED' as const),
    evidenceAligned,
    evidenceDate: evidence?.date ?? t?.date ?? null,
    observedAt: targetTime,
    source,
    candidates,
    activeCandidates,
    historicalCandidates,
    attackerObservations,
    tape,
    summary,
    retreatWarning,
    tone:
      retreatWarning || negativeKnown >= 2 || extremeKnown > 0
        ? ('negative' as const)
        : activeCandidates.length
          ? ('mixed' as const)
          : ('unknown' as const),
    coverage: {
      candidateCount: candidates.length,
      activeCount: activeCandidates.length,
      historyCount: historicalCandidates.length,
      currentStructure: sealedStocks.length,
      minuteObservedAt,
      minuteCurrent,
      minuteReady:
        minuteCurrent &&
        activeCandidates.length > 0 &&
        activeCandidates.every(
          (c) =>
            c.pricePath?.latestWindowComplete ||
            rebounds.get(c.code)?.status === 'READY',
        ),
      minuteCandidates: activeCandidates.filter(
        (c) =>
          c.pricePath?.lastTime === tape?.cutoff ||
          rebounds.get(c.code)?.status === 'READY',
      ).length,
      conceptReady: activeCandidates.filter(
        (c) => concepts.get(c.code)?.state === 'READY',
      ).length,
      conceptCandidates: activeCandidates.length,
      historyDays: history.length,
    },
    feedback,
    highFeedback,
    middleRows,
    middle,
    boundary: [
      '最高两档仅召回；历史注册表不因断板或回看窗口自动删除。',
      '各字段独立验证日期、截止时点和原始证据；无分钟不得确认主动或先后。',
      '只确认已覆盖成员的响应；行业不等于概念、单股反核不等于整体修复。',
      '高标群体、中位观察样本、可晋级中位与昨日接力各自保留分母。',
      '原始分钟观察先于核心分类；局部先动、稳定承接、回封和未见响应各自描述，NOT_OBSERVED不是MISSING。',
    ],
  };
}
