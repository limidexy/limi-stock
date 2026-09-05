export type StockQuote = {
  changePct: number | null;
  speedPct: number | null;
  amount: number | null;
  quoteTime?: string;
  quoteSource?: string;
};

export function quoteDate(epoch: unknown) {
  if (typeof epoch !== 'number' || !Number.isFinite(epoch) || epoch <= 0)
    return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date(epoch * 1000))
    .replaceAll('-', '');
}

export function mergeQuoteRows(
  target: Map<string, StockQuote>,
  rows: Array<Record<string, unknown>>,
  codes: string[],
  tradeDate: string,
  source: string,
) {
  const requested = new Set(codes);
  const number = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  for (const row of rows) {
    const code =
      typeof row.f12 === 'string' || typeof row.f12 === 'number'
        ? String(row.f12)
        : '';
    if (!requested.has(code) || quoteDate(row.f124) !== tradeDate) continue;
    const prior = target.get(code);
    target.set(code, {
      changePct: number(row.f3) ?? prior?.changePct ?? null,
      speedPct: number(row.f22) ?? prior?.speedPct ?? null,
      amount: number(row.f6) ?? prior?.amount ?? null,
      quoteTime: new Date(Number(row.f124) * 1000).toISOString(),
      quoteSource: source,
    });
  }
}

export function quoteComplete(quote: StockQuote | undefined | null) {
  return quote?.changePct != null && quote?.speedPct != null;
}

export function sameTradeDate(actual: unknown, expected: string) {
  return (
    typeof actual === 'string' &&
    actual.replaceAll('-', '') === expected.replaceAll('-', '') &&
    /^\d{8}$/.test(expected.replaceAll('-', ''))
  );
}
