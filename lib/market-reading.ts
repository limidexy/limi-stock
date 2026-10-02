import { readEmotionCores } from './emotion-core-engine.ts';
import type {
  ObservationResult,
  TapeSnapshot,
  TapeStock,
} from './tape-observation';

// Descriptive observations, not a trading signal or a calibrated prediction.
export type ReadingCompetitor = {
  code: string;
  name: string;
  fromHeight: number;
  toHeight: number;
  state: string;
  changePct: number | null;
  speedPct: number | null;
  industry: string;
  quoteTime?: string;
  priceQuoteTime?: string;
  amount?: number | null;
  firstTouch?: string | null;
  lastSeal?: string | null;
  breakCount?: number;
  sealFund?: number | null;
};

export type ReadingLadder = {
  status: string;
  tradeDate?: string;
  previousTradeDate?: string;
  priorDateState?: string;
  sourceState?: string;
  sessionState?: string;
  retrievedAt?: string;
  counts?: { previousLimitUp: number; todaySealed?: number };
  sealedStocks?: EmotionStock[];
  competitors: ReadingCompetitor[];
};

export const compactDate = (date: string | undefined) =>
  (date ?? '').replaceAll('-', '');
export const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
export const percentage = (numerator: number, denominator: number) =>
  denominator > 0 ? (numerator / denominator) * 100 : null;
const pctText = (value: number | null) =>
  value === null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
export function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function ladderReading(
  ladder: ReadingLadder | null | undefined,
  targetDate?: string,
) {
  const rows = [
    ...new Map(
      (ladder?.competitors ?? []).map((row) => [row.code, row]),
    ).values(),
  ].sort(
    (a, b) =>
      b.fromHeight - a.fromHeight ||
      (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity) ||
      (b.speedPct ?? -Infinity) - (a.speedPct ?? -Infinity),
  );
  const date = compactDate(ladder?.tradeDate);
  const previousDate = compactDate(ladder?.previousTradeDate);
  const aligned = Boolean(
    ladder &&
    /^\d{8}$/.test(date) &&
    /^\d{8}$/.test(previousDate) &&
    previousDate < date &&
    (!targetDate || date === compactDate(targetDate)),
  );
  const ready =
    aligned &&
    ladder?.priorDateState === 'READY' &&
    ladder.status !== 'MISSING' &&
    ladder.sourceState !== 'STALE' &&
    rows.length === ladder.counts?.previousLimitUp;
  const cohort = (input: ReadingCompetitor[]) => {
    const advanced = input.filter((row) => row.state === 'SEALED').length;
    const failed = input.filter((row) => row.state === 'FAILED').length;
    const attempts = advanced + failed;
    const changes = input.map((row) => row.changePct).filter(finite);
    return {
      count: input.length,
      advanced,
      failed,
      attempts,
      dropped: input.length - advanced - failed,
      rate: ready ? percentage(advanced, input.length) : null,
      attemptRate: ready ? percentage(attempts, input.length) : null,
      sealRate: ready ? percentage(advanced, attempts) : null,
      median: ready ? median(changes) : null,
      priceReady: changes.length,
    };
  };
  return {
    ready,
    aligned,
    rows,
    consecutive: cohort(rows.filter((row) => row.fromHeight >= 2)),
    first: cohort(rows.filter((row) => row.fromHeight === 1)),
    all: cohort(rows),
    negative: ready
      ? rows.filter(
          (row) =>
            row.fromHeight >= 2 &&
            row.state !== 'SEALED' &&
            finite(row.changePct) &&
            row.changePct < 0,
        )
      : [],
    groups: [...new Set(rows.map((row) => row.fromHeight))]
      .sort((a, b) => b - a)
      .map((height) => ({
        height,
        ...cohort(rows.filter((row) => row.fromHeight === height)),
      })),
  };
}

export type EmotionFacts = {
  date: string;
  previousDate?: string;
  closeQuotes?: Record<
    string,
    { changePct: number; quoteTime: string; source: string }
  >;
  cutoff: string;
  status: string;
  stale?: boolean;
  coreStructureReady?: boolean;
  coreNegativePoolsReady?: boolean;
  coreNegativePoolsAt?: string;
  coreContextReady?: boolean;
  poolsReady: boolean;
  breadthReady: boolean;
  limitUp: number;
  failed: number;
  limitDown: number;
  highestBoard: number;
  retrievedAt?: string;
  consecutiveCount?: number;
  ladders?: Array<{ height: number; stocks: EmotionStock[] }>;
  failedStocks?: EmotionStock[];
  limitDownStocks?: EmotionStock[];
  breadth: {
    up: number;
    down: number;
    flat: number;
    rowsAvailable: number;
    medianChangePct: number | null;
  };
  indices?: Array<{ code: string; name: string; changePct: number | null }>;
};

export type EmotionStock = {
  code: string;
  name: string;
  height: number;
  changePct: number | null;
  industry: string;
  firstTouch?: string | null;
  lastSeal?: string | null;
  breakCount?: number;
  sealFund?: number | null;
};

export type EvidenceState = 'READY' | 'DEGRADED' | 'MISSING';

export const EMOTION_CORE_STATES = [
  '潜在核心',
  '同身位竞争',
  '分离/卡位',
  '龙头候选',
  '明牌核心',
  '局部响应观察',
  '加速一致',
  '爆量分歧',
  '修复/断板',
  '反包或二波',
  '老高标跟踪',
  '历史角色跟踪',
  '影响衰减退出',
] as const;

export type EmotionCoreState = (typeof EMOTION_CORE_STATES)[number];
export type EmotionCoreRole =
  | '当前最高竞争者'
  | '当前次高竞争者'
  | '最近交易日最高板/核心'
  | '断板老高标'
  | '极端负反馈代表'
  | '反核/反包尝试'
  | '主线先锋/候选/明牌'
  | '20cm趋势容量核心'
  | '趋势容量核心候选'
  | '题材响应观察'
  | '负向响应观察'
  | '分歧失败跟踪'
  | '板块接力带动者';

export type CoreDimension = {
  state: EvidenceState;
  fact: string;
  basis: string;
  observedAt: string;
  source: string;
  result?: ObservationResult;
};

