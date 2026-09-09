import type { CloseSnapshot, CloseStock } from './close-history';
import type { StockQuote } from './quote-evidence';

type DataState = 'READY' | 'DEGRADED' | 'MISSING';

const compactDate = (value: string) => value.replaceAll('-', '');

export function buildArchivedLadderSnapshot(
  current: CloseSnapshot,
  previous: CloseSnapshot,
  quotes: Map<string, StockQuote>,
  requestedDate: string,
  options: {
    priorDateState?: DataState;
    priorDateSource?: string;
    priorReason?: string;
  } = {},
) {
  const tradeDate = compactDate(current.date);
  const previousTradeDate = compactDate(previous.date);
  const sealedStocks = current.ladders.flatMap((level) => level.stocks);
  const previousStocks = previous.ladders.flatMap((level) => level.stocks);
  const sealedByCode = new Map(
    sealedStocks.map((stock) => [stock.code, stock]),
  );
  const failedByCode = new Map(
    current.failedStocks.map((stock) => [stock.code, stock]),
  );
  const previousByCode = new Map<string, CloseStock>();
  for (const stock of previousStocks) {
    const prior = previousByCode.get(stock.code);
    if (!prior || stock.height > prior.height)
      previousByCode.set(stock.code, stock);
  }
  const candidates = [...previousByCode.values()];
  const duplicatesRemoved = previousStocks.length - candidates.length;
  const groups = new Map<number, CloseStock[]>();
  for (const stock of candidates)
    groups.set(stock.height, [...(groups.get(stock.height) ?? []), stock]);

  const exactQuote = (code: string) => {
    const archived = current.closeQuotes?.[code];
    if (archived && compactDate(archived.quoteTime.slice(0, 10)) === tradeDate)
      return { changePct: archived.changePct, source: archived.source };
    const quote = quotes.get(code);
    if (
      quote?.changePct != null &&
      compactDate(quote.quoteTime?.slice(0, 10) ?? '') === tradeDate
    )
      return { changePct: quote.changePct, source: quote.quoteSource };
    return null;
  };

  const competitors = candidates
    .map((prior) => {
      const sealed = sealedByCode.get(prior.code);
      const failed = failedByCode.get(prior.code);
      const currentStock = sealed ?? failed;
      const quote = quotes.get(prior.code);
      const exact = exactQuote(prior.code);
      const changePct = exact?.changePct ?? currentStock?.changePct ?? null;
      const quoteReady = changePct !== null;
      return {
        code: prior.code,
        name: currentStock?.name ?? prior.name,
        fromHeight: prior.height,
        toHeight: prior.height + 1,
        state: sealed ? 'SEALED' : failed ? 'FAILED' : 'DROPPED',
        changePct,
        speedPct: quote?.speedPct ?? null,
        amount: quote?.amount ?? null,
        firstTouch: currentStock?.firstTouch ?? null,
        lastSeal: sealed?.lastSeal ?? null,
        breakCount: currentStock?.breakCount ?? 0,
        industry: currentStock?.industry ?? prior.industry ?? '未知',
        sealFund: sealed?.sealFund ?? null,
        quoteTime: quote?.quoteTime ?? `${current.date}T15:00:00+08:00`,
        quoteSource: exact?.source ?? quote?.quoteSource ?? '目标交易日收盘池',
        priceQuoteTime: `${current.date}T15:00:00+08:00`,
        priceQuoteSource: '目标交易日收盘归档或同日盘后最终涨跌幅',
        quoteState: (quoteReady ? 'READY' : 'MISSING') as DataState,
      };
    })
    .sort(
      (a, b) =>
        b.toHeight - a.toHeight ||
        (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity) ||
        (b.speedPct ?? -Infinity) - (a.speedPct ?? -Infinity),
    );

  const promotion = [...groups.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([height, stocks]) => {
      const advanced = stocks.filter((stock) => sealedByCode.has(stock.code));
      const failed = stocks.filter((stock) => failedByCode.has(stock.code));
      return {
        fromHeight: height,
        toHeight: height + 1,
        level: `${height}进${height + 1}`,
        started: stocks.length,
        advanced: advanced.length,
        failed: failed.length,
        dropped: stocks.length - advanced.length - failed.length,
        ratePct: stocks.length ? (advanced.length / stocks.length) * 100 : 0,
        lead: advanced
          .slice(0, 3)
          .map((stock) => sealedByCode.get(stock.code)!.name),
      };
    });
  const priceReady = competitors.filter((row) => row.changePct !== null).length;
  const quoteReady = competitors.filter(
    (row) => row.quoteState === 'READY',
  ).length;

  return {
    status: (competitors.length > 0 &&
    quoteReady === competitors.length &&
    options.priorDateState !== 'DEGRADED' &&
    options.priorDateState !== 'MISSING'
      ? 'READY'
      : competitors.length
        ? 'DEGRADED'
        : 'MISSING') as DataState,
    tradeDate,
    requestedDate,
    phase: '休市快照',
    sessionState: 'CLOSED' as const,
    sourceState: 'ARCHIVED' as const,
    previousTradeDate,
    priorDateState: (options.priorDateState ?? 'READY') as DataState,
    priorDateSource:
      options.priorDateSource ?? `${previousTradeDate} 15:00收盘归档`,
    priorProviderQdate: '',
    retrievedAt: new Date().toISOString(),
    source: '目标交易日收盘归档 + 同日个股最终涨跌幅',
    reason:
      quoteReady === competitors.length && !options.priorReason
        ? undefined
        : [
            options.priorReason,
            quoteReady === competitors.length
              ? ''
              : `昨日连板候选收盘涨幅完整${quoteReady}/${competitors.length}只；缺失项未用旧日数据替代`,
          ]
            .filter(Boolean)
            .join('；'),
    counts: {
      previousLimitUp: candidates.length,
      todaySealed: current.limitUp,
      todayFailed: current.failed,
    },
    coverage: {
      competitors: competitors.length,
      quoteReady,
      priceReady,
      speedReady: competitors.filter((row) => row.speedPct !== null).length,
      duplicatesRemoved,
    },
    promotion,
    sealedStocks,
    competitors,
  };
}

export function consecutiveLimitHeight(
  closes: Array<{ date: string; close: number }>,
  endDate: string,
  code: string,
  name: string,
) {
  const rows = closes
    .filter(
      (row) =>
        row.date.replaceAll('-', '') <= endDate &&
        Number.isFinite(row.close) &&
        row.close > 0,
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  if (rows.at(-1)?.date.replaceAll('-', '') !== endDate || rows.length < 2)
    return null;
  const upperName = name.toUpperCase();
  const nominal = upperName.includes('ST')
    ? 5
    : code.startsWith('8') || code.startsWith('9')
      ? 30
      : code.startsWith('300') ||
          code.startsWith('301') ||
          code.startsWith('688')
        ? 20
        : 10;
  const floor =
    nominal === 5 ? 4.7 : nominal === 10 ? 9.5 : nominal === 20 ? 19 : 28.5;
  let height = 0;
  for (let index = rows.length - 1; index > 0; index -= 1) {
    const change = (rows[index].close / rows[index - 1].close - 1) * 100;
    if (change < floor || change > nominal + 1.5) break;
    height += 1;
  }
  return height || null;
}
