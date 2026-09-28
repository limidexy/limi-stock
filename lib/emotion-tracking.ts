import type { CloseSnapshot, CloseStock } from './close-history';
import type { PriceTrend } from './timeline-evidence';
import { extremePathObservation } from './core-minute-evidence.ts';

export type TrackingQuote = {
  changePct: number;
  quoteTime: string;
  source: string;
};
export type TrackingDay = {
  date: string;
  previousDate?: string;
  cutoff?: string;
  quotes: Record<string, TrackingQuote>;
  trends: Record<string, PriceTrend>;
  source: string;
  sourceState?: 'LIVE' | 'ARCHIVED' | 'STALE';
  availableAt?: string;
  capturedAt?: string;
  asOf?: string;
  sessionState?: 'LIVE' | 'CLOSED';
  concepts?: Record<string, string[]>;
  conceptsAvailableAt?: string;
  conceptsState?: 'READY' | 'DEGRADED' | 'MISSING' | 'RECOVERED_LATE';
  conceptStates?: Record<
    string,
    'READY' | 'DEGRADED' | 'MISSING' | 'RECOVERED_LATE'
  >;
  styleCandidates?: CloseStock[];
  styleMembers?: CloseStock[];
  noTrade?: Record<string, string>;
};
export type TrackingHistory = Record<string, TrackingDay>;
export const stocksOf = (day?: CloseSnapshot) =>
  day?.ladders.flatMap((x) => x.stocks) ?? [];