export type CoreCandidate = {
  code: string;
  name: string;
  roles: EmotionCoreRole[];
  state: EmotionCoreState;
  provisional: boolean;
  height: number | null;
  historicalHeight?: number | null;
  currentRole?: string;
  interpretation: {
    identity: { label: string; basis: string };
    feedback: { label: string; basis: string };
    influence: {
      direction: 'UP' | 'DOWN' | 'MIXED' | 'UNRESOLVED';
      label: string;
      basis: string;
      groups: Array<{
        concept: string;
        direction: 'up' | 'down';
        members: Array<{
          code: string;
          name: string;
          time: string;
          lag: number;
        }>;
        historyDays: string[];
      }>;
    };
    counterEvidence: string[];
    nextCheck: string;
  };
  scope?: 'ACTIVE' | 'COMPETITOR' | 'HISTORY';
  scopeReason?: string;
  pricePath?: TapeStock;
  trend: '20cm' | '主板' | '北交所' | null;
  changePct: number | null;
  quoteTime: string | null;
  quoteSource: string | null;
  quoteState: EvidenceState;
  speedPct: number | null;
  amount: number | null;
  concepts: string[];
  reasons: string[];
  confirmedEvidence: string[];
  missingEvidence: string[];
  impact: {
    sector: string;
    relay: string;
    group: string;
  };
  dimensions: {
    position: CoreDimension;
    initiative: CoreDimension;
    leadership: CoreDimension;
    antiFall: CoreDimension;
    identity: CoreDimension;
    expectation: CoreDimension;
    chips: CoreDimension;
    groupInfluence: CoreDimension;
    persistence: CoreDimension;
  };
  statusBasis: string;
  transitionTrace: Array<{
    from: EmotionCoreState | null;
    to: EmotionCoreState;
    observedAt: string;
    evidence: string;
    source: string;
  }>;
};

type CorePathRow = {
  date?: string;
  changePct?: number | null;
  quoteState?: string;
  quoteTime?: string | null;
  quoteSource?: string | null;
  availableAt?: string | null;
  height?: number | null;
};

type CoreTrackingRow = {
  code: string;
  name: string;
  industry?: string;
  height?: number;
  peakHeight?: number;
  brokenDate?: string | null;
  changePct?: number | null;
  quoteState?: string;
  label?: string;
  yesterdayChangePct?: number | null;
  quoteTime?: string | null;
  quoteSource?: string | null;
  availableAt?: string | null;
  liquidityDecay?: boolean;
  impactDecay?: boolean;
  identityDecay?: boolean;
  path?: CorePathRow[];
};

type CoreReboundRow = {
  code: string;
  name: string;
  status?: EvidenceState | 'NO_TRADE';
  eventState?: EvidenceState;
  eventWindow?: {
    start: string;
    end: string;
    samples: number;
    complete: boolean;
    intervalMinutes: number;
  } | null;
  label?: string;
  points?: number;
  lowPct?: number;
  lastPct?: number;
  event?: {
    lowTime?: string;
    lowPct?: number;
    time?: string;
    changePct?: number;
    recoveryPp?: number;
    observedAt?: string | null;
    availableAt?: string | null;
    source?: string | null;
  } | null;
  observedAt?: string | null;
  availableAt?: string | null;
  source?: string | null;
};

type CoreLeadLagGroup = {
  core: { code: string; name: string; height?: number };
  industry?: string;
  status?: EvidenceState;
  following?: number;
  requested?: number;
  available?: number;
  label?: string;
  availableAt?: string | null;
  source?: string | null;
  direction?: 'up' | 'down';
  onset?: { time: string; minute?: number; pct?: number; gain?: number } | null;
  rows?: Array<{
    code: string;
    name: string;
    role?: string;
    lag?: number | null;
    time?: string | null;
    availableAt?: string | null;
    pathState?: string;
  }>;
};

export type EmotionCoreEvidence = {
  decisionAt?: string;
  decisionMode?: 'LIVE' | 'FIXED';
  history?: EmotionFacts[];
  decayObservations?: Array<{
    code: string;
    date: string;
    observedAt: string;
    source: string;
    state: EvidenceState;
    liquidityShare: number;
    responseCount: number;
    recognitionCount: number;
    coverage: number;
  }>;
  influenceHistory?: Array<{
    code: string;
    name?: string;
    date: string;
    observedAt: string;
    source: string;
    state: EvidenceState;
    respondingCodes: string[];
    concept: string;
    direction?: 'up' | 'down';
  }>;
  volumeEvidence?: Array<{
    code: string;
    observedAt: string;
    source: string;
    state: EvidenceState;
    currentVolume: number;
    baselineVolume: number;
    intervalMinutes: number;
    baselineIntervalMinutes: number;
    turnoverPct?: number;
  }>;
  date?: string;
  cutoff?: string;
  sourceState?: 'LIVE' | 'ARCHIVED' | 'STALE';
  retrievedAt?: string;
  availableAt?: string;
  source?: string;
  tracking?: {
    tape?: TapeSnapshot;
    status?: EvidenceState;
    date?: string;
    cutoff?: string;
    previousDate?: string | null;
    availableAt?: string | null;
    asOf?: string | null;
    oldLeaders?: {
      rows: CoreTrackingRow[];
      available?: number;
      requested?: number;
    };
    failedRepair?: {
      rows: CoreTrackingRow[];
      available?: number;
      requested?: number;
    };
    rebounds?: {
      rows: CoreReboundRow[];
      available?: number;
      requested?: number;
    };
    leadLag?: {
      rows: CoreLeadLagGroup[];
      available?: number;
      requested?: number;
    };
    negativeLeadLag?: {
      rows: CoreLeadLagGroup[];
      available?: number;
      requested?: number;
    };
    extremePaths?: {
      rows: Array<{
        code: string;
        date: string;
        observedAt: string;
        source: string;
        status: EvidenceState;
        skyFloor: boolean | null;
        upTime: string | null;
        downTime: string | null;
        reason: string;
      }>;
    };
    concepts?: Record<string, string[]>;
    conceptStates?: Record<string, EvidenceState | 'RECOVERED_LATE'>;
    conceptsAsOf?: string;
    conceptsAvailableAt?: string;
    conceptsState?: EvidenceState | 'RECOVERED_LATE';
    source?: string;
  };
  speedRows?: Array<{
    code: string;
    name: string;
    changePct?: number | null;
    speedPct?: number | null;
    amount?: number | null;
    industry?: string;
    concepts?: string[];
    metadataState?: EvidenceState | 'RECOVERED_LATE';
    metadataAsOf?: string;
    mainNetInflow?: number | null;
    turnoverPct?: number | null;
    availableAt?: string | null;
    quoteTime?: string | null;
    quoteSource?: string | null;
  }>;
  sectorEvents?: Array<{
    name: string;
    direction: 'up' | 'down';
    driverCodes?: string[];
    driverNames?: string[];
    driverState?: EvidenceState;
    windowReady?: boolean;
    quoteTime?: string;
  }>;
  flowRows?: Array<{
    code?: string;
    name: string;
    latestMainNetInflow?: number | null;
    persistenceLabel?: string;
  }>;
};

