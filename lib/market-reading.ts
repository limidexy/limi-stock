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
};

export type ReadingLadder = {
  status: string;
  tradeDate?: string;
  previousTradeDate?: string;
  priorDateState?: string;
  sourceState?: string;
  sessionState?: string;
  retrievedAt?: string;
  counts?: { previousLimitUp: number };
  competitors: ReadingCompetitor[];
};

export const compactDate = (date: string | undefined) =>
  (date ?? '').replaceAll('-', '');
export const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
export const percentage = (numerator: number, denominator: number) =>
  denominator > 0 ? (numerator / denominator) * 100 : null;
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
    const changes = input.map((row) => row.changePct).filter(finite);
    return {
      count: input.length,
      advanced,
      failed,
      dropped: input.length - advanced - failed,
      rate: ready ? percentage(advanced, input.length) : null,
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

export type EmotionTone = 'positive' | 'negative' | 'mixed' | 'unknown';

// Independent short-term sentiment: high-board structure + a fixed previous
// limit-up cohort + the failure side. No index or broad-market inputs in the label.
// These are transparent observation rules, not a calibrated strategy/cycle forecast.
export function shortEmotionReading(
  facts: EmotionFacts,
  previous?: EmotionFacts | null,
  suppliedLadder?: ReadingLadder | null,
) {
  const observed = emotionReading(facts);
  const structureReady = completeStructure(facts);
  const stocks = structureReady
    ? uniqueStocks(facts.ladders!.flatMap((level) => level.stocks))
    : [];
  const sourceTime = Date.parse(suppliedLadder?.retrievedAt ?? '');
  const factsTime = Date.parse(facts.retrievedAt ?? '');
  const digits = compactDate(facts.date);
  const closeTime = Date.parse(
    `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}T15:00:00+08:00`,
  );
  const timeAligned =
    facts.cutoff === '15:00'
      ? suppliedLadder?.sessionState === 'CLOSED' &&
        Number.isFinite(sourceTime) &&
        sourceTime >= closeTime
      : suppliedLadder?.sessionState === 'LIVE' &&
        Number.isFinite(sourceTime) &&
        Number.isFinite(factsTime) &&
        sourceTime <= factsTime &&
        factsTime - sourceTime <= 60_000;
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
                quoteTime <= factsTime &&
                factsTime - quoteTime <= 60_000 &&
                new Date(quoteTime + 8 * 3_600_000)
                  .toISOString()
                  .slice(0, 10)
                  .replaceAll('-', '') === digits;
          return { ...row, changePct: priceAligned ? row.changePct : null };
        }),
      }
    : null;
  const supplied = ladderReading(timedLadder, facts.date);
  const stateAligned =
    structureReady &&
    supplied.rows.every((row) => {
      if (
        !['SEALED', 'FAILED', 'DROPPED'].includes(row.state) ||
        row.toHeight !== row.fromHeight + 1
      )
        return false;
      const sealed = stocks.find((stock) => stock.code === row.code);
      return sealed
        ? row.state === 'SEALED' && sealed.height === row.fromHeight + 1
        : row.state !== 'SEALED';
    });
  const priorStocks = previous?.ladders?.flatMap((level) => level.stocks) ?? [];
  const priorAligned =
    previous &&
    completeStructure(previous) &&
    adjacentCloses({ ...facts, cutoff: '15:00' }, previous) &&
    compactDate(previous.date) ===
      compactDate(suppliedLadder?.previousTradeDate) &&
    priorStocks.length === supplied.rows.length &&
    supplied.rows.every((row) =>
      priorStocks.some(
        (stock) => stock.code === row.code && stock.height === row.fromHeight,
      ),
    );
  const useSupplied =
    supplied.ready &&
    timeAligned &&
    stateAligned &&
    priorAligned &&
    !facts.stale;
  const derived = historicalEmotionLadder(facts, previous);
  const ladder = useSupplied ? timedLadder : derived;
  const cohort = useSupplied ? supplied : ladderReading(derived, facts.date);
  const quoteComplete =
    cohort.ready &&
    cohort.all.count > 0 &&
    cohort.all.priceReady === cohort.all.count;
  const rows = cohort.ready && !facts.stale ? cohort.rows : [];
  const highRows = rows.filter((row) => row.fromHeight >= 2);
  const negative = highRows.filter(
    (row) => finite(row.changePct) && row.changePct < 0,
  );
  const positive = highRows.filter(
    (row) => finite(row.changePct) && row.changePct > 0,
  );
  const rate = cohort.ready ? cohort.consecutive.rate : null;
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
  const classificationRows = mainHighRows.length ? mainHighRows : highRows;
  const negativeRatio =
    classificationRows.length &&
    classificationRows.every((row) => finite(row.changePct))
      ? classificationRows.filter((row) => row.changePct! < 0).length /
        classificationRows.length
      : null;
  const mainMiddleHigh = mainHighRows.filter((stock) => stock.fromHeight >= 3);
  const highestPrior = Math.max(
    0,
    ...highRows.map((stock) => stock.fromHeight),
  );
  const oldLeaders = highRows.filter(
    (stock) => stock.fromHeight === highestPrior,
  );
  const weakest = [...negative].sort(
    (a, b) => b.fromHeight - a.fromHeight || a.changePct! - b.changePct!,
  );
  const ready =
    facts.status !== 'MISSING' &&
    !facts.stale &&
    observed.poolsReady &&
    structureReady;
  let label = '情绪证据待补';
  let tone: EmotionTone = 'unknown';
  if (ready) {
    tone = 'mixed';
    const classificationRate = main.started
      ? percentage(main.advanced, main.started)
      : rate;
    const weakRelay = classificationRate !== null && classificationRate < 25;
    const strongRelay = classificationRate !== null && classificationRate >= 50;
    const pressure =
      facts.limitDown >= 5 && facts.limitDown >= facts.limitUp * 0.15;
    if (facts.limitUp + facts.failed === 0) {
      label = '暂无触板样本 · 情绪待观察';
      tone = 'unknown';
    } else if (classificationRows.length > 0 && classificationRows.length < 3) {
      label = '接力样本较少 · 暂看个股';
    } else if (
      mainMiddleHigh.length >= 3 &&
      mainMiddleHigh.every((stock) => stock.state !== 'SEALED') &&
      pressure
    ) {
      label = '主板高位断层 · 弱侧承压';
      tone = 'negative';
    } else if (weakRelay && negativeRatio !== null && negativeRatio >= 0.5) {
      label = '高标分化 · 接力偏弱';
      tone = 'negative';
    } else if (
      classificationRate !== null &&
      classificationRate < 40 &&
      pressure
    ) {
      label = '接力分歧 · 弱侧承压';
      tone = 'negative';
    } else if (
      strongRelay &&
      negativeRatio !== null &&
      negativeRatio <= 0.25 &&
      observed.sealRate !== null &&
      observed.sealRate >= 75 &&
      !pressure &&
      !main.gaps.length
    ) {
      label = '接力偏强 · 强侧占优';
      tone = 'positive';
    } else if (
      main.highest >= 4 &&
      main.gaps.length &&
      observed.sealRate !== null &&
      observed.sealRate < 55
    ) {
      label = '高标孤立 · 封板分歧';
      tone = 'negative';
    } else if (pressure) {
      label = '强弱分化 · 亏损效应仍在';
    } else if (
      strongRelay &&
      observed.sealRate !== null &&
      observed.sealRate >= 75
    ) {
      label = '接力有承接 · 封板较强';
    } else if (observed.sealRate !== null && observed.sealRate >= 75) {
      label = '封板较强 · 接力待核';
    } else {
      label = '情绪分歧 · 承接待观察';
    }
  }
  const compare =
    previous &&
    adjacentCloses(facts, previous) &&
    ready &&
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
        quoteComplete && negativeRatio !== null && negativeRatio <= 0.25
          ? '强端扩散、弱侧未扩大 · 修复迹象'
          : '封板端改善 · 高位修复待核';
    else transition = '强弱信号交错 · 继续看承接';
  }
  const missing = [
    !structureReady && '当日完整涨停梯队未齐',
    !cohort.ready && '缺少相邻交易日完整涨停名单，不能确认接力',
    cohort.ready &&
      !quoteComplete &&
      `昨日涨停股当日价格覆盖${cohort.all.priceReady}/${cohort.all.count}，不计算不完整样本收益中位数`,
    facts.stale && '最近成功结果，非当前实时，不合成当前情绪',
  ].filter(Boolean) as string[];
  return {
    version: 'short-emotion-v1',
    label,
    tone,
    status: !ready
      ? facts.status === 'MISSING'
        ? 'MISSING'
        : 'DEGRADED'
      : quoteComplete
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
    missing,
    caution:
      '局部高标封住≠全面转强；断板≠亏损。本面板归纳情绪结构，逐日反馈与分钟过程见独立“情绪跟踪”；路径缺口不推断反核或带动因果。',
  };
}
