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
  counts?: { previousLimitUp: number };
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

// High-board and relay are deliberately judged separately. Relay uses the fixed
// previous consecutive-board cohort; high-board uses the top relative tiers and
// their failure posture. Index/breadth are only a relative-strength context, never
// a substitute for the cohort. These are descriptive rules, not a prediction.
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
  const stateMismatches = structureReady
    ? supplied.rows.filter((row) => {
        if (
          !['SEALED', 'FAILED', 'DROPPED'].includes(row.state) ||
          row.toHeight !== row.fromHeight + 1
        )
          return true;
        const sealed = stocks.find((stock) => stock.code === row.code);
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
    structureReady &&
    !stateMismatches.some((row) => row.fromHeight >= 2) &&
    stateMismatches.length <= toleratedFirstBoardDrift;
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
  const mainMiddleHigh = mainHighRows.filter((stock) => stock.fromHeight >= 3);
  const highestPrior = Math.max(
    0,
    ...highRows.map((stock) => stock.fromHeight),
  );
  const oldLeaders = highRows.filter(
    (stock) => stock.fromHeight === highestPrior,
  );
  const highPoolHeights = [
    ...new Set(highRows.map((stock) => stock.fromHeight)),
  ]
    .sort((a, b) => b - a)
    .slice(0, 2);
  const highPoolFloor = highPoolHeights.at(-1) ?? 0;
  const highPoolRows = highRows.filter((stock) =>
    highPoolHeights.includes(stock.fromHeight),
  );
  const middleRows = highRows.filter(
    (stock) => stock.fromHeight < highPoolFloor,
  );
  const highPoolAdvanced = highPoolRows.filter(
    (stock) => stock.state === 'SEALED',
  ).length;
  const highPoolFailed = highPoolRows.filter(
    (stock) => stock.state === 'FAILED',
  ).length;
  const highPoolQuoted = highPoolRows.filter((stock) =>
    finite(stock.changePct),
  );
  const highPoolNegative = highPoolQuoted.filter(
    (stock) => stock.changePct! < 0,
  );
  const highPoolDeep = highPoolQuoted.filter(
    (stock) => stock.state !== 'SEALED' && stock.changePct! <= -5,
  );
  const highPoolExtreme = highPoolQuoted.filter(
    (stock) => stock.state !== 'SEALED' && stock.changePct! <= -9,
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
  const ready =
    facts.status !== 'MISSING' &&
    !facts.stale &&
    observed.poolsReady &&
    structureReady;
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
        stock.firstTouch !== undefined &&
        stock.breakCount !== undefined,
    );
  const oneWordCount = sealProcessReady
    ? sealedDetails.filter(
        ({ stock }) =>
          stock?.firstTouch === '09:25' && (stock.breakCount ?? 0) === 0,
      ).length
    : 0;
  const turnoverCount = sealProcessReady
    ? sealedDetails.length - oneWordCount
    : 0;
  const participation = !sealedDetails.length
    ? '暂无成功晋级样本'
    : !sealProcessReady
      ? '封板过程待补，不能判断一字或换手'
      : oneWordCount === sealedDetails.length
        ? `一致型接力为主（${oneWordCount}/${sealedDetails.length}），强度高但参与性低`
        : turnoverCount >= oneWordCount
          ? `换手型接力为主（${turnoverCount}/${sealedDetails.length}），承接经过盘中交易检验`
          : `一致与换手并存（一致${oneWordCount}、换手${turnoverCount}）`;

  const mainFamily = mainHighRows.length
    ? main
    : (families.find((f) => f.started > 0) ?? main);
  const marketSupportive =
    observed.indexMood === '三大指数上涨' || observed.broad === '多数上涨';
  const marketHostile =
    observed.indexMood === '三大指数下跌' || observed.broad === '多数下跌';
  const activeContext =
    !observed.indexReady || !observed.breadthReady
      ? '指数或赚钱面不完整，主动/被动强弱不定性'
      : highPoolDeep.length > 0 && marketSupportive
        ? '环境不差而高标深水，偏主动走弱'
        : highPoolAdvanced > 0 && marketHostile
          ? '环境偏弱仍有高标晋级，显示相对抗跌'
          : '高标表现与市场环境大体同向';

  let highLabel = '高标数据不足';
  let highTone: EmotionTone = 'unknown';
  if (ready && highPoolRows.length > 0) {
    highTone = 'mixed';
    const highRate = highPoolAdvanced / highPoolRows.length;
    const lowSupport = (cohort.first.rate ?? 0) >= 25;
    const relaySupport = (rate ?? 0) >= 50;
    const severeSpread = highPoolExtreme.length > 0 || highPoolDeep.length >= 2;
    const mainBoardBreak =
      mainMiddleHigh.length >= 3 &&
      mainMiddleHigh.every((stock) => stock.state !== 'SEALED') &&
      facts.limitDown >= 5 &&
      facts.limitDown >= facts.limitUp * 0.15;
    if (mainBoardBreak) {
      highLabel = '主板高位断层';
      highTone = 'negative';
    } else if (highPoolAdvanced === 0 && severeSpread) {
      highLabel = marketSupportive ? '高标主动走弱' : '高标负反馈扩大';
      highTone = 'negative';
    } else if (
      highPoolAdvanced === 0 &&
      highPoolRows.length >= 2 &&
      highPoolNegative.length === highPoolRows.length &&
      (highPoolDeep.length > 0 || (rate ?? 0) < 25)
    ) {
      highLabel = '高标退潮';
      highTone = 'negative';
    } else if (
      highRate >= 0.5 &&
      relaySupport &&
      lowSupport &&
      !mainFamily.gaps.length
    ) {
      highLabel = severeSpread ? '高标有承接' : '高标一致强';
      highTone = severeSpread ? 'mixed' : 'positive';
    } else if (highRate >= 0.5 && (!relaySupport || !lowSupport)) {
      highLabel = '高标抱团';
      highTone = 'mixed';
    } else if (highPoolAdvanced > 0) {
      highLabel = highPoolRows.length >= 3 ? '高标淘汰赛' : '高标分歧';
    } else {
      highLabel = '高标分歧';
    }
  }
  const highSummary =
    highLabel === '高标一致强'
      ? '最高两档多数完成晋级，中低位仍有补充，当前更接近高标生态共振。'
      : highLabel === '高标抱团'
        ? '少数高标仍强，但中低位承接或低位补充不足，不能把核心存活当成整体情绪强。'
        : highLabel === '主板高位断层'
          ? '主板昨日3板及以上集体未晋级，同时跌停压力不低；独立20cm高标不能掩盖主板传棒断裂。'
          : highLabel === '高标主动走弱'
            ? '市场环境并不差，但高标出现深水负反馈，说明核心筹码自身承接在减弱。'
            : highLabel === '高标负反馈扩大' || highLabel === '高标退潮'
              ? '最高两档晋级受阻且深水负反馈增加，风险正从失败个股向高标池扩散。'
              : highLabel === '高标数据不足'
                ? '缺少完整高标池或准确反馈，不用最高板数字代替高标生态。'
                : '高标池同时出现晋级与淘汰，当前重点看负反馈是否继续向中位扩散。';

  let relayLabel = '接力数据不足';
  let relayTone: EmotionTone = 'unknown';
  const relaySampleReady = ready && cohort.ready && highRows.length >= 3;
  if (relaySampleReady) {
    relayTone = 'mixed';
    const relayRate = cohort.consecutive.rate ?? 0;
    const relaySealRate = cohort.consecutive.sealRate ?? 0;
    const extremeRisk = relayExtreme.length > 0 || highLabel === '高标退潮';
    const middleBroken =
      middleRows.length >= 2 && middleAdvanced === 0 && middleDeep.length > 0;
    if (
      relayRate < 25 &&
      extremeRisk &&
      (weakPressure === '高' || weakPressure === '极高')
    ) {
      relayLabel = '接力退潮';
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
    relayLabel === '接力偏强'
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
    !structureReady && '当日完整涨停梯队未齐',
    !cohort.ready && '缺少相邻交易日完整涨停名单，不能确认接力',
    useSupplied &&
      stateMismatches.length > 0 &&
      `当日首板池与梯队接口存在${stateMismatches.length}只瞬时差异；高标与昨日连板身份已核对，低位补充按降级展示`,
    cohort.ready &&
      !quoteComplete &&
      `昨日涨停股当日价格覆盖${cohort.all.priceReady}/${cohort.all.count}，不计算不完整样本收益中位数`,
    facts.stale && '最近成功结果，非当前实时，不合成当前情绪',
    !consecutiveQuotesComplete &&
      '昨日连板股当日价格未齐，弱侧压力和接力溢价不定性',
    !sealProcessReady &&
      highPoolAdvanced > 0 &&
      '成功晋级股封板过程不全，不能区分一致型与换手型接力',
    '缺少概念级主线身份、预期差和核心带动关系；行业聚类仅作接力线索',
    facts.cutoff === '15:00' && '收盘快照不能还原竞价、盘中承接或反核路径',
  ].filter(Boolean) as string[];
  const highEvidence = [
    {
      label: '动态高标池',
      value: highPoolRows.length
        ? `昨${highPoolFloor}板及以上 ${highPoolRows.length}只`
        : '待补',
      detail: highPoolRows.length
        ? highPoolRows
            .map((row) => `${row.name}（昨${row.fromHeight}板）`)
            .join('、')
        : '没有用固定“4板以上”机械定义高标。',
      state: highPoolRows.length ? 'READY' : 'MISSING',
    },
    {
      label: '集体反馈',
      value: highPoolRows.length
        ? `${highPoolAdvanced}/${highPoolRows.length}晋级 · ${highPoolFailed}只触板未封`
        : '—',
      detail: `深水断板${highPoolDeep.length}只，极端负反馈${highPoolExtreme.length}只。`,
      state:
        highPoolQuoted.length === highPoolRows.length ? 'READY' : 'DEGRADED',
    },
    {
      label: '中位吹哨',
      value: middleRows.length
        ? `${middleAdvanced}/${middleRows.length}晋级 · 深水${middleDeep.length}只`
        : '暂无独立中位样本',
      detail: '中位先恶化时，即使最高板仍封住，也不能判断生态健康。',
      state: cohort.ready ? 'READY' : 'MISSING',
    },
    {
      label: '低位补充',
      value: cohort.ready
        ? `${cohort.first.advanced}/${cohort.first.count}首板晋级`
        : '—',
      detail: '用1进2观察后续接棒者，不用首板总数替代。',
      state: cohort.ready ? 'READY' : 'MISSING',
    },
    {
      label: '主动 / 被动',
      value: activeContext,
      detail: '只做环境对照；没有分钟路径时不声称弱转强、地天或主动回封。',
      state:
        observed.indexReady && observed.breadthReady ? 'READY' : 'DEGRADED',
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
      value: `${weakPressure} · 深水${relayDeep.length}只 · 极端${relayExtreme.length}只`,
      detail: '相同晋级率下，失败者是否深水、跌停，决定下一棒还敢不敢接。',
      state: consecutiveQuotesComplete ? 'READY' : 'DEGRADED',
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
      label: '接力类型 / 参与性',
      value: participation,
      detail: '一字强度与换手承接分开；强不等于好参与。',
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
    status: !ready
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
      advanced: highPoolAdvanced,
      failed: highPoolFailed,
      deep: highPoolDeep,
      extreme: highPoolExtreme,
      activeContext,
      evidence: highEvidence,
    },
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