export type EmotionCoreFeedback = {
  state: EvidenceState;
  denominator: number | null;
  attempted: number | null;
  promoted: number | null;
  sealed: number | null;
  deepWater: number | null;
  limitDown: number | null;
  extreme: number | null;
  failed: number | null;
  consecutiveNegative: number | null;
  detail: string;
};

export type CoreFeedbackMetric = {
  state: EvidenceState;
  value: number | null;
  denominator: number | null;
  detail: string;
  knownCount?: number;
  covered?: number;
  unknown?: number;
};

export type EmotionCoreGroupFeedback = {
  state: EvidenceState;
  denominator: number | null;
  covered: number;
  strong: CoreFeedbackMetric;
  disagreement: CoreFeedbackMetric;
  brokenImpact: CoreFeedbackMetric;
  deepWater: CoreFeedbackMetric;
  extreme: CoreFeedbackMetric;
  antiAttempt: CoreFeedbackMetric;
  repairSpread: CoreFeedbackMetric;
  exits: CoreFeedbackMetric;
};

export function emotionReading(facts: EmotionFacts) {
  const breadth = facts.breadth;
  const countValid = [
    breadth.up,
    breadth.down,
    breadth.flat,
    breadth.rowsAvailable,
  ].every((value) => finite(value) && value >= 0);
  const breadthReady =
    facts.breadthReady &&
    countValid &&
    breadth.rowsAvailable > 0 &&
    breadth.up + breadth.down + breadth.flat === breadth.rowsAvailable &&
    finite(breadth.medianChangePct);
  const poolsReady =
    facts.poolsReady &&
    [facts.limitUp, facts.failed, facts.limitDown].every(
      (value) => Number.isInteger(value) && value >= 0,
    );
  const upRatio = breadthReady
    ? percentage(breadth.up, breadth.rowsAvailable)
    : null;
  const sealRate = poolsReady
    ? percentage(facts.limitUp, facts.limitUp + facts.failed)
    : null;
  const broad = !breadthReady
    ? '待补数据'
    : upRatio! >= 60 && breadth.medianChangePct! > 0
      ? '多数上涨'
      : upRatio! <= 40 && breadth.medianChangePct! < 0
        ? '多数下跌'
        : '涨跌分化';
  const board =
    sealRate === null
      ? '样本不足'
      : sealRate < 55
        ? '封板分歧大'
        : sealRate >= 75
          ? '封板承接较好'
          : '封板分化';
  const normalizedIndices = (facts.indices ?? []).map((index) => ({
    ...index,
    code: index.code.replace(/^(sh|sz)/, ''),
  }));
  const indices = [
    ...new Map(
      normalizedIndices
        .filter((index) => ['000001', '399001', '399006'].includes(index.code))
        .map((index) => [index.code, index]),
    ).values(),
  ];
  const indexReady =
    indices.length === 3 && indices.every((index) => finite(index.changePct));
  const indexMood = !indexReady
    ? '待补指数'
    : indices.every((index) => index.changePct! > 0)
      ? '三大指数上涨'
      : indices.every((index) => index.changePct! < 0)
        ? '三大指数下跌'
        : '指数分化';
  const usable =
    facts.status !== 'MISSING' &&
    !facts.stale &&
    breadthReady &&
    poolsReady &&
    sealRate !== null;
  const headline = !usable
    ? facts.stale
      ? '非当前实时，仅作历史观察'
      : '数据不全，暂不合成判断'
    : broad === '多数上涨' && sealRate! < 55
      ? '多数个股上涨，但封板分歧大'
      : broad === '多数下跌' && sealRate! < 55
        ? '赚钱面偏弱，封板承接也弱'
        : `${broad} · ${board}`;
  return {
    breadthReady,
    poolsReady,
    upRatio,
    sealRate,
    broad,
    board,
    indices,
    indexReady,
    indexMood,
    usable,
    headline,
  };
}

export function closeComparison(
  current: EmotionFacts,
  prior: EmotionFacts | null | undefined,
) {
  if (
    !prior ||
    current.stale ||
    prior.stale ||
    current.cutoff !== '15:00' ||
    prior.cutoff !== '15:00' ||
    compactDate(prior.date) >= compactDate(current.date)
  )
    return null;
  const now = emotionReading(current);
  const before = emotionReading(prior);
  if (!now.usable || !before.usable) return null;
  return {
    date: prior.date,
    limitUp: current.limitUp - prior.limitUp,
    limitDown: current.limitDown - prior.limitDown,
    sealRate: now.sealRate! - before.sealRate!,
    height: current.highestBoard - prior.highestBoard,
  };
}

// Deliberately conservative: holes or intervening weekdays are not treated as
// adjacent sessions. This does not invent a holiday calendar for missing data.
export function adjacentCloses(
  current: EmotionFacts,
  previous?: EmotionFacts | null,
) {
  if (!previous || current.cutoff !== '15:00' || previous.cutoff !== '15:00')
    return false;
  if (current.previousDate)
    return (
      compactDate(current.previousDate) === compactDate(previous.date) &&
      compactDate(previous.date) < compactDate(current.date)
    );
  const date = compactDate(previous.date);
  const next = new Date(
    `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T00:00:00Z`,
  );
  if (!Number.isFinite(next.getTime())) return false;
  do next.setUTCDate(next.getUTCDate() + 1);
  while ([0, 6].includes(next.getUTCDay()));
  return (
    next.toISOString().slice(0, 10).replaceAll('-', '') ===
    compactDate(current.date)
  );
}

const uniqueStocks = (rows: EmotionStock[]) => [
  ...new Map(rows.map((row) => [row.code, row])).values(),
];
function completeStructure(facts: EmotionFacts) {
  const stocks = uniqueStocks(
    facts.ladders?.flatMap((level) => level.stocks) ?? [],
  );
  return (
    facts.status !== 'MISSING' &&
    !facts.stale &&
    facts.poolsReady &&
    Boolean(facts.ladders) &&
    stocks.length === facts.limitUp &&
    stocks.every(
      (stock) => Number.isInteger(stock.height) && stock.height >= 1,
    ) &&
    Math.max(0, ...stocks.map((stock) => stock.height)) ===
      facts.highestBoard &&
    stocks.filter((stock) => stock.height >= 2).length ===
      facts.consecutiveCount
  );
}

