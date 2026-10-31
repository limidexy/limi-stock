/**
 * 股票池口径。
 *
 * 退市整理期的个股简称带「退」（如「萃华退」），它们仍在交易、也会有涨跌幅，
 * 但已经不属于可跟踪的标的池，进榜只会污染涨幅与涨速排序，因此统一排除。
 *
 * ST / *ST 只是风险警示，仍在正常交易，不在此列——不替用户做这层过滤。
 */

/** 简称带「退」即视为退市整理期个股。 */
export function isDelistedName(name: string): boolean {
  const value = String(name ?? '').replaceAll(' ', '');
  if (!value) return false;
  return value.includes('退市') || value.startsWith('退') || value.endsWith('退');
}

export function splitDelisted<T extends { name: string }>(rows: readonly T[]) {
  const kept: T[] = [];
  const excluded: T[] = [];
  for (const row of rows) {
    if (isDelistedName(row.name)) excluded.push(row);
    else kept.push(row);
  }
  return { kept, excluded };
}
