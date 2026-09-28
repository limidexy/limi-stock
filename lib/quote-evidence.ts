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

export function parseTencentLiveQuotes(
  text: string,
  codes: string[],
  tradeDate: string,
) {
  const requested = new Set(codes);
  const quotes = new Map<string, StockQuote>();
  for (const line of text.split(/\r?\n|;/)) {
    const match = line.match(/v_(?:sh|sz|bj)(\d{6})="([^"]*)"/);
    if (!match || !requested.has(match[1])) continue;
    const fields = match[2].split('~');
    const code = fields[2];
    const stamp = String(fields[30] ?? '').replace(/\D/g, '');
    if (
      code !== match[1] ||
      stamp.length < 14 ||
      stamp.slice(0, 8) !== tradeDate
    )
      continue;
    const current = Number(fields[3]);
    const previousClose = Number(fields[4]);
    const reportedPct = Number(fields[32]);
    const deal = String(fields[35] ?? '').split('/');
    const amount = Number(deal[2]);
    const changePct = Number.isFinite(reportedPct)
      ? reportedPct
      : Number.isFinite(current) &&
          Number.isFinite(previousClose) &&
          previousClose > 0
        ? (current / previousClose - 1) * 100
        : null;
    if (changePct === null) continue;
    const quoteTime = new Date(
      `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:${stamp.slice(12, 14)}+08:00`,
    ).toISOString();
    quotes.set(code, {
      changePct,
      speedPct: null,
      amount: Number.isFinite(amount) ? amount : null,
      quoteTime,
      quoteSource: '腾讯同交易日实时报价',
    });
  }
  return quotes;
}

export function sameTradeDate(actual: unknown, expected: string) {
  return (
    typeof actual === 'string' &&
    actual.replaceAll('-', '') === expected.replaceAll('-', '') &&
    /^\d{8}$/.test(expected.replaceAll('-', ''))
  );
}
