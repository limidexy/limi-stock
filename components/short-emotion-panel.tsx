'use client';

import { ThermometerSun } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  shortEmotionReading,
  type EmotionFacts,
  type EmotionTone,
  type ReadingCompetitor,
  type ReadingLadder,
} from '@/lib/market-reading';

export const emotionToneClass = (tone: EmotionTone) =>
  ({
    positive: 'text-red-500',
    negative: 'text-emerald-600 dark:text-emerald-400',
    mixed: 'text-amber-700 dark:text-amber-400',
    unknown: 'text-muted-foreground',
  })[tone];
const pct = (value: number | null, digits = 2) =>
  value === null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`;
const delta = (value: number) => `${value > 0 ? '+' : ''}${value}`;
const date = (value?: string) =>
  value?.replace(/^(\d{4})-?(\d{2})-?(\d{2})$/, '$1-$2-$3') ?? '—';

function FeedbackStocks({
  rows,
  empty,
}: {
  rows: ReadingCompetitor[];
  empty: string;
}) {
  if (!rows.length)
    return <p className="text-xs text-muted-foreground">{empty}</p>;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {rows.map((stock) => (
        <div
          key={stock.code}
          className="min-w-0 rounded-md border bg-background/75 px-2.5 py-2"
        >
          <div className="flex flex-wrap justify-between gap-x-2 gap-y-1 text-sm">
            <span className="font-medium">{stock.name}</span>
            <span
              className={cn(
                'font-mono font-semibold',
                stock.changePct! > 0 ? 'market-up' : 'market-down',
              )}
            >
              {pct(stock.changePct)}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {stock.code} · 昨{stock.fromHeight}板 →{' '}
            {stock.state === 'SEALED'
              ? `今${stock.toHeight}板封住`
              : stock.state === 'FAILED'
                ? '触板未封'
                : '当前未封板'}
          </p>
        </div>
      ))}
    </div>
  );
}

export function ShortEmotionPanel({
  facts,
  previous,
  ladder,
}: {
  facts: EmotionFacts;
  previous?: EmotionFacts | null;
  ladder?: ReadingLadder | null;
}) {
  const reading = shortEmotionReading(facts, previous, ladder);
  const knownNegative = new Set(reading.negative.map((stock) => stock.code));
  const down = reading.structureReady
    ? [
        ...new Map(
          (facts.limitDownStocks ?? []).map((stock) => [stock.code, stock]),
        ).values(),
      ]
    : [];
  const otherDown = down.filter((stock) => !knownNegative.has(stock.code));
  const activeFamilies = reading.families.filter(
    (family) => family.highest >= 2 || family.started > 0,
  );
  return (
    <section
      aria-label="独立短线情绪面"
      className="space-y-4 rounded-xl border border-amber-500/35 bg-gradient-to-br from-amber-500/[0.07] via-background to-background p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <ThermometerSun className="size-4 text-amber-500" />
            情绪面 · 看接力，也看亏损
          </p>
          <h3
            className={cn(
              'mt-2 text-xl font-semibold tracking-tight',
              emotionToneClass(reading.tone),
            )}
          >
            {reading.label}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {date(facts.date)} {facts.cutoff} · 独立于指数涨跌和全市场赚钱面
          </p>
        </div>
        <Badge variant="outline">
          {reading.status} · {reading.quoteComplete ? '事实归纳' : '结构观察'}
        </Badge>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="min-w-0 space-y-2 rounded-lg border bg-background/75 p-3">
          <h4 className="text-xs text-muted-foreground">
            ① 高标与梯队 · 分市场看
          </h4>
          {reading.structureReady ? (
            activeFamilies.length ? (
              activeFamilies.map((family) => (
                <div key={family.name} className="text-xs leading-5">
                  <p className="font-semibold">
                    {family.name} ·{' '}
                    {family.highest >= 2 ? `${family.highest}板` : '暂无连板'}{' '}
                    <span className="market-up">
                      {family.highest >= 2
                        ? family.leaders.map((stock) => stock.name).join('、')
                        : ''}
                    </span>
                  </p>
                  <p className="text-muted-foreground">
                    {family.highest < 2
                      ? '当前没有连续封板股'
                      : family.gaps.length
                        ? `${family.gaps.join('、')}板空层`
                        : '2板至最高板无空层'}
                    {family.started > 0
                      ? `；昨日连板${family.advanced}/${family.started}只晋级`
                      : ''}
                  </p>
                  {family.middleHighStarted > 0 && (
                    <p
                      className={
                        family.middleHighAdvanced === 0
                          ? 'market-down'
                          : 'text-muted-foreground'
                      }
                    >
                      昨日3板及以上：{family.middleHighAdvanced}/
                      {family.middleHighStarted}只晋级
                    </p>
                  )}
                </div>
              ))
            ) : (
              <p className="text-sm">暂无连板股</p>
            )
          ) : (
            <p className="text-xs text-muted-foreground">
              完整封板名单待补，不猜最高板
            </p>
          )}
          {reading.oldLeaders.length > 0 && (
            <p className="border-t pt-2 text-xs leading-5">
              昨日最高板：
              {reading.oldLeaders
                .map(
                  (stock) =>
                    `${stock.name}（昨${stock.fromHeight}板）${pct(stock.changePct)}，${stock.state === 'SEALED' ? '已晋级' : '未晋级'}`,
                )
                .join('；')}
              。
            </p>
          )}
        </div>
        <div className="min-w-0 space-y-2 rounded-lg border bg-background/75 p-3">
          <h4 className="text-xs text-muted-foreground">
            ② 昨日强股 · 固定样本反馈
          </h4>
          <p className="font-semibold">
            昨日涨停股涨幅中位数{' '}
            <span
              className={
                reading.median === null
                  ? ''
                  : reading.median >= 0
                    ? 'market-up'
                    : 'market-down'
              }
            >
              {pct(reading.median)}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            以昨收为基准的日涨跌幅，不等于买入收益
          </p>
          <p className="text-xs leading-5">
            连板晋级{' '}
            {reading.cohort.ready
              ? `${reading.cohort.consecutive.advanced}/${reading.cohort.consecutive.count}（${reading.cohort.consecutive.rate === null ? '无样本' : `${reading.cohort.consecutive.rate.toFixed(1)}%`}）`
              : '—'}
            <br />
            首板晋级{' '}
            {reading.cohort.ready
              ? `${reading.cohort.first.advanced}/${reading.cohort.first.count}（${reading.cohort.first.rate === null ? '无样本' : `${reading.cohort.first.rate.toFixed(1)}%`}）`
              : '—'}
          </p>
          <p className="text-[11px] leading-5 text-muted-foreground">
            样本日 {date(reading.cohortDate)} · 当日价格{' '}
            {reading.cohort.ready
              ? `${reading.cohort.all.priceReady}/${reading.cohort.all.count}`
              : '未齐'}
            <br />
            {reading.cohortSource}
          </p>
        </div>
        <div className="min-w-0 space-y-2 rounded-lg border bg-background/75 p-3">
          <h4 className="text-xs text-muted-foreground">
            ③ 弱侧压力 · 不忽略掉队股
          </h4>
          <p className="font-semibold">
            昨日连板下跌{' '}
            {reading.cohort.ready
              ? `${reading.negative.length}/${reading.cohort.consecutive.count}只${reading.cohort.consecutive.priceReady < reading.cohort.consecutive.count ? '（已确认部分）' : ''}`
              : '—'}
          </p>
          <p className="text-xs leading-5">
            当日跌停 {reading.structureReady ? `${facts.limitDown}只` : '—'} ·
            触板未封 {reading.structureReady ? `${facts.failed}只` : '—'}
          </p>
          <p className="text-xs leading-5 text-muted-foreground">
            {reading.weakest.length
              ? `高位负反馈：${reading.weakest
                  .slice(0, 3)
                  .map((stock) => `${stock.name}${pct(stock.changePct)}`)
                  .join('、')}。完整名单见下方。`
              : '未发现已确认的昨日连板下跌股，不等于弱侧已修复。'}
          </p>
        </div>
      </div>
      <div className="rounded-lg border bg-background/65 px-3 py-2 text-xs leading-5">
        <p className="font-semibold">
          {reading.compare
            ? `较${date(reading.compare.date)}收盘：`
            : '阶段线索：'}
          {reading.transition}
        </p>
        {reading.compare && (
          <p className="text-muted-foreground">
            涨停 {delta(reading.compare.up)} · 跌停{' '}
            {delta(reading.compare.down)} · 封板率{' '}
            {reading.compare.seal === null
              ? '—'
              : `${delta(Number(reading.compare.seal.toFixed(1)))}个百分点`}{' '}
            · 高度 {delta(reading.compare.height)}板 · 连板家数{' '}
            {delta(reading.compare.consecutive)}
          </p>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <h4 className="text-xs font-semibold market-up">
            强侧反馈 · 昨日连板今天上涨
          </h4>
          <FeedbackStocks
            rows={reading.positive}
            empty="暂无已确认的上涨样本"
          />
        </div>
        <div className="space-y-2">
          <h4 className="text-xs font-semibold market-down">
            弱侧反馈 · 昨日连板今天下跌
          </h4>
          <FeedbackStocks
            rows={reading.weakest}
            empty="暂无已确认的下跌样本；缺失不当作0只"
          />
        </div>
      </div>
      {down.length > 0 && (
        <details className="text-xs leading-5">
          <summary className="cursor-pointer font-medium">
            当日跌停名单 · {down.length}/{facts.limitDown}只（与上方按代码去重）
          </summary>
          <div className="mt-2 flex flex-wrap gap-2">
            {otherDown.map((stock) => (
              <span
                key={stock.code}
                className="rounded border px-2 py-1 market-down"
              >
                {stock.name} {pct(stock.changePct)}
              </span>
            ))}
          </div>
          {down.length !== otherDown.length && (
            <p className="mt-1 text-muted-foreground">
              另{down.length - otherDown.length}只已列入上方弱侧反馈。
            </p>
          )}
        </details>
      )}
      {reading.missing.length > 0 && (
        <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-800 dark:text-amber-300">
          {reading.missing.join('；')}。
        </p>
      )}
      <details className="text-xs leading-5 text-muted-foreground">
        <summary className="cursor-pointer">情绪口径与判断边界</summary>
        <p className="mt-2">
          参考复盘图中的“高位结构—强侧承接—弱侧反馈”思路，按本站行情独立归纳。
          {reading.caution}
        </p>
        <p className="mt-1">
          观察规则：主板昨日连板晋级不足25%且同一主板样本至少一半下跌，标记接力偏弱；至少3只主板昨日3板以上全部未晋级、同时跌停≥5且不少于涨停的15%，标记主板高位断层。主板晋级≥50%、同组下跌占比≤25%、封板率≥75%、主板无空层且跌停压力不高，才标记接力偏强。若无主板样本则观察其他市场，接力样本不足3只不作强弱定性。阈值可解释但未经预测有效性验证；不输出情绪分数或买卖建议。
        </p>
        <p className="mt-1">
          历史只在无缺口的相邻收盘名单之间计算晋级；三池未覆盖的普通交易股价格保留缺失。只有完整昨日涨停报价才给收益中位数；实时两模块相差超过60秒或报价模块晚于情绪快照时，不混用。主板、创业/科创、北交高度单列，板数不代表相同收益。收盘对比不冒充盘中转折。
        </p>
      </details>
    </section>
  );
}