// Pool intersections prove whether a stock remained sealed, NOT the return of
// stocks absent from those pools. Missing prices stay null, never yesterday's +10%.
export function historicalEmotionLadder(
  current: EmotionFacts,
  previous?: EmotionFacts | null,
): ReadingLadder | null {
  if (
    !previous ||
    !adjacentCloses(current, previous) ||
    !completeStructure(current) ||
    !completeStructure(previous)
  )
    return null;
  const sealed = new Map(
    current
      .ladders!.flatMap((level) => level.stocks)
      .map((stock) => [stock.code, stock]),
  );
  const failed = new Map(
    (current.failedStocks ?? []).map((stock) => [stock.code, stock]),
  );
  const down = new Map(
    (current.limitDownStocks ?? []).map((stock) => [stock.code, stock]),
  );
  const prior = uniqueStocks(
    previous.ladders!.flatMap((level) => level.stocks),
  );
  // Reject a inconsistent consecutive-height join rather than call it a promotion.
  if (
    prior.some(
      (stock) =>
        sealed.has(stock.code) &&
        sealed.get(stock.code)!.height !== stock.height + 1,
    )
  )
    return null;
  return {
    status: 'DEGRADED',
    sourceState: 'ARCHIVED',
    sessionState: 'CLOSED',
    tradeDate: current.date,
    previousTradeDate: previous.date,
    priorDateState: 'READY',
    counts: { previousLimitUp: prior.length },
    competitors: prior.map((stock) => {
      const observed =
        sealed.get(stock.code) ??
        failed.get(stock.code) ??
        down.get(stock.code);
      const exact = current.closeQuotes?.[stock.code];
      const digits = compactDate(current.date);
      const closeAt = Date.parse(
        `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}T15:00:00+08:00`,
      );
      const verifiedPrice =
        exact &&
        finite(exact.changePct) &&
        Date.parse(exact.quoteTime) === closeAt
          ? exact.changePct
          : null;
      return {
        code: stock.code,
        name: stock.name,
        industry: stock.industry,
        fromHeight: stock.height,
        toHeight: stock.height + 1,
        state: sealed.has(stock.code)
          ? 'SEALED'
          : failed.has(stock.code)
            ? 'FAILED'
            : 'DROPPED',
        changePct: verifiedPrice ?? observed?.changePct ?? null,
        speedPct: null,
      };
    }),
  };
}

export function emotionBoardFamily(code: string) {
  const digits = code.replace(/^(sh|sz|bj)/, '');
  if (/^(300|301|688|689)/.test(digits)) return '创业板 / 科创板';
  if (/^(4|8|92)/.test(digits)) return '北交所';
  return '主板';
}

export function emotionCoreReading(
  facts: EmotionFacts,
  previous: EmotionFacts | null | undefined,
  rows: ReadingCompetitor[],
  stocks: EmotionStock[],
  evidence?: EmotionCoreEvidence | null,
) {
  return readEmotionCores(facts, previous, rows, stocks, evidence);
}

export type EmotionTone = 'positive' | 'negative' | 'mixed' | 'unknown';

