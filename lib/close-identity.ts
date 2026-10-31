/**
 * 从收盘归档里取出单只股票在某交易日的空间位置（板高、封板时间、炸板次数、封单）。
 *
 * 只读取归档事实，不做任何推断：归档里没有该股就说明当日不在涨停梯队中，
 * 不因为涨幅榜排得靠前就补一个板高。
 */

export type CloseIdentityView = {
  status: 'READY' | 'DEGRADED' | 'MISSING';
  date: string | null;
  /** 当日连板高度；未涨停或不在梯队中为 null。 */
  height: number | null;
  /** 是否处在当日最高板。 */
  isHighest: boolean;
  highestBoard: number | null;
  firstTouch: string | null;
  lastSeal: string | null;
  breakCount: number | null;
  sealFund: number | null;
  industry: string | null;
  /** 当日全市场涨停家数，用于给板高一个参照。 */
  limitUpTotal: number | null;
  reasons: string[];
};

type Row = Record<string, unknown>;

const num = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const text = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

export function resolveCloseIdentity(
  snapshot: unknown,
  code: string,
): CloseIdentityView {
  const empty: CloseIdentityView = {
    status: 'MISSING',
    date: null,
    height: null,
    isHighest: false,
    highestBoard: null,
    firstTouch: null,
    lastSeal: null,
    breakCount: null,
    sealFund: null,
    industry: null,
    limitUpTotal: null,
    reasons: [],
  };
  if (!snapshot || typeof snapshot !== 'object') {
    return { ...empty, reasons: ['该交易日没有收盘归档。'] };
  }
  const record = snapshot as Row;
  const date = text(record.date);
  if (!date) return { ...empty, reasons: ['收盘归档缺少日期。'] };

  const highestBoard = num(record.highestBoard);
  const limitUpTotal = num(record.limitUp);
  const ladders = Array.isArray(record.ladders) ? (record.ladders as Row[]) : [];

  let found: Row | null = null;
  let height: number | null = null;
  for (const ladder of ladders) {
    const stocks = Array.isArray(ladder.stocks) ? (ladder.stocks as Row[]) : [];
    const hit = stocks.find((stock) => stock.code === code);
    if (hit) {
      found = hit;
      height = num(ladder.height);
      break;
    }
  }

  const base: CloseIdentityView = {
    ...empty,
    status: 'READY',
    date,
    highestBoard,
    limitUpTotal,
  };

  if (!found) {
    return {
      ...base,
      reasons: ['当日收盘归档的涨停梯队里没有该股（未涨停或未封住）。'],
    };
  }

  return {
    ...base,
    height,
    isHighest: height != null && height === highestBoard && height >= 2,
    firstTouch: text(found.firstTouch),
    lastSeal: text(found.lastSeal),
    breakCount: num(found.breakCount),
    sealFund: num(found.sealFund),
    industry: text(found.industry),
  };
}
