import { priceLimitState } from './timeline-evidence.ts';
import type { PriceTrend } from './timeline-evidence';

export type ExtremePathEvidence = {
  code: string;
  date: string;
  observedAt: string;
  source: string;
  status: 'READY' | 'DEGRADED' | 'MISSING';
  skyFloor: boolean | null;
  upTime: string | null;
  downTime: string | null;
  points: number;
  reason: string;
};
const minute = (time: string): number | null => {
  if (!/^\d{2}:\d{2}$/.test(time)) return null;
  const [h, m] = time.split(':').map(Number),
    n = h * 60 + m;
  if (n >= 570 && n <= 690) return n;
  if (n >= 781 && n <= 900) return n - 90;
  return null;
};

/** Confirm an observed limit-up -> limit-down sequence from complete 1m prices.
 * Daily high/low and 5m points can never supply this predicate. The instrument's
 * rounded price limit uses the same existing 5/10/20/30cm rules as the timeline.
 */
export function extremePathObservation(
  date: string,
  stock: { code: string; name: string },
  trend: PriceTrend | undefined,
  cutoff: string,
): ExtremePathEvidence {
  const base: ExtremePathEvidence = {
    code: stock.code,
    date,
    observedAt: `${date}T${cutoff}:00+08:00`,
    source: trend?.source ?? '精确日期分钟行情',
    status: 'MISSING',
    skyFloor: null,
    upTime: null,
    downTime: null,
    points: 0,
    reason: '缺少完整1分钟路径，不能从日线高低价倒推天地板',
  };
  if (
    !trend ||
    trend.stale ||
    !Number.isFinite(trend.preClose) ||
    !trend.preClose ||
    trend.preClose <= 0
  )
    return base;
  if ((trend.intervalMinutes ?? 1) !== 1)
    return {
      ...base,
      status: 'DEGRADED',
      reason: '非1分钟路径，不确认天地板先后',
    };
  const times = new Set<string>();
  const raw = trend.points.filter((p) => p.time <= cutoff);
  if (raw.some((p) => times.has(p.time) || !times.add(p.time)))
    return { ...base, reason: '分钟时间戳重复，拒绝构造先后' };
  const points = raw
    .filter(
      (p) => minute(p.time) !== null && Number.isFinite(p.price) && p.price > 0,
    )
    .sort((a, b) => a.time.localeCompare(b.time));
  if (
    points.length < 5 ||
    points[0].time > '09:31' ||
    points.at(-1)?.time !== cutoff ||
    points.some(
      (p, i) =>
        i > 0 &&
        minute(p.time)! - minute(points[i - 1].time)! !== 1 &&
        !(p.time === '15:00' && points[i - 1].time === '14:57'),
    )
  )
    return { ...base, points: points.length };
  if (
    priceLimitState(stock.code, stock.name, points[0].price, trend.preClose) ===
    'UNKNOWN'
  )
    return {
      ...base,
      points: points.length,
      reason: '该股票适用涨跌停边界未确认，拒绝用固定百分比认定天地板',
    };
  let upTime: string | null = null,
    downTime: string | null = null;
  for (const p of points) {
    const state = priceLimitState(
      stock.code,
      stock.name,
      p.price,
      trend.preClose,
    );
    if (!upTime && state === 'LIMIT_UP') upTime = p.time;
    if (upTime && p.time > upTime && state === 'LIMIT_DOWN') {
      downTime = p.time;
      break;
    }
  }
  return {
    ...base,
    status: 'READY',
    skyFloor: Boolean(upTime && downTime),
    upTime,
    downTime,
    points: points.length,
    reason: downTime
      ? `完整1分钟价格先于${upTime}触及适用涨停价，后于${downTime}触及适用跌停价`
      : '完整分钟收盘价格中未见涨停后跌停；不代表排除了分钟内未被采样的触价',
  };
}