// High-board and relay are deliberately judged separately. Relay uses the fixed
// previous consecutive-board cohort; high-board uses the independently retained
// evidence registry. Index/breadth are only a relative-strength context, never
// a substitute for the cohort. These are descriptive rules, not a prediction.
export function shortEmotionReading(
  facts: EmotionFacts,
  previous?: EmotionFacts | null,
  suppliedLadder?: ReadingLadder | null,
  coreEvidence?: EmotionCoreEvidence | null,
) {
  const observed = emotionReading(facts);
  const structureReady = completeStructure(facts);
  // A same-day persisted emotion snapshot becomes STALE when its upstream
  // request fails. Its structure can still be used for cross-checking, but it
  // must not by itself make the current judgment READY.
  const factsStructureComplete = completeStructure({ ...facts, stale: false });
  const factsStocks = factsStructureComplete
    ? uniqueStocks(facts.ladders!.flatMap((level) => level.stocks))
    : [];
  const sourceTime = Date.parse(suppliedLadder?.retrievedAt ?? '');
  const factsTime = Date.parse(facts.retrievedAt ?? '');
  const digits = compactDate(facts.date);
  const closeTime = Date.parse(
    `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}T15:00:00+08:00`,
  );
  const liveSourceDate = Number.isFinite(sourceTime)
    ? new Date(sourceTime + 8 * 3_600_000)
        .toISOString()
        .slice(0, 10)
        .replaceAll('-', '')
    : '';
  const timeAligned =
    facts.cutoff === '15:00'
      ? suppliedLadder?.sessionState === 'CLOSED' &&
        Number.isFinite(sourceTime) &&
        sourceTime >= closeTime
      : suppliedLadder?.sessionState === 'LIVE' &&
        suppliedLadder?.sourceState === 'LIVE' &&
        Number.isFinite(sourceTime) &&
        Number.isFinite(factsTime) &&
        liveSourceDate === digits &&
        (facts.stale ||
          (sourceTime <= factsTime && factsTime - sourceTime <= 60_000));
  const evidenceTime = facts.stale && timeAligned ? sourceTime : factsTime;
  const timedLadder = suppliedLadder
    ? {
        ...suppliedLadder,
        competitors: suppliedLadder.competitors.map((row) => {
          const quoteTime = Date.parse(
            row.priceQuoteTime ?? row.quoteTime ?? '',
          );
          const priceAligned =
            facts.cutoff === '15:00'
              ? quoteTime === closeTime
              : Number.isFinite(quoteTime) &&
                quoteTime <= evidenceTime &&
                evidenceTime - quoteTime <= 60_000 &&
                new Date(quoteTime + 8 * 3_600_000)
                  .toISOString()
                  .slice(0, 10)
                  .replaceAll('-', '') === digits;
          return { ...row, changePct: priceAligned ? row.changePct : null };
        }),
      }
    : null;
  const supplied = ladderReading(timedLadder, facts.date);
  const suppliedStateStocks = suppliedLadder?.sealedStocks?.length
    ? uniqueStocks(suppliedLadder.sealedStocks)
    : [];
  const suppliedStateComplete = Boolean(
    suppliedLadder &&
    suppliedLadder.counts?.todaySealed !== undefined &&
    suppliedStateStocks.length === suppliedLadder.counts.todaySealed,
  );
  const stateStocks = suppliedStateComplete ? suppliedStateStocks : factsStocks;
  const stateMismatches =
    suppliedStateComplete || factsStructureComplete
      ? supplied.rows.filter((row) => {
          if (
            !['SEALED', 'FAILED', 'DROPPED'].includes(row.state) ||
            row.toHeight !== row.fromHeight + 1
          )
            return true;
          const sealed = stateStocks.find((stock) => stock.code === row.code);
          return sealed
            ? row.state !== 'SEALED' || sealed.height !== row.fromHeight + 1
            : row.state === 'SEALED';
        })
      : supplied.rows;
  const firstBoardCount = supplied.rows.filter(
    (row) => row.fromHeight === 1,
  ).length;
  const toleratedFirstBoardDrift = Math.max(
    1,
    Math.floor(firstBoardCount * 0.02),
  );
  const stateAligned =
    (suppliedStateComplete || structureReady) &&
    !stateMismatches.some((row) => row.fromHeight >= 2) &&
    stateMismatches.length <= toleratedFirstBoardDrift;
  const priorStocks = previous?.ladders?.flatMap((level) => level.stocks) ?? [];
  const priorAligned =
    previous &&
    completeStructure(previous) &&
    compactDate(previous.date) ===
      compactDate(suppliedLadder?.previousTradeDate) &&
    compactDate(previous.date) < compactDate(facts.date) &&
    priorStocks.length === supplied.rows.length &&
    supplied.rows.every((row) =>
      priorStocks.some(
        (stock) => stock.code === row.code && stock.height === row.fromHeight,
      ),
    );
  const useSupplied =
    supplied.ready && timeAligned && stateAligned && priorAligned;
  const derived = historicalEmotionLadder(facts, previous);
  const ladder = useSupplied ? timedLadder : derived;
  const cohort = useSupplied ? supplied : ladderReading(derived, facts.date);
  const quoteComplete =
    cohort.ready &&
    cohort.all.count > 0 &&
    cohort.all.priceReady === cohort.all.count;
  const rows = cohort.ready && (useSupplied || !facts.stale) ? cohort.rows : [];
  const stocks = useSupplied ? stateStocks : facts.stale ? [] : factsStocks;
  const coreAsOf =
    useSupplied && facts.cutoff !== '15:00' ? sourceTime : closeTime;
  const contextAligned =
    !facts.stale &&
    (facts.cutoff === '15:00' ||
      (Number.isFinite(factsTime) && Math.abs(factsTime - coreAsOf) <= 60_000));
  const coreFacts: EmotionFacts = useSupplied
    ? {
        ...facts,
        cutoff:
          facts.cutoff === '15:00'
            ? '15:00'
            : new Date(coreAsOf + 8 * 3_600_000).toISOString().slice(11, 16),
        retrievedAt: new Date(coreAsOf).toISOString(),
        previousDate: suppliedLadder?.previousTradeDate ?? facts.previousDate,
        limitUp: stateStocks.length,
        coreStructureReady: true,
        coreContextReady: contextAligned,
        coreNegativePoolsReady: contextAligned && facts.poolsReady,
        coreNegativePoolsAt: facts.retrievedAt,
      }
    : facts;
  const lastKnownWindow = facts.stale && !useSupplied && factsStructureComplete;
  const retainedPriorDate =
    coreFacts.previousDate ?? coreEvidence?.tracking?.previousDate;
  const retainedRows: ReadingCompetitor[] =
    lastKnownWindow &&
    previous &&
    completeStructure(previous) &&
    compactDate(retainedPriorDate ?? undefined) === compactDate(previous.date)
      ? priorStocks.map((stock) => {
          const sealed = factsStocks.some((item) => item.code === stock.code);
          const failed = facts.failedStocks?.some(
            (item) => item.code === stock.code,
          );
          return {
            code: stock.code,
            name: stock.name,
            industry: stock.industry,
            fromHeight: stock.height,
            toHeight: stock.height + 1,
            state: sealed ? 'SEALED' : failed ? 'FAILED' : 'DROPPED',
            changePct: null,
            speedPct: null,
          };
        })
      : [];
  const core = emotionCoreReading(
    lastKnownWindow
      ? { ...coreFacts, previousDate: retainedPriorDate ?? undefined }
      : coreFacts,
    previous,
    retainedRows.length ? retainedRows : rows,
    lastKnownWindow ? factsStocks : stocks,
    coreEvidence,
  );
  const highRows = rows.filter((row) => row.fromHeight >= 2);
  const negative = highRows.filter(
    (row) => finite(row.changePct) && row.changePct < 0,
  );
  const positive = highRows.filter(
    (row) => finite(row.changePct) && row.changePct > 0,
  );
  const families = ['主板', '创业板 / 科创板', '北交所'].map((name) => {
    const members = stocks.filter(
      (stock) => emotionBoardFamily(stock.code) === name,
    );
    const highest = Math.max(0, ...members.map((stock) => stock.height));
    const gaps = Array.from(
      { length: Math.max(0, highest - 2) },
      (_, i) => i + 2,
    ).filter((height) => !members.some((stock) => stock.height === height));
    const prior = highRows.filter(
      (stock) => emotionBoardFamily(stock.code) === name,
    );
    return {
      name,
      highest,
      leaders: members.filter((stock) => stock.height === highest),
      gaps,
      advanced: prior.filter((stock) => stock.state === 'SEALED').length,
      started: prior.length,
      middleHighStarted: prior.filter((stock) => stock.fromHeight >= 3).length,
      middleHighAdvanced: prior.filter(
        (stock) => stock.fromHeight >= 3 && stock.state === 'SEALED',
      ).length,
    };
  });
  const main = families[0];
  const mainHighRows = highRows.filter(
    (stock) => emotionBoardFamily(stock.code) === '主板',
  );
  const highestPrior = Math.max(
    0,
    ...highRows.map((stock) => stock.fromHeight),
  );
  const oldLeaders = highRows.filter(
    (stock) => stock.fromHeight === highestPrior,
  );
  // The complete retained registry is authoritative, including old and trend cores.
  // No intersection with yesterday's consecutive-board cohort is permitted here.
  const highPoolRows = core.activeCandidates;
  const highPoolFloor = null;
  const middleRows = core.middleRows;
  const highCandidates = core.activeCandidates;
  const highPoolAdvanced = core.highFeedback.strong.knownCount ?? 0;
  const highPoolFailed = highCandidates.filter(
    (candidate) =>
      candidate.state === '爆量分歧' ||
      highRows.some(
        (row) => row.code === candidate.code && row.state === 'FAILED',
      ),
  ).length;
  const highPoolQuoted = highCandidates.filter(
    (candidate) => candidate.quoteState === 'READY',
  );
  const highPoolDeep = highPoolQuoted.filter(
    (candidate) => (candidate.changePct ?? 0) <= -5,
  );
  const highPoolExtreme = highCandidates.filter((candidate) =>
    (facts.limitDownStocks ?? []).some(
      (stock) => stock.code === candidate.code,
    ),
  );
  const middleAdvanced = middleRows.filter(
    (stock) => stock.state === 'SEALED',
  ).length;
  const middleDeep = middleRows.filter(
    (stock) =>
      stock.state !== 'SEALED' &&
      finite(stock.changePct) &&
      stock.changePct <= -5,
  );
  const weakest = [...negative].sort(
    (a, b) => b.fromHeight - a.fromHeight || a.changePct! - b.changePct!,
  );
  const contextReady =
    facts.status !== 'MISSING' &&
    !facts.stale &&
    observed.poolsReady &&
    structureReady;
  const judgmentReady = useSupplied || contextReady;
  const consecutiveQuotesComplete =
    cohort.ready &&
    cohort.consecutive.count > 0 &&
    cohort.consecutive.priceReady === cohort.consecutive.count;
  const nonSealedRelay = highRows.filter((row) => row.state !== 'SEALED');
  const relayDeep = nonSealedRelay.filter(
    (row) => finite(row.changePct) && row.changePct <= -5,
  );
  const relayExtreme = nonSealedRelay.filter(
    (row) => finite(row.changePct) && row.changePct <= -9,
  );
  const relayNegativeRatio = consecutiveQuotesComplete
    ? percentage(
        nonSealedRelay.filter((row) => row.changePct! < 0).length,
        highRows.length,
      )
    : null;
  const weakPressure = !consecutiveQuotesComplete
    ? '待补证据'
    : relayExtreme.length > 0 || (relayNegativeRatio ?? 0) >= 60
      ? '极高'
      : relayDeep.length >= 2 || (relayNegativeRatio ?? 0) >= 40
        ? '高'
        : relayDeep.length > 0 || (relayNegativeRatio ?? 0) >= 25
          ? '中'
          : '低';

  const industryGroups = [...new Set(highRows.map((row) => row.industry))]
    .filter((industry) => industry && industry !== '未知')
    .map((industry) => {
      const members = highRows.filter((row) => row.industry === industry);
      const advanced = members.filter((row) => row.state === 'SEALED').length;
      return { industry, count: members.length, advanced };
    })
    .filter((group) => group.count >= 2)
    .sort((a, b) => b.advanced - a.advanced || b.count - a.count);
  const industryRelay = industryGroups.find(
    (group) => group.advanced >= 2 || group.advanced / group.count >= 0.5,
  );

  const sealedDetails = highRows
    .filter((row) => row.state === 'SEALED')
    .map((row) => ({
      row,
      stock: stocks.find((stock) => stock.code === row.code),
    }));
  const sealProcessReady =
    sealedDetails.length > 0 &&
    sealedDetails.every(
      ({ stock }) =>
        stock &&
        typeof stock.firstTouch === 'string' &&
        /^(09:25|09:[3-5]\d|10:[0-5]\d|11:([0-2]\d|30)|13:[0-5]\d|14:[0-5]\d|15:00)$/.test(
          stock.firstTouch,
        ) &&
        finite(stock.breakCount) &&
        Number.isInteger(stock.breakCount) &&
        stock.breakCount >= 0,
    );
  const oneWordCount = sealProcessReady
    ? sealedDetails.filter(
        ({ stock }) =>
          stock?.firstTouch === '09:25' && (stock.breakCount ?? 0) === 0,
      ).length
    : 0;
  const intradayTouchCount = sealProcessReady
    ? sealedDetails.filter(({ stock }) => stock!.firstTouch !== '09:25').length
    : 0;
  const reopenedCount = sealProcessReady
    ? sealedDetails.filter(({ stock }) => stock!.breakCount! > 0).length
    : 0;
  const participation = !sealedDetails.length
    ? '暂无成功晋级样本'
    : !sealProcessReady
      ? '首触时间或开板记录不完整，封板过程不能完整描述'
      : `封板记录：09:25首触且记录0次开板${oneWordCount}/${sealedDetails.length}只；盘中首触${intradayTouchCount}/${sealedDetails.length}只；记录开板后当前封住${reopenedCount}/${sealedDetails.length}只。换手承接未确认`;

  const mainFamily = mainHighRows.length
    ? main
    : (families.find((f) => f.started > 0) ?? main);
  const marketSupportive =
    !facts.stale &&
    (observed.indexMood === '三大指数上涨' || observed.broad === '多数上涨');
  const marketHostile =
    !facts.stale &&
    (observed.indexMood === '三大指数下跌' || observed.broad === '多数下跌');
  const activeContext = facts.stale
    ? '指数与赚钱面为旧快照，仅保留具体时间，不判断当前主动/被动'
    : !observed.indexReady || !observed.breadthReady
      ? '市场参照不全，相对抗跌性待补证据'
      : highPoolDeep.length > 0 && marketSupportive
        ? '市场环境不差但部分候选相对走弱；主动先后以逐股分钟证据为准'
        : highPoolAdvanced > 0 && marketHostile
          ? '市场偏弱仍有候选封住；不能据此推断其带动市场'
          : '市场参照与逐股主动、带动证据分别判断';
  const negativeKnown = core.highFeedback.deepWater.knownCount ?? 0;
  const extremeKnown = core.highFeedback.extreme.knownCount ?? 0;
  const confirmedCores = core.activeCandidates.filter(
    (candidate) => !candidate.provisional,
  );
  const healthyConfirmed =
    confirmedCores.length > 0 &&
    core.highFeedback.state === 'READY' &&
    core.highFeedback.extreme.state === 'READY' &&
    negativeKnown === 0 &&
    extremeKnown === 0 &&
    core.middle.state === 'READY' &&
    core.middle.deepWater === 0 &&
    core.middle.twoDayNegative === 0 &&
    (cohort.consecutive.rate ?? 0) >= 50 &&
    (cohort.consecutive.attemptRate ?? 0) >= 50;
  const highLabel = !core.activeCandidates.length
    ? '高标数据不足'
    : core.retreatWarning
      ? '高位分化 · 中位负反馈预警'
      : extremeKnown > 0 || negativeKnown >= 2
        ? '高位观察池负反馈明显'
        : healthyConfirmed
          ? '核心与接力共振'
          : highPoolAdvanced > 0
            ? '高位仍有承接，群体影响未确认'
            : '空间与情绪角色观察中';
  const highTone: EmotionTone =
    core.retreatWarning || extremeKnown > 0 || negativeKnown >= 2
      ? 'negative'
      : healthyConfirmed
        ? 'positive'
        : core.activeCandidates.length
          ? 'mixed'
          : 'unknown';
  const highSummary = core.summary;

  let relayLabel = '接力数据不足';
  let relayTone: EmotionTone = 'unknown';
  const relaySampleReady =
    judgmentReady && cohort.ready && highRows.length >= 3;
  if (relaySampleReady) {
    relayTone = 'mixed';
    const relayRate = cohort.consecutive.rate ?? 0;
    const relaySealRate = cohort.consecutive.sealRate ?? 0;
    const extremeRisk = relayExtreme.length > 0 || highTone === 'negative';
    const middleBroken =
      middleRows.length >= 2 && middleAdvanced === 0 && middleDeep.length > 0;
    if (
      relayRate < 25 &&
      extremeRisk &&
      (weakPressure === '高' || weakPressure === '极高')
    ) {
      relayLabel = '接力退潮';
      relayTone = 'negative';
    } else if (
      extremeRisk &&
      (weakPressure === '高' || weakPressure === '极高' || middleBroken)
    ) {
      relayLabel = '局部晋级 · 失败侧承压';
      relayTone = 'negative';
    } else if (relayRate >= 50 && relaySealRate >= 75) {
      const fullStrength =
        weakPressure === '低' &&
        !extremeRisk &&
        !middleBroken &&
        !mainFamily.gaps.length &&
        Boolean(industryRelay);
      relayLabel = fullStrength ? '接力偏强' : '接力有承接';
      relayTone = fullStrength ? 'positive' : 'mixed';
    } else if (relayRate >= 50 && relaySealRate < 75) {
      relayLabel = '接力分歧';
    } else if (relayRate < 50 && relaySealRate >= 75) {
      relayLabel = '高位接力未确认';
    } else {
      relayLabel = '接力偏弱';
      relayTone = 'negative';
    }
  }
  const relaySummary =
    relayLabel === '局部晋级 · 失败侧承压'
      ? '仍有候选晋级和封住，但失败侧出现深水或极端负反馈。成功者的封板率不能抵消掉队者的亏损压力，需观察负反馈是否向中位及次日扩散。'
      : relayLabel === '接力偏强'
        ? '候选愿意进攻、触板后大多封住，弱侧代价低，并出现同一行业的层级传递线索。'
        : relayLabel === '接力有承接'
          ? '晋级和封板达到基础承接线，但高标、弱侧、断层或主线关系仍有瑕疵。'
          : relayLabel === '接力分歧'
            ? '敢冲的候选不算少，但触板后站不稳，接力意愿与稳定性发生分离。'
            : relayLabel === '高位接力未确认'
              ? '少数冲板股封得住，但真正发起晋级的候选不足，不能因封板率漂亮就判强。'
              : relayLabel === '接力退潮'
                ? '晋级意愿低、失败代价扩大，高标或中位负反馈已形成扩散。'
                : relayLabel === '接力数据不足'
                  ? '候选少于3只或相邻交易日样本不完整，只展示个股事实，不做强弱定性。'
                  : '晋级不足且封板稳定性不高，接力在变差，但是否退潮还要看负反馈扩散。';
  const compare =
    previous &&
    adjacentCloses(facts, previous) &&
    contextReady &&
    completeStructure(previous)
      ? {
          date: previous.date,
          up: facts.limitUp - previous.limitUp,
          down: facts.limitDown - previous.limitDown,
          seal:
            observed.sealRate !== null &&
            emotionReading(previous).sealRate !== null
              ? observed.sealRate - emotionReading(previous).sealRate!
              : null,
          height: facts.highestBoard - previous.highestBoard,
          consecutive: facts.consecutiveCount! - previous.consecutiveCount!,
        }
      : null;
  let transition = '单时点观察，暂不判定修复或退潮';
  if (compare) {
    const strongImproved =
      (compare.seal ?? 0) >= 5 && compare.up > 0 && compare.consecutive >= 0;
    const strongWorse = (compare.seal ?? 0) <= -5 && compare.up < 0;
    if (strongImproved && compare.down > 0)
      transition = '强端回暖，弱侧仍在扩大';
    else if (strongWorse && compare.down < 0)
      transition = '封板转弱，跌停收敛 · 不是全面修复';
    else if (
      (strongWorse || compare.height < 0) &&
      compare.down > 0 &&
      compare.consecutive < 0
    )
      transition = '接力收缩、弱侧扩大 · 退潮压力';
    else if (strongImproved && compare.down <= 0)
      transition =
        consecutiveQuotesComplete &&
        relayNegativeRatio !== null &&
        relayNegativeRatio <= 25
          ? '强端扩散、弱侧未扩大 · 修复迹象'
          : '封板端改善 · 高位修复待核';
    else transition = '强弱信号交错 · 继续看承接';
  }
  const relayDirection = !compare
    ? '单时点'
    : (compare.seal ?? 0) >= 5 && compare.up > 0 && compare.consecutive >= 0
      ? relayTone === 'negative'
        ? '修复'
        : '强化'
      : ((compare.seal ?? 0) <= -5 && compare.up < 0) ||
          (compare.height < 0 && compare.consecutive < 0)
        ? relayTone === 'negative'
          ? '恶化'
          : '降温'
        : '稳定';
  const missing = [
    !structureReady && !useSupplied && '当日完整涨停梯队未齐',
    !cohort.ready && '缺少相邻交易日完整涨停名单，不能确认接力',
    useSupplied &&
      stateMismatches.length > 0 &&
      `当日首板池与梯队接口存在${stateMismatches.length}只瞬时差异；高标与昨日连板身份已核对，低位补充按降级展示`,
    cohort.ready &&
      !quoteComplete &&
      `昨日涨停股当日价格覆盖${cohort.all.priceReady}/${cohort.all.count}，不计算不完整样本收益中位数`,
    facts.stale &&
      (useSupplied
        ? '指数、涨跌家数为同日最近成功快照；高标与接力已独立使用当前梯队证据'
        : '最近成功结果，非当前实时，不合成当前情绪'),
    !consecutiveQuotesComplete &&
      '昨日连板股当日价格未齐，弱侧压力和接力溢价不定性',
    !sealProcessReady &&
      highPoolAdvanced > 0 &&
      '成功晋级股首触或开板记录不全，封板过程描述不完整',
    '缺少概念级主线身份、预期差和核心带动关系；行业聚类仅作接力线索',
    facts.cutoff === '15:00' && '收盘快照不能还原竞价、盘中承接或反核路径',
  ].filter(Boolean) as string[];
  const highEvidence = [
    {
      label: '当前角色观察',
      value:
        '召回' +
        core.activeCandidates.length +
        '只 · 有题材响应' +
        core.activeCandidates.filter(
          (candidate) => candidate.interpretation.influence.groups.length > 0,
        ).length +
        '只（非龙头认证）',
      detail: core.activeCandidates.length
        ? core.activeCandidates
            .map((candidate) => candidate.name + '：' + candidate.currentRole)
            .join('；')
        : '缺可验证身份，不以普通首板补池。',
      state: core.activeCandidates.length ? 'READY' : 'MISSING',
    },
    {
      label: '高标群体反馈',
      value:
        '已知走强' +
        highPoolAdvanced +
        ' · 深水' +
        negativeKnown +
        ' · 跌停' +
        extremeKnown,
      detail:
        '当前报价覆盖' +
        core.highFeedback.covered +
        '/' +
        core.activeCandidates.length +
        '；这些是已知计数，缺失不视为0，也不与接力分母互换。',
      state: core.highFeedback.state,
    },
    {
      label: '中位吹哨',
      value:
        (core.middle.promoted ?? '—') +
        '/' +
        (core.middle.denominator ?? '—') +
        '晋级 · 已知深水' +
        core.middle.deepWaterKnown +
        '只',
      detail:
        core.middle.detail +
        ' 连续两日负反馈已知' +
        core.middle.twoDayNegativeKnown +
        '只，覆盖' +
        core.middle.twoDayCovered +
        '/' +
        core.middle.sampleCount +
        '。' +
        core.middle.spread.detail,
      state: core.middle.state,
    },
    {
      label: '相对强弱与主动性',
      value: activeContext,
      detail:
        '相对表现不是因果。九维证据逐股列出；无分钟不能判主动回封或带动先后。',
      state: facts.stale ? 'DEGRADED' : 'READY',
    },
  ];
  const relayEvidence = [
    {
      label: '候选与尝试',
      value: cohort.ready
        ? `${cohort.consecutive.attempts}/${cohort.consecutive.count}触及晋级板 · ${cohort.consecutive.attemptRate?.toFixed(1) ?? '—'}%`
        : '—',
      detail: '尝试率回答“敢不敢冲”，分母固定为昨日2板及以上候选。',
      state: cohort.ready ? 'READY' : 'MISSING',
    },
    {
      label: '晋级与封住',
      value: cohort.ready
        ? `${cohort.consecutive.advanced}/${cohort.consecutive.count}晋级 · 接力封板率${cohort.consecutive.sealRate?.toFixed(1) ?? '—'}%`
        : '—',
      detail: '晋级率看最终交棒；接力封板率只在触及晋级板的候选中计算。',
      state: cohort.ready ? 'READY' : 'MISSING',
    },
    {
      label: '昨日接力反馈',
      value: consecutiveQuotesComplete
        ? `收盘涨跌幅中位数 ${pctText(cohort.consecutive.median)}`
        : `${cohort.consecutive.priceReady}/${cohort.consecutive.count}只价格可用`,
      detail: '当前只有相对昨收的收盘反馈，不冒充开盘溢价或真实买入收益。',
      state: consecutiveQuotesComplete ? 'READY' : 'DEGRADED',
    },
    {
      label: '失败成本',
      value: `${weakPressure} · 深水${core.feedback.deepWater ?? '—'}只 · 极端${core.feedback.extreme ?? '—'}只`,
      detail: core.feedback.detail,
      state: core.feedback.state,
    },
    {
      label: '梯队与主线',
      value: industryRelay
        ? `${industryRelay.industry} ${industryRelay.advanced}/${industryRelay.count}晋级`
        : '未发现可靠的同一行业接力簇',
      detail: mainFamily.gaps.length
        ? `${mainFamily.name}${mainFamily.gaps.join('、')}板空层；行业不等于概念主线。`
        : `${mainFamily.name}当前无板数空层；概念主线关系仍待数据。`,
      state: industryRelay ? 'DEGRADED' : 'MISSING',
    },
    {
      label: '晋级股封板记录',
      value: participation,
      detail:
        '盘中首触与开板后封住可重叠。来源首触/开板记录只能描述封板过程；缺少分钟量价与可比量能基线，不能确认健康换手、抛压被消化或实际可参与性。',
      state: sealProcessReady ? 'READY' : 'DEGRADED',
    },
  ];
  const tone: EmotionTone =
    highTone === 'unknown' || relayTone === 'unknown'
      ? 'unknown'
      : highTone === relayTone
        ? highTone
        : (highTone === 'negative' && relayTone !== 'positive') ||
            (relayTone === 'negative' && highTone !== 'positive')
          ? 'negative'
          : 'mixed';
  const label = `${highLabel} · ${relayLabel}${relayDirection === '单时点' ? '' : `｜${relayDirection}`}`;
  return {
    version: 'short-emotion-v2',
    label,
    tone,
    status: !contextReady
      ? facts.status === 'MISSING'
        ? 'MISSING'
        : 'DEGRADED'
      : quoteComplete && stateMismatches.length === 0
        ? 'READY'
        : 'DEGRADED',
    structureReady,
    cohort,
    cohortDate: ladder?.previousTradeDate,
    cohortSource: useSupplied
      ? '同日完整昨日涨停跟踪'
      : derived
        ? '相邻收盘涨停名单逐股对照'
        : '缺失',
    quoteComplete,
    median: quoteComplete ? cohort.all.median : null,
    negative,
    positive,
    weakest,
    oldLeaders,
    families,
    compare,
    transition,
    highBoard: {
      label: highLabel,
      tone: highTone,
      summary: highSummary,
      poolFloor: highPoolFloor,
      rows: highPoolRows,
      recallBasis:
        '高标身份由可解释角色证据合并；最高/次高板仅作为召回条件，不是身份评分。',
      advanced: highPoolAdvanced,
      failed: highPoolFailed,
      deep: highPoolDeep,
      extreme: highPoolExtreme,
      activeContext,
      evidence: highEvidence,
    },
    core,
    relay: {
      label: relayLabel,
      tone: relayTone,
      direction: relayDirection,
      summary: relaySummary,
      candidateCount: cohort.consecutive.count,
      attemptRate: cohort.consecutive.attemptRate,
      promotionRate: cohort.consecutive.rate,
      sealRate: cohort.consecutive.sealRate,
      premiumMedian: consecutiveQuotesComplete
        ? cohort.consecutive.median
        : null,
      weakPressure,
      participation,
      industryRelay,
      evidence: relayEvidence,
    },
    missing,
    caution:
      '高标与接力分别判断：最高板存活不等于接力强，普通晋级较多也不能抵消核心高标的极端负反馈。局部封住≠全面转强；断板≠亏损。缺少分钟路径时不推断反核、弱转强或带动因果。',
  };
}