const unique = <T extends { code: string }>(rows: T[]) => [
  ...new Map(rows.map((x) => [x.code, x])).values(),
];
const finite = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n);
export function nextWeekday(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return '';
  do d.setUTCDate(d.getUTCDate() + 1);
  while ([0, 6].includes(d.getUTCDay()));
  return d.toISOString().slice(0, 10);
}
export function priorSession(
  current: string,
  previous: string,
  evidence?: TrackingDay,
) {
  return (
    previous < current &&
    (evidence?.previousDate
      ? evidence.previousDate === previous
      : nextWeekday(previous) === current)
  );
}
export function exactQuote(
  evidence: TrackingDay | undefined,
  date: string,
  code: string,
  cutoff = '15:00',
) {
  const quote = evidence?.date === date ? evidence.quotes[code] : undefined;
  const stamp = Date.parse(quote?.quoteTime ?? '');
  const isLive = evidence?.sessionState === 'LIVE';
  const target = Date.parse(
    isLive && evidence?.asOf ? evidence.asOf : `${date}T${cutoff}:00+08:00`,
  );
  const quotedDate = Number.isFinite(stamp)
    ? new Date(stamp + 8 * 3600000).toISOString().slice(0, 10)
    : '';
  return quote &&
    quotedDate === date &&
    finite(quote.changePct) &&
    stamp <= target &&
    (!isLive && cutoff === '15:00'
      ? stamp === target
      : target - stamp <= 60_000)
    ? quote
    : null;
}
function complete(day?: CloseSnapshot) {
  return Boolean(
    day &&
    day.status === 'READY' &&
    day.cutoff === '15:00' &&
    unique(stocksOf(day)).length === day.limitUp &&
    unique(day.failedStocks).length === day.failed &&
    unique(day.limitDownStocks).length === day.limitDown,
  );
}
export function trackingCandidates(
  history: CloseSnapshot[],
  date: string,
  lookback = 10,
) {
  const allPrior = history
    .filter((x) => x.date < date)
    .sort((a, b) => a.date.localeCompare(b.date));
  const prior = allPrior.slice(-lookback);
  const leaders = new Map<
    string,
    CloseStock & { peakDate: string; peakHeight: number }
  >();
  // lookback controls the amount of path/feedback displayed, not identity
  // retention. A former high board must remain recallable after it leaves the
  // recent window; exit is an evidence-backed state, never a slice operation.
  for (const day of allPrior.filter(complete)) {
    // Membership is fixed from a PREVIOUS close, never today's winners.
    for (const stock of stocksOf(day).filter(
      (x) => x.height === day.highestBoard && x.height >= 3,
    )) {
      const previous = leaders.get(stock.code);
      if (!previous || stock.height >= previous.peakHeight)
        leaders.set(stock.code, {
          ...stock,
          peakDate: day.date,
          peakHeight: stock.height,
        });
    }
  }
  const previous = prior.at(-1);
  return {
    prior,
    previous,
    displayLeaders: [...leaders.values()].filter((leader) =>
      prior.some(
        (day) =>
          complete(day) &&
          stocksOf(day).some(
            (stock) =>
              stock.code === leader.code &&
              stock.height === day.highestBoard &&
              stock.height >= 3,
          ),
      ),
    ),
    leaders: [...leaders.values()],
    failed: unique(previous?.failedStocks ?? []),
  };
}
const minuteIndex = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  const n = h * 60 + m;
  if (
    !/^\d{2}:\d{2}$/.test(time) ||
    !((n >= 570 && n <= 690) || (n >= 780 && n <= 900))
  )
    return null;
  return n >= 780 ? n - 90 : n;
};
export function cleanPath(trend: PriceTrend | undefined, cutoff: string) {
  if (!trend || trend.stale || !finite(trend.preClose) || trend.preClose <= 0)
    return [];
  const seen = new Set<string>();
  // Duplicated minute timestamps are ambiguous, not averaged or forward-filled.
  if (trend.points.some((x) => seen.has(x.time) || !seen.add(x.time)))
    return [];
  return trend.points
    .filter(
      (x) =>
        x.time <= cutoff &&
        minuteIndex(x.time) !== null &&
        finite(x.price) &&
        x.price > 0,
    )
    .sort((a, b) => a.time.localeCompare(b.time))
    .map((x) => ({
      ...x,
      pct: (x.price / trend.preClose! - 1) * 100,
      minute: minuteIndex(x.time)!,
    }));
}
function consecutivePath(points: ReturnType<typeof cleanPath>) {
  return points.every((p, i) => !i || p.minute - points[i - 1].minute === 1);
}
export function reboundObservation(
  trend: PriceTrend | undefined,
  cutoff: string,
) {
  const points = cleanPath(trend, cutoff);
  if (points.length < 5)
    return {
      status: 'MISSING' as const,
      label: '分钟路径不足',
      points: points.length,
      event: null,
    };
  if ((trend?.intervalMinutes ?? 1) > 1) {
    let low = points[0];
    let recovered = null as (typeof points)[number] | null;
    for (const point of points.slice(1)) {
      if (point.pct < low.pct) {
        low = point;
        recovered = null;
      } else if (!recovered && low.pct <= -5 && point.pct - low.pct >= 4)
        recovered = point;
    }
    const last = points.at(-1)!;
    return {
      status: 'DEGRADED' as const,
      label: recovered
        ? '5分钟见深跌拉回 · 待1分钟确认'
        : low.pct <= -5
          ? '5分钟见深跌 · 未确认拉回'
          : '5分钟回放 · 未见深跌拉回',
      event: recovered
        ? {
            lowTime: low.time,
            lowPct: low.pct,
            time: recovered.time,
            changePct: recovered.pct,
            recoveryPp: recovered.pct - low.pct,
          }
        : null,
      lowTime: low.time,
      lowPct: low.pct,
      lastTime: last.time,
      lastPct: last.pct,
      points: points.length,
      reason:
        '这是精确日期的5分钟行情，不是日线倒推；可看启动、下杀和修复方向，但不用于3分钟反核或核心带动先后确认',
    };
  }
  let low = points[0];
  let gapRecovery = false;
  let event: {
    lowTime: string;
    lowPct: number;
    time: string;
    changePct: number;
    recoveryPp: number;
  } | null = null;
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (p.pct < low.pct) low = p;
    // Descriptive price-pattern rule, not order-flow/intent or a buy signal.
    if (
      !event &&
      low.pct <= -5 &&
      p.pct - low.pct >= 4 &&
      p.minute > low.minute
    ) {
      const hold = points.slice(i, i + 3);
      const continuous = consecutivePath(
        points.slice(points.indexOf(low), i + 3),
      );
      if (!continuous) gapRecovery = true;
      if (
        continuous &&
        hold.length === 3 &&
        consecutivePath(hold) &&
        hold.every((x) => x.pct - low.pct >= 3)
      )
        event = {
          lowTime: low.time,
          lowPct: low.pct,
          time: hold[2].time,
          changePct: hold[2].pct,
          recoveryPp: hold[2].pct - low.pct,
        };
    }
  }
  const last = points.at(-1)!;
  const endMinute = minuteIndex(cutoff);
  const regularComplete = points.every(
    (p, i) =>
      !i ||
      p.minute - points[i - 1].minute === 1 ||
      (p.time === '15:00' && points[i - 1].time === '14:57'),
  );
  const full =
    points[0].time <= '09:31' &&
    regularComplete &&
    endMinute !== null &&
    (cutoff === '15:00' ? last.time === '15:00' : endMinute - last.minute <= 1);
  const maintained = event ? last.pct - event.lowPct >= 3 : false;
  return {
    status: full ? ('READY' as const) : ('DEGRADED' as const),
    label: event
      ? maintained
        ? '深跌拉回 · 反核候选'
        : '拉回后再回落'
      : gapRecovery
        ? '两端回升 · 中间路径缺失'
        : low.pct <= -5
          ? '深跌后修复不足'
          : '未见深跌拉回',
    event,
    lowTime: low.time,
    lowPct: low.pct,
    lastTime: last.time,
    lastPct: last.pct,
    points: points.length,
    reason: full
      ? null
      : '分钟路径未覆盖整个观察窗口；不能排除缺口内发生过修复',
  };
}
function acceleration(trend: PriceTrend | undefined, cutoff: string) {
  const p = cleanPath(trend, cutoff);
  for (let i = 3; i < p.length; i++) {
    const w = p.slice(i - 3, i + 1);
    if (consecutivePath(w) && p[i].pct - p[i - 3].pct >= 1)
      return {
        time: p[i].time,
        minute: p[i].minute,
        pct: p[i].pct,
        gain: p[i].pct - p[i - 3].pct,
      };
  }
  return null;
}

