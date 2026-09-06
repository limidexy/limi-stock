import type { CloseSnapshot, CloseStock } from './close-history';
import type { PriceTrend } from './timeline-evidence';

export type TrackingQuote = {
  changePct: number;
  quoteTime: string;
  source: string;
};
export type TrackingDay = {
  date: string;
  previousDate?: string;
  quotes: Record<string, TrackingQuote>;
  trends: Record<string, PriceTrend>;
  source: string;
  asOf?: string;
  sessionState?: 'LIVE' | 'CLOSED';
  concepts?: Record<string, string[]>;
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
  const prior = history
    .filter((x) => x.date < date)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-lookback);
  const leaders = new Map<
    string,
    CloseStock & { peakDate: string; peakHeight: number }
  >();
  for (const day of prior.filter(complete)) {
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
      source: source?.source ?? day.source,
      quotes: { ...poolQuotes, ...source?.quotes },
      trends: source?.trends ?? {},
    };
  }
  const current = ordered.find((x) => x.date === date);
  const candidates = trackingCandidates(ordered, date, lookback);
  const currentEvidence = evidence[date];
  const prev = candidates.previous;
  const adjacent = Boolean(
    prev && priorSession(date, prev.date, currentEvidence) && complete(prev),
  );
  const hasCurrent = complete(current);
  const dates = [...candidates.prior.map((x) => x.date), date];
  const missingSessions = dates
    .slice(1)
    .filter((d, i) => !priorSession(d, dates[i], evidence[d]));
  const quote = (d: string, code: string) =>
    exactQuote(evidence[d], d, code, d === date ? cutoff : '15:00');
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
      changePct: quote(date, stock.code)?.changePct ?? null,
      path: days.map((day) => ({
        date: day.date,
        changePct: quote(day.date, stock.code)?.changePct ?? null,
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
          const q = quote(date, stock.code);
          const sealed =
            hasCurrent && stocksOf(current).some((x) => x.code === stock.code);
          return {
            ...stock,
            yesterdayChangePct: stock.changePct,
            changePct: q?.changePct ?? null,
            quoteTime: q?.quoteTime ?? null,
            label: !q
              ? '当日报价缺失'
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
  ]);
  const rebounds = watched.map((stock) => ({
    code: stock.code,
    name: stock.name,
    ...reboundObservation(currentEvidence?.trends[stock.code], cutoff),
  }));
  const groups = adjacent
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
    source: currentEvidence?.source ?? '该日跟踪证据未归档',
    status:
      hasCurrent &&
      adjacent &&
      currentEvidence &&
      !missingSessions.length &&
      allOldQuotes.every((x) => x.changePct !== null) &&
      failed.every((x) => x.changePct !== null) &&
      rebounds.every((x) => x.status === 'READY') &&
      groups.every((x) => x.status === 'READY')
        ? ('READY' as const)
        : ('DEGRADED' as const),
    previousDate: prev?.date ?? null,
    missingSessions,
    oldLeaders: {
      rows: old,
      ...coverage(
        allOldQuotes.length,
        allOldQuotes.filter((x) => x.changePct !== null).length,
        missingSessions.length
          ? '区间存在缺日；断板日仅在相邻完整收盘间确认'
          : '按此前最高板≥3板入池，断板后保留；窗口外个股不在本次样本',
      ),
    },
    failedRepair: {
      rows: failed,
      ...coverage(
        adjacent ? failed.length : 0,
        failed.filter((x) => x.changePct !== null).length,
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
        rebounds.filter((x) => x.status === 'READY').length,
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
    boundary:
      '收盘回看只复现已保存的分钟价格，候选身份仅使用观察日前数据。没有成交逐笔/订单流证据，不推断资金意图，不输出买卖指令。',
  };
}
export type EmotionTracking = ReturnType<typeof buildEmotionTracking>;
