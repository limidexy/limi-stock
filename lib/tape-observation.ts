import { priceLimitState } from './timeline-evidence.ts';
import type { PriceTrend } from './timeline-evidence';

export type ObservationState = 'READY' | 'DEGRADED' | 'MISSING';
export type ObservationResult = 'OBSERVED' | 'NOT_OBSERVED' | 'UNRESOLVED';
export type WindowObservation = {
  state: ObservationState;
  result: ObservationResult;
  label: string;
  facts: string[];
  comparedCodes: string[];
};
export type TapeEvent = {
  direction: 'up' | 'down';
  from: string;
  at: string;
  fromPct: number;
  toPct: number;
  changePp: number;
};
export type TapeStock = {
  code: string;
  name: string;
  industry: string;
  previousHeight: number;
  source: string;
  firstTime: string | null;
  lastTime: string | null;
  firstPct: number | null;
  changePct: number | null;
  quoteTime: string | null;
  samples: number;
  fullSession: boolean;
  latestWindowComplete: boolean;
  gaps: Array<{ from: string; to: string }>;
  limitState: 'LIMIT_UP' | 'LIMIT_DOWN' | 'NORMAL' | 'UNKNOWN';
  firstLimitTime: string | null;
  openedAt: string | null;
  openingGap?: boolean;
  resealedAt: string | null;
  stableSince: string | null;
  support:
    | 'STABLE_SEAL'
    | 'RESEALED'
    | 'OPENED'
    | 'WEAKENING'
    | 'NO_SEAL_SIGNAL'
    | 'UNRESOLVED';
  supportLabel: string;
  upEvents: TapeEvent[];
  downEvents: TapeEvent[];
  initiative: WindowObservation;
  response: WindowObservation;
  resilience: WindowObservation;
  peerRelations: Array<{
    code: string;
    name: string;
    relation: string;
    fact: string;
  }>;
  observedRelations: {
    earlierCodes: string[];
    subsequentCodes: string[];
    preexistingStrongCodes: string[];
  };
};
export type TapeSnapshot = {
  date: string;
  cutoff: string;
  source: string;
  observedAt: string;
  sourceAvailableAt: string | null;
  scope: string;
  requested: number;
  available: number;
  method: string;
  rows: TapeStock[];
};
type Metadata = {
  code: string;
  name: string;
  industry?: string;
  height?: number;
};
const finite = (x: unknown): x is number =>
  typeof x === 'number' && Number.isFinite(x);