function negativeAcceleration(
  trend: PriceTrend | undefined,
  cutoff: string,
  afterMinute = -Infinity,
) {
  const points = cleanPath(trend, cutoff);
  for (let i = 3; i < points.length; i++) {
    const window = points.slice(i - 3, i + 1);
    if (
      consecutivePath(window) &&
      window[0].minute > afterMinute &&
      window[3].pct - window[0].pct <= -1
    )
      return {
        time: window[3].time,
        minute: window[3].minute,
        pct: window[3].pct,
        gain: window[3].pct - window[0].pct,
      };
  }
  return null;
}

function completeMinutePath(trend: PriceTrend | undefined, cutoff: string) {
  const points = cleanPath(trend, cutoff);
  const end = minuteIndex(cutoff);
  const regular = points.every(
    (point, index) =>
      !index ||
      point.minute - points[index - 1].minute === 1 ||
      (point.time === '15:00' && points[index - 1].time === '14:57'),
  );
  return Boolean(
    points.length >= 5 &&
    points[0].time <= '09:31' &&
    end !== null &&
    points.at(-1)?.time === cutoff &&
    regular,
  );
}

type LeadLagGroup = ReturnType<typeof leadLagObservation>;

function negativeLeadLagObservation(
  group: LeadLagGroup,
  evidence: TrackingDay | undefined,
  cutoff: string,
) {
  const corePathReady = completeMinutePath(
    evidence?.trends[group.core.code],
    cutoff,
  );
  const onset = corePathReady
    ? negativeAcceleration(
        evidence?.trends[group.core.code],
        cutoff,
        (minuteIndex(cutoff) ?? Infinity) - 13,
      )
    : null;
  const rows = group.rows.map((member) => {
    const pathReady = completeMinutePath(evidence?.trends[member.code], cutoff);
    const response =
      onset && pathReady
        ? negativeAcceleration(
            evidence?.trends[member.code],
            cutoff,
            onset.minute,
          )
        : null;
    const lag = response && onset ? response.minute - onset.minute : null;
    return {
      code: member.code,
      name: member.name,
      time: response?.time ?? null,
      changePct: response?.pct ?? null,
      lag: lag !== null && lag >= 1 && lag <= 10 ? lag : null,
      role: !corePathReady
        ? '核心分钟路径不全'
        : !onset
          ? '核心未触发负向起点'
          : !pathReady
            ? '成员分钟路径不全'
            : lag !== null && lag >= 1 && lag <= 10
              ? '随后负向响应'
              : lag !== null && lag <= 0
                ? '早于或同分钟'
                : '窗口外或未触发',
      pathState: pathReady ? ('READY' as const) : ('MISSING' as const),
    };
  });
  const following = rows.filter((row) => row.role === '随后负向响应');
  return {
    core: group.core,
    industry: group.industry,
    onset,
    direction: 'down' as const,
    status:
      corePathReady && onset && rows.every((row) => row.pathState === 'READY')
        ? ('READY' as const)
        : ('MISSING' as const),
    rows,
    requested: rows.length + 1,
    available:
      (corePathReady ? 1 : 0) +
      rows.filter((row) => row.pathState === 'READY').length,
    following: following.length,
    label: !corePathReady
      ? '核心分钟路径缺失，不能确认向下先后'
      : !onset
        ? '未发现连续3分钟负向起点'
        : following.length
          ? '观察到随后负向响应 · 非因果认定'
          : '未确认向下扩散',
  };
}
export function leadLagObservation(
  core: CloseStock,
  members: CloseStock[],
  evidence: TrackingDay | undefined,
  cutoff: string,
) {
  const onset = acceleration(evidence?.trends[core.code], cutoff);
  const corePath = reboundObservation(evidence?.trends[core.code], cutoff);
  const rows = unique(members)
    .filter((x) => x.code !== core.code)
    .map((stock) => {
      const move = acceleration(evidence?.trends[stock.code], cutoff);
      const path = reboundObservation(evidence?.trends[stock.code], cutoff);
      const coreReady = corePath.status === 'READY';
      const lag =
        move && onset && coreReady && path.status === 'READY'
          ? move.minute - onset.minute
          : null;
      return {
        code: stock.code,
        name: stock.name,
        time: move?.time ?? null,
        changePct: move?.pct ?? null,
        lag,
        role: !coreReady
          ? '核心路径不全'
          : path.status !== 'READY'
            ? '路径不全'
            : !onset
              ? '核心未触发'
              : !move
                ? '未触发拉升'
                : lag === 0
                  ? '同分钟'
                  : lag! < 0
                    ? '早于核心'
                    : lag! <= 10
                      ? '随后响应'
                      : '窗口外',
        pathState: path.status,
      };
    });
  return {
    core: { code: core.code, name: core.name, height: core.height },
    industry: core.industry,
    onset,
    status:
      corePath.status === 'READY' && rows.every((x) => x.pathState === 'READY')
        ? ('READY' as const)
        : ('DEGRADED' as const),
    rows,
    requested: rows.length + 1,
    available:
      rows.filter((x) => x.pathState === 'READY').length +
      (corePath.status === 'READY' ? 1 : 0),
    following: rows.filter((x) => x.role === '随后响应').length,
    label:
      corePath.status !== 'READY'
        ? '核心路径不全，不能确认先后'
        : !onset
          ? '核心未形成可核验拉升'
          : rows.some((x) => x.role === '随后响应')
            ? '观察到随后响应 · 非因果认定'
            : '未确认跟随扩散',
  };
}

