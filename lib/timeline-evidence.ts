export type PriceTrend = {
  code: string;
  name: string;
  preClose: number | null;
  points: Array<{ time: string; price: number }>;
  stale?: boolean;
  intervalMinutes?: number;
  source?: string;
};

export function parseTrendPoints(rows: unknown[], tradeDate: string) {
  return rows
    .flatMap((row) => {
      // Requested fields: timestamp, open, close, high, low, volume, amount, average.
      const [stamp, , close] = String(row).split(',');
      const price = Number(close);
      return stamp.slice(0, 10).replaceAll('-', '') === tradeDate &&
        Number.isFinite(price) &&
        price > 0
        ? [{ time: stamp.slice(11, 16), price }]
        : [];
    })
    .sort((a, b) => a.time.localeCompare(b.time));
}

function tradingMinute(time: string) {
  const [h, m] = time.split(':').map(Number);
  const minute = h * 60 + m;
  return minute >= 13 * 60 ? minute - 90 : minute;
}

export function trendWindow(
  trend: PriceTrend,
  startTime: string,
  endTime: string,
) {
  const atOrBefore = (time: string) => {
    const point = [...trend.points].reverse().find((p) => p.time <= time);
    return point && tradingMinute(time) - tradingMinute(point.time) <= 1
      ? point
      : null;
  };
  const start = atOrBefore(startTime);
  const end = atOrBefore(endTime);
  return {
    changePct:
      end && trend.preClose ? (end.price / trend.preClose - 1) * 100 : null,
    windowChangePct: start && end ? (end.price / start.price - 1) * 100 : null,
    price: end?.price ?? null,
  };
}

export function priceLimitState(
  code: string,
  name: string,
  price: number | null,
  preClose: number | null,
) {
  if (price === null || !preClose || /^[NC]/i.test(name))
    return 'UNKNOWN' as const;
  // STAR and ChiNext retain their board limit when risk-warning names apply.
  const rate = /^[489]/.test(code)
    ? 0.3
    : /^(30|68)/.test(code)
      ? 0.2
      : /ST/i.test(name)
        ? 0.05
        : 0.1;
  const up = Math.round((preClose * (1 + rate) + Number.EPSILON) * 100) / 100;
  const down = Math.round((preClose * (1 - rate) + Number.EPSILON) * 100) / 100;
  if (Math.abs(price - up) < 0.005) return 'LIMIT_UP' as const;
  if (Math.abs(price - down) < 0.005) return 'LIMIT_DOWN' as const;
  return 'NONE' as const;
}

type HeadlineEvent = {
  sectorName: string;
  kind: string;
  flowDelta: number;
  drivers: Array<{
    code: string;
    name: string;
    atTimeChangePct?: number | null;
    windowChangePct: number | null;
    limitState?: string;
    role: string;
  }>;
};

export function timelineHeadline(event: HeadlineEvent) {
  const rising = event.flowDelta >= 0;
  const expected = rising ? 'LIMIT_UP' : 'LIMIT_DOWN';
  const drivers = [...new Map(event.drivers.map((d) => [d.code, d])).values()];
  const limits = drivers.filter(
    (d) => d.limitState === expected && Number.isFinite(d.atTimeChangePct),
  );
  const compact = (name: string) => name.replace(/\s+/g, '');
  const aligned = drivers
    .filter(
      (d) => d.role === '同窗价格确认' && Number.isFinite(d.atTimeChangePct),
    )
    .sort((a, b) =>
      rising
        ? (b.windowChangePct ?? 0) - (a.windowChangePct ?? 0)
        : (a.windowChangePct ?? 0) - (b.windowChangePct ?? 0),
    );
  const action =
    event.kind === 'STRONG'
      ? '延续活跃'
      : event.kind === 'START'
        ? '异动拉升'
        : event.kind === 'CASHOUT'
          ? '出现兑现'
          : event.kind === 'WEAKEN'
            ? '持续走弱'
            : '震荡观察';
  const stocks = limits.length
    ? `${limits.map((d) => compact(d.name)).join('、')}${rising ? '涨停' : '跌停'}`
    : aligned.length
      ? `${aligned
          .slice(0, 4)
          .map(
            (d) =>
              `${compact(d.name)}${d.atTimeChangePct! >= 0 ? '+' : ''}${d.atTimeChangePct!.toFixed(2)}%`,
          )
          .join('、')}${rising ? '同步走强' : '同步回落'}`
      : '节点个股行情暂不完整';
  return `${event.sectorName}${action}，${stocks}`;
}
