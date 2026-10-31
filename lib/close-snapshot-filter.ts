/**
 * 收盘快照的股票池口径：剔除退市整理期个股，并同步重算受影响的统计量。
 *
 * 单独成文件是为了让纯逻辑能被 node 直接跑测试——close-history.ts 会连带加载
 * 整份归档 JSON，且用了 `@/` 别名，脱离打包器无法导入。
 */

import type { CloseSnapshot, CloseStock } from './close-history';
import { isDelistedName } from './stock-universe.ts';

/**
 * 剔除退市整理期个股，并同步重算由这三个池直接得出的统计量。
 *
 * 快照里的 limitUp / failed / limitDown 就是三个池的条数，highestBoard 是池内最大
 * 连板数，consecutiveCount 是 2 板及以上只数，sealRate = 涨停 ÷（涨停 + 炸板），
 * 已逐日核对全部相等。所以剔除后必须重算，否则会出现「涨停 47 只、梯队只列 46 只」
 * 这种自相矛盾的读数。
 */
export function excludeDelistedFromSnapshot(
  snapshot: CloseSnapshot,
): CloseSnapshot {
  const clean = (rows: CloseStock[] | undefined) =>
    (rows ?? []).filter((stock) => !isDelistedName(stock.name));
  const ladders = snapshot.ladders
    .map((group) => ({ ...group, stocks: clean(group.stocks) }))
    .filter((group) => group.stocks.length > 0);
  const ladderStocks = ladders.flatMap((group) => group.stocks);
  const failedStocks = clean(snapshot.failedStocks);
  const limitDownStocks = clean(snapshot.limitDownStocks);
  const limitUp = ladderStocks.length;
  const failed = failedStocks.length;
  return {
    ...snapshot,
    ladders,
    failedStocks,
    limitDownStocks,
    limitUp,
    failed,
    limitDown: limitDownStocks.length,
    highestBoard: ladderStocks.reduce(
      (top, stock) => Math.max(top, stock.height),
      0,
    ),
    consecutiveCount: ladderStocks.filter((stock) => stock.height >= 2).length,
    sealRate: limitUp + failed ? (limitUp / (limitUp + failed)) * 100 : 0,
  };
}