export function buildEmotionTracking(
  history: CloseSnapshot[],
  evidence: TrackingHistory,
  date: string,
  lookback = 10,
  cutoff = '15:00',
) {
  const ordered = history
    .filter((x) => x.date <= date)
    .sort((a, b) => a.date.localeCompare(b.date));
  evidence = { ...evidence };
  for (const day of ordered) {
    if (!complete(day) || evidence[day.date]?.sessionState === 'LIVE') continue;
    const source = evidence[day.date];
    const poolQuotes = Object.fromEntries(
      unique([...stocksOf(day), ...day.failedStocks, ...day.limitDownStocks])
        .filter((x) => finite(x.changePct))
        .map((x) => [
          x.code,
          {
            changePct: x.changePct!,
            quoteTime: `${day.date}T15:00:00+08:00`,
            source: day.source + ' · 当日收盘三池',
          },
        ]),
    );
    evidence[day.date] = {
      ...source,
      date: day.date,
      cutoff: '15:00',
      sourceState: source?.sourceState ?? 'ARCHIVED',
      availableAt: source?.availableAt ?? `${day.date}T15:00:00+08:00`,
      capturedAt: source?.capturedAt,
      source: source?.source ?? day.source,
      quotes: { ...poolQuotes, ...source?.quotes },
      trends: source?.trends ?? {},
    };
  }
  const current = ordered.find((x) => x.date === date);
  const candidates = trackingCandidates(ordered, date, lookback);
  const currentEvidence = evidence[date];
  const prev = candidates.previous;
  const hasCurrent = complete(current);
  const adjacent = Boolean(
    currentEvidence &&
    prev &&
    priorSession(date, prev.date, currentEvidence) &&
    complete(prev),
  );
  const dates = [...candidates.prior.map((x) => x.date), date];
  const missingSessions = dates
    .slice(1)
    .filter((d, i) => !priorSession(d, dates[i], evidence[d]));
  const quote = (d: string, code: string) =>
    exactQuote(evidence[d], d, code, d === date ? cutoff : '15:00');
  const quoteState = (d: string, code: string) =>
    evidence[d]?.noTrade?.[code]
      ? ('NO_TRADE' as const)
      : quote(d, code)
        ? ('READY' as const)
        : ('MISSING' as const);
  const allOld = candidates.leaders.map((stock) => {
    const days = ordered.filter((x) => x.date >= stock.peakDate);
    let broken: string | null = null;
    for (let i = 1; i < days.length; i++) {
      if (
        days[i].date === date &&
        (cutoff !== '15:00' || currentEvidence?.sessionState === 'LIVE')
      )
        continue;
      if (
        complete(days[i]) &&
        priorSession(days[i].date, days[i - 1].date, evidence[days[i].date]) &&
        stocksOf(days[i - 1]).some((x) => x.code === stock.code) &&
        !stocksOf(days[i]).some((x) => x.code === stock.code)
      ) {
        broken = days[i].date;
        break;
      }
    }
    return {
      ...stock,
      brokenDate: broken,
      changePct:
        quoteState(date, stock.code) === 'READY'
          ? (quote(date, stock.code)?.changePct ?? null)
          : null,
      quoteState: quoteState(date, stock.code),
      quoteTime: quote(date, stock.code)?.quoteTime ?? null,
      quoteNote: evidence[date]?.noTrade?.[stock.code] ?? null,
      path: days.map((day) => ({
        date: day.date,
        changePct:
          quoteState(day.date, stock.code) === 'READY'
            ? (quote(day.date, stock.code)?.changePct ?? null)
            : null,
        quoteState: quoteState(day.date, stock.code),
        quoteNote: evidence[day.date]?.noTrade?.[stock.code] ?? null,
        height:
          stocksOf(day).find((x) => x.code === stock.code)?.height ?? null,
        quoteTime: quote(day.date, stock.code)?.quoteTime ?? null,
      })),
    };
  });
  const old = allOld
    .filter((x) => x.brokenDate)
    .sort(
      (a, b) =>
        b.peakHeight - a.peakHeight ||
        (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity),
    );
  const failed = adjacent
    ? candidates.failed
        .map((stock) => {
          const state = quoteState(date, stock.code);
          const q = state === 'READY' ? quote(date, stock.code) : null;
          const sealed =
            hasCurrent && stocksOf(current).some((x) => x.code === stock.code);
          return {
            ...stock,
            yesterdayChangePct: stock.changePct,
            changePct: q?.changePct ?? null,
            quoteTime: q?.quoteTime ?? null,
            quoteState: state,
            label: !q
              ? (currentEvidence?.noTrade?.[stock.code] ?? '当日报价缺失')
              : !hasCurrent
                ? '当日报价可用，封板状态缺失'
                : sealed
                  ? '重新涨停'
                  : q.changePct > 0
                    ? '上涨修复（未封板）'
                    : q.changePct < 0
                      ? '继续下跌'
                      : '平盘',
          };
        })
        .sort((a, b) => (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity))
    : [];
  const watched = unique([
    ...allOld,
    ...(adjacent ? candidates.failed : []),
    ...(adjacent ? stocksOf(prev).filter((x) => x.height >= 2) : []),
    ...(currentEvidence?.styleCandidates ?? []),
    ...(currentEvidence?.styleMembers ?? []),
  ]);
  const rebounds = watched.map((stock) =>
    currentEvidence?.noTrade?.[stock.code]
      ? {
          code: stock.code,
          name: stock.name,
          status: 'NO_TRADE' as const,
          label: currentEvidence.noTrade[stock.code],
          points: 0,
          event: null,
        }
      : {
          code: stock.code,
          name: stock.name,
          ...reboundObservation(currentEvidence?.trends[stock.code], cutoff),
        },
  );
  const standardGroups = adjacent
    ? [...new Set(stocksOf(prev).map((x) => x.industry))]
        .filter((x) => x && !['UNKNOWN', '未分类'].includes(x))
        .map((industry) => {
          const members = unique(
            [...stocksOf(prev), ...prev!.failedStocks].filter(
              (x) => x.industry === industry,
            ),
          );
          const highest = Math.max(
            ...stocksOf(prev)
              .filter((x) => x.industry === industry)
              .map((x) => x.height),
          );
          const cores = stocksOf(prev).filter(
            (x) =>
              x.industry === industry && x.height === highest && x.height >= 2,
          );
          return cores.map((core) =>
            leadLagObservation(core, members, currentEvidence, cutoff),
          );
        })
        .flat()
        .filter((x) => x.rows.length > 0)
    : [];
  const styleGroups = (currentEvidence?.styleCandidates ?? []).flatMap(
    (core) => {
      const ownConcepts = currentEvidence?.concepts?.[core.code] ?? [];
      const members = unique([
        ...(currentEvidence?.styleMembers ?? []),
        ...stocksOf(prev),
        ...(prev?.failedStocks ?? []),
      ]).filter(
        (member) =>
          member.code !== core.code &&
          (currentEvidence?.concepts?.[member.code] ?? []).some((name) =>
            ownConcepts.includes(name),
          ),
      );
      return members.length
        ? [leadLagObservation(core, members, currentEvidence, cutoff)]
        : [];
    },
  );
  const groups = [
    ...new Map(
      [...standardGroups, ...styleGroups].map((group) => [
        group.core.code,
        group,
      ]),
    ).values(),
  ];
  // A middle transmitter need not be the highest stock in its industry.
  const middleNegativeGroups = adjacent
    ? stocksOf(prev)
        .filter((stock) => stock.height === 3 || stock.height === 4)
        .map((core) =>
          leadLagObservation(
            core,
            unique([...stocksOf(prev), ...(prev?.failedStocks ?? [])]).filter(
              (member) => member.industry === core.industry,
            ),
            currentEvidence,
            cutoff,
          ),
        )
    : [];
  const negativeGroups = [
    ...new Map(
      [...groups, ...middleNegativeGroups].map((group) => [
        group.core.code,
        group,
      ]),
    ).values(),
  ].map((group) => negativeLeadLagObservation(group, currentEvidence, cutoff));
  const extremePaths = watched.map((stock) =>
    extremePathObservation(
      date,
      stock,
      currentEvidence?.trends[stock.code],
      cutoff,
    ),
  );
  const allOldQuotes = old.flatMap((x) => x.path);
  const coverage = (requested: number, available: number, reason: string) => ({
    requested,
    available,
    status:
      requested === 0
        ? ('MISSING' as const)
        : available === requested
          ? ('READY' as const)
          : ('DEGRADED' as const),
    reason,
  });
  return {
    version: 1,
    date,
    cutoff,
    lookback,
    extremePaths: { rows: extremePaths },
    source: currentEvidence?.source ?? '该日跟踪证据未归档',
    sourceState: currentEvidence?.sourceState ?? 'ARCHIVED',
    availableAt:
      currentEvidence?.availableAt ??
      currentEvidence?.asOf ??
      (currentEvidence ? `${date}T${cutoff}:00+08:00` : undefined),
    concepts: currentEvidence?.concepts,
    conceptStates: currentEvidence?.conceptStates,
    conceptsAvailableAt:
      currentEvidence?.conceptsAvailableAt ?? currentEvidence?.capturedAt,
    conceptsState:
      currentEvidence?.conceptsState ??
      (currentEvidence?.concepts
        ? currentEvidence.capturedAt &&
          Date.parse(currentEvidence.capturedAt) >
            Date.parse(`${date}T15:00:00+08:00`)
          ? 'RECOVERED_LATE'
          : 'READY'
        : 'MISSING'),
    status:
      hasCurrent &&
      adjacent &&
      currentEvidence &&
      !missingSessions.length &&
      allOldQuotes.every((x) => x.quoteState !== 'MISSING') &&
      failed.every((x) => x.quoteState !== 'MISSING') &&
      rebounds.every((x) => ['READY', 'NO_TRADE'].includes(x.status)) &&
      groups.every((x) => x.status === 'READY')
        ? ('READY' as const)
        : ('DEGRADED' as const),
    previousDate: prev?.date ?? null,
    missingSessions,
    oldLeaders: {
      rows: old,
      ...coverage(
        allOldQuotes.length,
        allOldQuotes.filter((x) => x.quoteState !== 'MISSING').length,
        missingSessions.length
          ? '区间存在缺日；断板日仅在相邻完整收盘间确认'
          : '历史空间身份持续保留；回看窗口只控制路径长度，不删除旧身份',
      ),
    },
    failedRepair: {
      rows: failed,
      ...coverage(
        adjacent ? failed.length : 0,
        failed.filter((x) => x.quoteState !== 'MISSING').length,
        adjacent
          ? '昨日收盘炸板名单固定，今日完整报价才计算比例'
          : '缺少紧邻前一交易日完整炸板名单',
      ),
      positive: failed.filter((x) => x.changePct !== null && x.changePct > 0)
        .length,
      negative: failed.filter((x) => x.changePct !== null && x.changePct < 0)
        .length,
      resealed: failed.filter((x) => x.label === '重新涨停').length,
    },
    rebounds: {
      rows: rebounds,
      ...coverage(
        watched.length,
        rebounds.filter((x) => ['READY', 'NO_TRADE'].includes(x.status)).length,
        '仅监测老高标、昨日连板及炸板股；分钟收盘跌至-5%以下、拉回≥4个百分点并连续3分钟守住≥3个百分点。不是资金主动性确认',
      ),
    },
    leadLag: {
      rows: groups,
      ...coverage(
        groups.reduce((s, x) => s + x.requested, 0),
        groups.reduce((s, x) => s + x.available, 0),
        '核心=昨日同细分行业最高连板股，并列分别跟踪；成员=昨日涨停/炸板股。3分钟涨幅增量≥1个百分点，随后1—10个交易分钟响应；非全板块、非因果认定',
      ),
    },
    negativeLeadLag: {
      rows: negativeGroups,
      ...coverage(
        negativeGroups.reduce((sum, group) => sum + group.requested, 0),
        negativeGroups.reduce((sum, group) => sum + group.available, 0),
        '仅使用同日连续分钟路径：核心先出现连续3分钟跌幅≥1个百分点，成员在1—10个交易分钟内负向响应；没有分钟路径不从日线推导',
      ),
    },
    boundary:
      '收盘回看只复现已保存的分钟价格，候选身份仅使用观察日前数据。没有成交逐笔/订单流证据，不推断资金意图，不输出买卖指令。',
  };
}
export type EmotionTracking = ReturnType<typeof buildEmotionTracking>;
