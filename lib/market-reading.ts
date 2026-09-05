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
};

export type ReadingLadder = {
  status: string;
  tradeDate?: string;
  previousTradeDate?: string;
  priorDateState?: string;
  sourceState?: string;
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
  cutoff: string;
  status: string;
  stale?: boolean;
  poolsReady: boolean;
  breadthReady: boolean;
  limitUp: number;
  failed: number;
  limitDown: number;
  highestBoard: number;
  breadth: {
    up: number;
    down: number;
    flat: number;
    rowsAvailable: number;
    medianChangePct: number | null;
  };
  indices?: Array<{ code: string; name: string; changePct: number | null }>;
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
