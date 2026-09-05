import document from './archive-evidence.generated.json';
import type { PriceTrend } from './timeline-evidence';
import type { StockQuote } from './quote-evidence';

type RecordRow = {
  code: string;
  name: string;
  preClose: number | null;
  changePct: number | null;
  amount: number | null;
  points: [string, number][];
};
const evidence = document as unknown as {
  tradeDate: string;
  source: string;
  sourceRetrievedAt: string;
  records: Record<string, RecordRow>;
};

function record(symbol: string, tradeDate: string) {
  return tradeDate === evidence.tradeDate
    ? evidence.records[symbol]
    : undefined;
}

export function archivedTrend(
  symbol: string,
  tradeDate: string,
): PriceTrend | null {
  const row = record(symbol, tradeDate);
  return row
    ? {
        code: row.code,
        name: row.name,
        preClose: row.preClose,
        points: row.points.map(([time, price]) => ({ time, price })),
      }
    : null;
}

export function archivedQuote(
  symbol: string,
  tradeDate: string,
): StockQuote | null {
  const row = record(symbol, tradeDate);
  return row && row.changePct !== null
    ? {
        changePct: row.changePct,
        amount: row.amount,
        speedPct: null,
        quoteTime: `${tradeDate.slice(0, 4)}-${tradeDate.slice(4, 6)}-${tradeDate.slice(6, 8)}T15:00:00+08:00`,
        quoteSource: evidence.source,
      }
    : null;
}
