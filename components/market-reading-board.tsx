'use client';

import { useState } from 'react';
import { Layers3, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import type {
  CloseSnapshot,
  CloseStock,
  IntradayEmotionSnapshot,
} from '@/lib/close-history';
import {
  closeComparison,
  compactDate,
  emotionReading,
  shortEmotionReading,
  ladderReading,
  type EmotionCoreEvidence,
  type EmotionFacts,
  type ReadingLadder,
} from '@/lib/market-reading';
import { cn } from '@/lib/utils';
import { ShortEmotionPanel } from '@/components/short-emotion-panel';

const pct = (value: number | null | undefined, signed = true) =>
  value == null
    ? '—'
    : `${signed && value > 0 ? '+' : ''}${value.toFixed(signed ? 2 : 1)}%`;
const sign = (value: number, digits = 0) =>
  `${value > 0 ? '+' : ''}${value.toFixed(digits)}`;
const dateText = (value?: string) => {
  const date = compactDate(value);
  return date.length === 8
    ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}`
    : '日期待确认';
};

export function toEmotionFacts(
  snapshot: IntradayEmotionSnapshot | CloseSnapshot,
): EmotionFacts {
  const archived = 'date' in snapshot;
  return {
    ...snapshot,
    date: archived ? snapshot.date : snapshot.tradeDate,
    stale: !archived && snapshot.sourceState === 'STALE',
    poolsReady:
      archived ||
      (snapshot.coverage.poolsRequested > 0 &&
        snapshot.coverage.poolsReady === snapshot.coverage.poolsRequested),
    breadthReady: archived || snapshot.coverage.breadthReady,
  };
}

type EmotionEvidenceProps = {
  snapshot: IntradayEmotionSnapshot | CloseSnapshot;
  previous?: CloseSnapshot;
  ladder?: ReadingLadder | null;
  coreEvidence?: EmotionCoreEvidence | null;
};

/**
 * 高标与接力：断板影响 / 反核尝试 / 修复扩散 等反馈指标都在这里。
 * 单独拆出，便于在收盘页把「指数与市场广度、梯队、摘要」整体排到它上面。
 */
export function EmotionFeedbackPanel({
  snapshot,
  previous,
  ladder,
  coreEvidence,
}: EmotionEvidenceProps) {
  const facts = toEmotionFacts(snapshot);
  return (
    <ShortEmotionPanel
      facts={facts}
      previous={previous ? toEmotionFacts(previous) : null}
      ladder={ladder}
      coreEvidence={coreEvidence}
    />
  );
}

/** 指数与市场广度：指数与赚钱面分开看，单独成块便于置顶。 */
export function EmotionBreadthPanel({
  snapshot,
  previous,
  ladder,
  coreEvidence,
}: EmotionEvidenceProps) {
  const facts = toEmotionFacts(snapshot);
  const reading = emotionReading(facts);
  const compare = closeComparison(
    facts,
    previous ? toEmotionFacts(previous) : null,
  );
  const cohort = shortEmotionReading(
    facts,
    previous ? toEmotionFacts(previous) : null,
    ladder,
    coreEvidence,
  ).cohort;
  const showCohort = cohort.ready && !facts.stale;
  return (
    <section
      aria-label="指数与市场广度"
      className="space-y-3 rounded-xl border bg-background/70 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs text-muted-foreground">
            指数与市场广度 · {dateText(facts.date)} {facts.cutoff}
          </p>
          <h3 className="mt-1 text-lg font-semibold">{reading.headline}</h3>
        </div>
        <Badge variant="outline">
          {reading.usable && reading.indexReady && showCohort
            ? 'READY'
            : 'DEGRADED'}{' '}
          · 事实观察
        </Badge>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">指数 · 与赚钱面分开看</p>
          <p className="my-1 font-semibold">{reading.indexMood}</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {reading.indices.map((index) => (
              <span key={index.code}>
                {index.name}{' '}
                <span
                  className={
                    index.changePct == null
                      ? ''
                      : index.changePct >= 0
                        ? 'market-up'
                        : 'market-down'
                  }
                >
                  {pct(index.changePct)}
                </span>
              </span>
            ))}
            {!reading.indexReady && (
              <span className="text-muted-foreground">
                三大指数未齐，不用上涨家数替代
              </span>
            )}
          </div>
        </div>
        <div className="rounded-lg bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">
            赚钱面 · {reading.broad}
          </p>
          <p className="my-1 font-semibold">
            上涨占比 {pct(reading.upRatio, false)}
          </p>
          <p className="text-xs text-muted-foreground">
            中位数{' '}
            {pct(reading.breadthReady ? facts.breadth.medianChangePct : null)} ·{' '}
            {facts.breadth.rowsAvailable}只有效报价
          </p>
        </div>
        <div className="rounded-lg bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">
            封板质量 · {reading.board}
          </p>
          <p className="my-1 font-semibold">
            封板率 {pct(reading.sealRate, false)}
          </p>
          <p className="text-xs text-muted-foreground">
            {reading.poolsReady
              ? `${facts.limitUp}只封住 / ${facts.limitUp + facts.failed}只触板；${facts.failed}只未回封`
              : '涨停、炸板池不齐，不参与判断'}
          </p>
        </div>
        <div className="rounded-lg bg-muted/40 p-3">
          <p className="text-xs text-muted-foreground">
            连板承接 · 昨日2板及以上
          </p>
          <p className="my-1 font-semibold">
            晋级率 {pct(showCohort ? cohort.consecutive.rate : null, false)}
          </p>
          <p className="text-xs text-muted-foreground">
            {showCohort
              ? `${cohort.consecutive.advanced}/${cohort.consecutive.count}只晋级；${cohort.consecutive.failed}只炸板，${cohort.consecutive.dropped}只未封板`
              : '未取得同日期的完整前一日梯队'}
          </p>
        </div>
      </div>
      {compare && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
          <span>对比 {dateText(compare.date)} 15:00：</span>
          <span>涨停 {sign(compare.limitUp)}家</span>
          <span>跌停 {sign(compare.limitDown)}家</span>
          <span>封板率 {sign(compare.sealRate, 1)}个百分点</span>
          <span>高度 {sign(compare.height)}板</span>
        </div>
      )}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">判断口径与边界</summary>
        <p className="mt-2 leading-5">
          按本时点可见数据独立归纳，不是买卖信号或次日预测。上涨占比≥60%且中位数为正称“多数上涨”，≤40%且中位数为负称“多数下跌”；封板率低于55%称“分歧大”，≥75%称“承接较好”。阈值仅为可解释的观察规则，未经预测有效性验证。指数单独列示，不与涨停情绪混算。
        </p>
        <p className="mt-1 leading-5">
          封板率=当前涨停/(当前涨停+触板未封)，不是触板次数成功率；回封股票只计入涨停。连板晋级率只统计昨日2板及以上；首板晋级另列。盘中不与上次收盘计算“同时间增减”；收盘比较仅使用明确标注日期的15:00归档。
        </p>
      </details>
    </section>
  );
}

/** 盘中实时页沿用原顺序：先高标与接力，再指数与市场广度。 */
export function EmotionEvidencePanel(props: EmotionEvidenceProps) {
  return (
    <div aria-label="盘面判断依据" className="space-y-3">
      <EmotionFeedbackPanel {...props} />
      <EmotionBreadthPanel {...props} />
    </div>
  );
}

export function LadderOverview({
  ladder,
  close,
  onCompetition,
}: {
  ladder:
    | (ReadingLadder & {
        sealedStocks?: CloseStock[];
        sessionState?: string;
        reason?: string;
      })
    | null;
  close?: CloseSnapshot;
  onCompetition: () => void;
}) {
  const [showFirst, setShowFirst] = useState(false);
  const reading = ladderReading(ladder);
  const archived =
    ladder?.sessionState === 'CLOSED' &&
    close &&
    compactDate(close.date) === compactDate(ladder.tradeDate)
      ? close
      : undefined;
  const sealed = [
    ...new Map(
      (
        ladder?.sealedStocks ??
        archived?.ladders.flatMap((level) => level.stocks) ??
        []
      ).map((stock) => [stock.code, stock]),
    ).values(),
  ];
  const fullStructure = Boolean(ladder?.sealedStocks || archived);
  const highest = fullStructure
    ? Math.max(0, ...sealed.map((stock) => stock.height))
    : null;
  const leaders =
    highest === null ? [] : sealed.filter((stock) => stock.height === highest);
  const levels = Array.from(
    { length: Math.max(0, (highest ?? 0) - (showFirst ? 0 : 1)) },
    (_, i) => (highest ?? 0) - i,
  );
  const gaps = levels.filter(
    (height) => height >= 2 && !sealed.some((stock) => stock.height === height),
  );
  const quotes = new Map(reading.rows.map((row) => [row.code, row]));
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Layers3 className="size-5 text-rose-500" />
              连板天梯 · 谁在上，谁掉队
            </CardTitle>
            <CardDescription className="mt-1">
              {dateText(ladder?.tradeDate)} ·{' '}
              {ladder?.sourceState === 'STALE'
                ? '最近成功快照，非当前实时'
                : ladder?.sessionState === 'CLOSED'
                  ? '15:00收盘定格'
                  : '当前封板状态'}
              ；目标板位不等于已达成高度
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={onCompetition}>
            查看全部竞争个股
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4">
            <p className="text-xs text-muted-foreground">当前最高封板</p>
            <p className="mt-1 text-3xl font-semibold">
              {highest === null ? '—' : `${highest}板`}
            </p>
            <p className="mt-2 font-semibold market-up">
              {leaders.map((stock) => stock.name).join('、') ||
                (highest === 0 ? '暂无封板' : '完整涨停池待补')}
            </p>
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-xs text-muted-foreground">
              连板晋级 · 昨日2板及以上
            </p>
            <p className="mt-1 text-3xl font-semibold">
              {pct(reading.consecutive.rate, false)}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {reading.ready
                ? `${reading.consecutive.advanced} / ${reading.consecutive.count}只晋级`
                : '前一交易日样本未完整确认'}
            </p>
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-xs text-muted-foreground">首板晋级 · 1进2</p>
            <p className="mt-1 text-3xl font-semibold">
              {pct(reading.first.rate, false)}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {reading.ready
                ? `${reading.first.advanced} / ${reading.first.count}只晋级`
                : '缺失不是0%'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground">
            实际封板高度从高到低；空层保留，股票直接显示名称与涨幅
          </span>
          <Button
            size="sm"
            variant={showFirst ? 'secondary' : 'outline'}
            aria-pressed={showFirst}
            onClick={() => setShowFirst((value) => !value)}
          >
            {showFirst
              ? '收起首板'
              : `展开首板（${sealed.filter((stock) => stock.height === 1).length}）`}
          </Button>
        </div>
        {fullStructure ? (
          <div
            className="divide-y rounded-xl border"
            aria-label="当前连板高度分布"
          >
            {levels.map((height) => {
              const stocks = sealed
                .filter((stock) => stock.height === height)
                .sort(
                  (a, b) =>
                    (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity),
                );
              return (
                <div
                  key={height}
                  className={cn(
                    'grid grid-cols-[56px_1fr] gap-3 p-3 sm:grid-cols-[84px_1fr]',
                    !stocks.length && 'bg-muted/30',
                  )}
                >
                  <div className="border-r pr-2">
                    <p
                      className={cn(
                        'text-xl font-semibold',
                        stocks.length ? 'market-up' : 'text-muted-foreground',
                      )}
                    >
                      {height}板
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {stocks.length}家
                    </p>
                  </div>
                  <div className="min-w-0">
                    {stocks.length ? (
                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {stocks.map((stock) => (
                          <div
                            key={stock.code}
                            className="rounded-lg border bg-background px-3 py-2"
                          >
                            <div className="flex flex-wrap justify-between gap-1">
                              <span className="font-semibold">
                                {stock.name}
                              </span>
                              <span className="font-mono market-up">
                                {pct(stock.changePct)}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {stock.code} · {stock.industry || '行业待补'}
                            </p>
                            <p className="mt-1 text-xs">
                              {stock.firstTouch ?? '触板时刻待补'} ·{' '}
                              {stock.breakCount
                                ? `开板${stock.breakCount}次后回封`
                                : '暂无开板记录'}
                              {quotes.get(stock.code)?.speedPct != null && (
                                <span className="ml-2 text-muted-foreground">
                                  涨速 {pct(quotes.get(stock.code)?.speedPct)}
                                </span>
                              )}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="py-2 text-sm text-muted-foreground">
                        梯队断层 · 本层暂无封板股
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
            {!levels.length && (
              <p className="p-4 text-sm text-muted-foreground">
                当前暂无2板及以上封板股，可展开查看首板。
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            完整涨停池尚未取得，不用昨日竞争池中的股票冒充全市场天梯。
          </p>
        )}
        {gaps.length > 0 && (
          <p className="flex gap-2 text-xs text-muted-foreground">
            <ShieldAlert className="size-4 shrink-0 text-amber-600" />
            {gaps.join('、')}
            板出现断层；仅描述当前结构，不代表高标下一刻一定断板。
          </p>
        )}
        {reading.ready && (
          <div className="space-y-2 border-t pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">各身位晋级分布</h3>
              <span className="text-xs text-muted-foreground">
                分母：{dateText(ladder?.previousTradeDate)}涨停股 · 封板 /
                炸板未封 / 其他未封
              </span>
            </div>
            {reading.groups.map((group) => (
              <div
                key={group.height}
                className="grid grid-cols-[44px_1fr] items-center gap-3 sm:grid-cols-[64px_1fr_200px]"
              >
                <span className="text-xs font-semibold">
                  {group.height}进{group.height + 1}
                </span>
                <figure
                  className="flex h-6 overflow-hidden rounded bg-muted"
                  aria-label={`${group.height}进${group.height + 1}，${group.count}只中${group.advanced}只封板、${group.failed}只炸板、${group.dropped}只其他未封板`}
                >
                  {group.advanced > 0 && (
                    <div
                      className="grid place-items-center bg-rose-500 text-[11px] font-semibold text-white"
                      style={{
                        width: `${(group.advanced / group.count) * 100}%`,
                      }}
                    >
                      {group.advanced}
                    </div>
                  )}
                  {group.failed > 0 && (
                    <div
                      className="grid place-items-center bg-amber-400 text-[11px] font-semibold text-slate-950"
                      style={{
                        width: `${(group.failed / group.count) * 100}%`,
                      }}
                    >
                      {group.failed}
                    </div>
                  )}
                  {group.dropped > 0 && (
                    <div
                      className="grid place-items-center bg-slate-200 text-[11px] text-slate-800 dark:bg-slate-700 dark:text-slate-100"
                      style={{
                        width: `${(group.dropped / group.count) * 100}%`,
                      }}
                    >
                      {group.dropped}
                    </div>
                  )}
                </figure>
                <span className="col-start-2 text-xs text-muted-foreground sm:col-auto">
                  封{group.advanced} · 炸{group.failed} · 未封{group.dropped} ·{' '}
                  {pct(group.rate, false)}
                </span>
              </div>
            ))}
          </div>
        )}
        {reading.negative.length > 0 && (
          <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3">
            <h3 className="mb-2 text-sm font-semibold">
              昨日连板掉队 · 下跌也要看
            </h3>
            <div className="flex flex-wrap gap-2">
              {reading.negative.map((row) => (
                <div
                  key={row.code}
                  className="rounded border bg-background px-3 py-2 text-xs"
                >
                  <span className="font-semibold">{row.name}</span>
                  <span className="ml-2 market-down">{pct(row.changePct)}</span>
                  <p className="mt-1 text-muted-foreground">
                    昨日{row.fromHeight}板 ·{' '}
                    {row.state === 'FAILED' ? '炸板未封' : '未封板'} · 涨速{' '}
                    {pct(row.speedPct)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
        {ladder?.reason && (
          <p className="text-xs text-muted-foreground">{ladder.reason}</p>
        )}
      </CardContent>
    </Card>
  );
}