const pct = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(2)}%`;
const unresolved = (label: string): WindowObservation => ({
  state: 'MISSING',
  result: 'UNRESOLVED',
  label,
  facts: [],
  comparedCodes: [],
});
function minute(time: string): number | null {
  if (!/^\d{2}:\d{2}$/.test(time)) return null;
  const [h, m] = time.split(':').map(Number),
    n = h * 60 + m;
  if (n >= 570 && n <= 690) return n;
  if (n >= 781 && n <= 900) return n - 90;
  return null;
}
const contiguous = (p: Array<{ time: string }>) =>
  p.length > 0 &&
  p.every(
    (x, i) =>
      !i || (minute(x.time) ?? -999) - (minute(p[i - 1].time) ?? 999) === 1,
  );

/** Raw observed prices are summarised before any stock is assigned a core role.
 * No final-day ladders, concepts, selection scores or leader labels are inputs.
 * A complete LOCAL event stays usable when an unrelated earlier minute is absent.
 */
export function buildTapeObservation(args: {
  date: string;
  cutoff: string;
  trends: Record<string, PriceTrend>;
  previous: Metadata[];
  metadata?: Metadata[];
  source: string;
  availableAt?: string;
}): TapeSnapshot {
  const { date, cutoff, trends, previous, source } = args;
  const previousByCode = new Map(previous.map((x) => [x.code, x]));
  const meta = new Map(
    [...(args.metadata ?? []), ...previous].map((x) => [x.code, x]),
  );
  const rawByCode = new Map<
    string,
    Array<{ time: string; price: number; changePct: number }>
  >();
  const rows: TapeStock[] = Object.entries(trends).map(([code, t]) => {
    const counts = new Map<string, number>();
    for (const p of t.points)
      if (p.time <= cutoff) counts.set(p.time, (counts.get(p.time) ?? 0) + 1);
    const points =
      !t.stale && finite(t.preClose) && t.preClose > 0
        ? t.points
            .filter(
              (p) =>
                p.time <= cutoff &&
                minute(p.time) !== null &&
                counts.get(p.time) === 1 &&
                finite(p.price) &&
                p.price > 0,
            )
            .sort((a, b) => a.time.localeCompare(b.time))
            .map((p) => ({
              ...p,
              changePct: (p.price / t.preClose! - 1) * 100,
            }))
        : [];
    rawByCode.set(code, points);
    const first = points[0],
      last = points.at(-1);
    const oneMinute = (t.intervalMinutes ?? 1) === 1;
    const gaps = points.flatMap((p, i) =>
      i && (minute(p.time) ?? -999) - (minute(points[i - 1].time) ?? 999) !== 1
        ? [{ from: points[i - 1].time, to: p.time }]
        : [],
    );
    const fullSession = Boolean(
      oneMinute &&
      first &&
      first.time <= '09:31' &&
      last?.time === cutoff &&
      (!gaps.length ||
        gaps.every((g) => g.from === '14:57' && g.to === '15:00')),
    );
    const latest = points.slice(-4);
    const latestWindowComplete = Boolean(
      oneMinute &&
      latest.length === 4 &&
      last?.time === cutoff &&
      contiguous(latest),
    );
    const events: TapeEvent[] = [];
    if (oneMinute)
      for (let i = 3; i < points.length; i++) {
        const w = points.slice(i - 3, i + 1);
        if (!contiguous(w)) continue;
        const change = w[3].changePct - w[0].changePct;
        const increments = w
          .slice(1)
          .map((p, k) => p.changePct - w[k].changePct);
        // A descriptive 3-trading-minute window, NOT a hard core-admission rule.
        const up = change >= 1 && increments.filter((n) => n > 0).length >= 2;
        const down =
          change <= -1 && increments.filter((n) => n < 0).length >= 2;
        if (!up && !down) continue;
        const dir = up ? ('up' as const) : ('down' as const),
          prior = events.at(-1);
        if (
          prior?.direction === dir &&
          minute(w[3].time)! - minute(prior.at)! <= 2
        )
          continue;
        events.push({
          direction: dir,
          from: w[0].time,
          at: w[3].time,
          fromPct: w[0].changePct,
          toPct: w[3].changePct,
          changePp: change,
        });
      }
    const states = points.map((p) =>
      priceLimitState(code, t.name, p.price, t.preClose),
    );
    const rawState = states.at(-1) ?? 'UNKNOWN';
    const limitState: TapeStock['limitState'] =
      rawState === 'LIMIT_UP' ||
      rawState === 'LIMIT_DOWN' ||
      rawState === 'UNKNOWN'
        ? rawState
        : 'NORMAL';
    let firstLimitTime: string | null = null,
      openedAt: string | null = null,
      resealedAt: string | null = null;
    let openingGap = false;
    for (let i = 0; i < states.length; i++) {
      if (states[i] === 'LIMIT_UP') firstLimitTime ??= points[i].time;
      if (oneMinute && i && states[i] !== 'LIMIT_UP') {
        // Observed loss invalidates the old repair even if its boundary
        // minute is missing; openedAt then bounds, not locates, the loss.
        resealedAt = null;
        if (states[i - 1] === 'LIMIT_UP' && states[i] !== 'LIMIT_UP') {
          openedAt = points[i].time;
          openingGap = !contiguous(points.slice(i - 1, i + 1));
        }
      }
      if (oneMinute && i && contiguous(points.slice(i - 1, i + 1))) {
        if (
          openedAt &&
          states[i - 1] !== 'LIMIT_UP' &&
          states[i] === 'LIMIT_UP'
        )
          resealedAt = points[i].time;
      }
    }
    const sinceFirst = firstLimitTime
      ? points.filter((p) => p.time >= firstLimitTime)
      : [];
    const stable = Boolean(
      oneMinute &&
      firstLimitTime &&
      last?.time === cutoff &&
      contiguous(sinceFirst) &&
      sinceFirst.every(
        (p) =>
          priceLimitState(code, t.name, p.price, t.preClose) === 'LIMIT_UP',
      ),
    );
    const stableSince = stable ? firstLimitTime : null;
    const support: TapeStock['support'] =
      !last || last.time !== cutoff || limitState === 'UNKNOWN'
        ? 'UNRESOLVED'
        : stable
          ? 'STABLE_SEAL'
          : oneMinute && limitState === 'LIMIT_UP' && resealedAt
            ? 'RESEALED'
            : oneMinute && limitState !== 'LIMIT_UP' && openedAt
              ? 'OPENED'
              : latestWindowComplete &&
                  events.some(
                    (e) =>
                      e.direction === 'down' &&
                      minute(cutoff)! - minute(e.at)! <= 5,
                  )
                ? 'WEAKENING'
                : 'NO_SEAL_SIGNAL';
    const supportLabel =
      support === 'STABLE_SEAL'
        ? `${firstLimitTime}起在可见分钟内持续封住`
        : support === 'RESEALED'
          ? `${openedAt}${openingGap ? '采样已离开涨停价（打开时点缺失）' : '打开后'}，${resealedAt}回到涨停价`
          : support === 'OPENED'
            ? `${openedAt}${openingGap ? '采样已离开涨停价（打开时点缺失）' : '打开后回落'}，${cutoff}为${pct(last!.changePct)}`
            : support === 'WEAKENING'
              ? `本窗口下行，${cutoff}为${pct(last!.changePct)}`
              : support === 'NO_SEAL_SIGNAL'
                ? limitState === 'LIMIT_UP' && openedAt
                  ? `${cutoff}处于涨停价；${openedAt}${openingGap ? '已离开涨停价' : '打开'}后的回封时点未确认，过程存在缺口`
                  : `${cutoff}为${pct(last!.changePct)}，本可见段未出现回封信号`
                : '当前分钟价格或适用涨跌停边界不足';
    return {
      code,
      name: t.name || meta.get(code)?.name || code,
      industry: meta.get(code)?.industry ?? '未知',
      previousHeight: previousByCode.get(code)?.height ?? 0,
      source: t.source ?? source,
      firstTime: first?.time ?? null,
      lastTime: last?.time ?? null,
      firstPct: first?.changePct ?? null,
      changePct: last?.changePct ?? null,
      quoteTime: last ? `${date}T${last.time}:00+08:00` : null,
      samples: points.length,
      fullSession,
      latestWindowComplete,
      gaps,
      limitState,
      firstLimitTime,
      openedAt,
      openingGap,
      resealedAt,
      stableSince,
      support,
      supportLabel,
      upEvents: events.filter((e) => e.direction === 'up'),
      downEvents: events.filter((e) => e.direction === 'down'),
      initiative: unresolved('比较窗口不足'),
      response: unresolved('成员比较窗口不足'),
      resilience: unresolved('同身位参照不足'),
      peerRelations: [],
      observedRelations: {
        earlierCodes: [],
        subsequentCodes: [],
        preexistingStrongCodes: [],
      },
    };
  });
  for (const row of rows) {
    const ownRaw = rawByCode.get(row.code) ?? [];
    const sameTier = rows.filter(
      (p) =>
        p.code !== row.code &&
        row.previousHeight >= 2 &&
        p.previousHeight === row.previousHeight &&
        /^(30|68)/.test(p.code) === /^(30|68)/.test(row.code),
    );
    const sameIndustry = rows.filter(
      (p) =>
        p.code !== row.code &&
        row.industry !== '未知' &&
        row.industry !== '' &&
        p.industry === row.industry,
    );
    const comparisons = [
      ...new Map(
        [...sameTier, ...sameIndustry].map((p) => [p.code, p]),
      ).values(),
    ];
    const usable = comparisons.filter(
      (p) => p.lastTime === cutoff && p.samples >= 4,
    );
    const event = row.upEvents[0];
    const noAttackKnown = row.fullSession || row.latestWindowComplete;
    const before: string[] = [],
      after: string[] = [],
      alreadyStrong: string[] = [],
      observedPeers: string[] = [];
    for (const peer of usable) {
      const peerRaw = rawByCode.get(peer.code) ?? [];
      if (event) {
        const commonStart =
          peer.firstTime && peer.firstTime > event.from
            ? peer.firstTime
            : event.from;
        const w = peerRaw.filter(
          (p) => p.time >= commonStart && p.time <= event.at,
        );
        const ownWindow = ownRaw.filter(
          (p) => p.time >= commonStart && p.time <= event.at,
        );
        // Some providers begin at 09:31, others at 09:30. Compare the actual
        // common continuous interval; never discard the available 09:31-09:33
        // evidence or claim anything about the unobserved earlier minute.
        if (
          w.length < 3 ||
          w.length !== ownWindow.length ||
          !contiguous(w) ||
          !contiguous(ownWindow) ||
          w.at(-1)?.time !== event.at
        )
          continue;
        observedPeers.push(peer.code);
        const pe = peer.upEvents[0];
        // A directly observed earlier move takes precedence over the broad
        // opening-strength comparison. Otherwise a low-base follower could be
        // incorrectly called early simply because its predecessor is strong.
        if (pe && pe.at < event.at) {
          before.push(peer.code);
          continue;
        }
        // Opening strength is not an arrival after the purported leader.
        if (
          (peer.firstPct ?? -Infinity) >= event.toPct - 0.1 ||
          (peer.firstLimitTime && peer.firstLimitTime <= event.at)
        ) {
          alreadyStrong.push(peer.code);
          continue;
        }
        if (pe && pe.at > event.at && minute(pe.at)! - minute(event.at)! <= 10)
          after.push(peer.code);
      }
    }
    const names = (codes: string[]) =>
      codes.map((c) => rows.find((p) => p.code === c)?.name ?? c).join('、');
    if (event && observedPeers.length) {
      const early =
        before.length === 0 && observedPeers.length > alreadyStrong.length;
      row.initiative = {
        state: 'READY',
        result: early ? 'OBSERVED' : 'NOT_OBSERVED',
        label: early
          ? event.toPct < 0
            ? '本可见窗口较早回拉（仍处负反馈区）'
            : alreadyStrong.length
              ? '局部较早进攻（组内已有先强者）'
              : '本可见窗口较早进攻'
          : before.length
            ? '同组已有更早发动者'
            : alreadyStrong.length
              ? '同组已有先强者，未确认最先发动'
              : '并非本比较组先动者',
        facts: [
          `${event.from}→${event.at}从${pct(event.fromPct)}到${pct(event.toPct)}`,
          alreadyStrong.length
            ? `${names(alreadyStrong)}此前已强，不能归为被动跟随`
            : '',
          before.length ? `${names(before)}出现更早窗口拉升` : '',
        ].filter(Boolean),
        comparedCodes: observedPeers,
      };
      row.response = {
        state: 'READY',
        result: after.length ? 'OBSERVED' : 'NOT_OBSERVED',
        label: after.length
          ? '样本内出现随后上涨响应'
          : '已比较窗口，未见新增随后响应',
        facts: after.map((c) => {
          const p = rows.find((x) => x.code === c)!,
            e = p.upEvents[0];
          return `${p.name} ${e.from}→${e.at}从${pct(e.fromPct)}到${pct(e.toPct)}，比本股较晚达到拉升窗口条件${e.from < event.at ? '（两段窗口有重叠，不能称完整启动先后）' : ''}；仅价格时序，不证明概念因果`;
        }),
        comparedCodes: observedPeers,
      };
    } else if (noAttackKnown && usable.length) {
      row.initiative = {
        state: 'READY',
        result: 'NOT_OBSERVED',
        label:
          row.support === 'STABLE_SEAL'
            ? '持续封住，未出现可区分的新发动段'
            : '可见比较窗口未观察到主动拉升',
        facts: [row.supportLabel],
        comparedCodes: usable.map((p) => p.code),
      };
      row.response = {
        state: 'READY',
        result: 'NOT_OBSERVED',
        label: '本段未发生新增进攻，未据此声称带动',
        facts: [],
        comparedCodes: usable.map((p) => p.code),
      };
    }
    row.observedRelations = {
      earlierCodes: before,
      subsequentCodes: after,
      preexistingStrongCodes: alreadyStrong,
    };
    const tierKnown = sameTier.filter(
      (p) => p.lastTime === cutoff && p.changePct !== null && p.samples >= 4,
    );
    for (const peer of tierKnown) {
      if (
        row.support === 'STABLE_SEAL' &&
        (peer.support === 'OPENED' ||
          peer.support === 'WEAKENING' ||
          peer.support === 'RESEALED' ||
          (peer.changePct !== null &&
            row.changePct !== null &&
            peer.changePct < row.changePct &&
            peer.limitState !== 'LIMIT_UP'))
      )
        row.peerRelations.push({
          code: peer.code,
          name: peer.name,
          relation: 'MORE_STABLE',
          fact: `${row.name}${row.supportLabel}；${peer.name}${peer.supportLabel}`,
        });
      if (
        row.support === 'RESEALED' &&
        peer.limitState !== 'LIMIT_UP' &&
        peer.changePct! < row.changePct!
      )
        row.peerRelations.push({
          code: peer.code,
          name: peer.name,
          relation: 'REPAIR_SEPARATION',
          fact: `${row.name}${row.resealedAt}回到涨停价；${peer.name}${cutoff}为${pct(peer.changePct!)}`,
        });
      if (
        (row.support === 'OPENED' ||
          (row.changePct !== null &&
            peer.changePct !== null &&
            row.changePct < peer.changePct &&
            row.limitState !== 'LIMIT_UP')) &&
        (peer.support === 'STABLE_SEAL' || peer.support === 'RESEALED')
      )
        row.peerRelations.push({
          code: peer.code,
          name: peer.name,
          relation: 'WEAKER_SUPPORT',
          fact: `${row.name}${row.supportLabel}；${peer.name}${peer.supportLabel}`,
        });
    }
    if (row.lastTime === cutoff && tierKnown.length)
      row.resilience = {
        state: 'READY',
        result: row.peerRelations.length ? 'OBSERVED' : 'NOT_OBSERVED',
        label: row.peerRelations.some((p) => p.relation === 'MORE_STABLE')
          ? '同身位承接较稳定'
          : row.peerRelations.some((p) => p.relation === 'REPAIR_SEPARATION')
            ? '修复后相对分离'
            : row.peerRelations.some((p) => p.relation === 'WEAKER_SUPPORT')
              ? '同身位分歧较大'
              : '本组未见明显承接分离',
        facts: row.peerRelations.map((p) => p.fact),
        comparedCodes: tierKnown.map((p) => p.code),
      };
    if (!ownRaw.length) {
      row.initiative = unresolved('本股分钟缺失');
      row.response = unresolved('本股分钟缺失');
    }
  }
  return {
    date,
    cutoff,
    source,
    observedAt: `${date}T${cutoff}:00+08:00`,
    sourceAvailableAt: args.availableAt ?? null,
    scope: `已采集分钟样本${rows.length}只，非全市场；比较仅限明确同身位或此前已知行业`,
    requested: rows.length,
    available: rows.filter((r) => r.lastTime === cutoff).length,
    method:
      '3个连续交易分钟净变动至少1个百分点且至少2步同向，只用于寻找需解释的价格窗口，不是核心入池或交易阈值；稳定封板与回封另按适用涨停价记录',
    rows,
  };
}
