'use client';

import {
  BrainCircuit,
  CheckCircle2,
  CircleDashed,
  ShieldAlert,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type {
  KnowledgeModule,
  KnowledgeJudgment,
  KnowledgeState,
  KnowledgeTone,
  UnifiedMarketReading,
} from '@/lib/unified-market';

const stateClass = (state: KnowledgeState) =>
  state === 'READY'
    ? 'border-sky-500/35 bg-sky-500/10 text-sky-700 dark:text-sky-300'
    : state === 'DEGRADED'
      ? 'border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-300'
      : 'border-slate-400/35 bg-slate-500/10 text-slate-600 dark:text-slate-300';

const toneClass = (tone: KnowledgeTone) =>
  tone === 'positive'
    ? 'market-up'
    : tone === 'negative'
      ? 'market-down'
      : tone === 'mixed'
        ? 'text-amber-700 dark:text-amber-300'
        : 'text-foreground';

function StatusBadge({ state }: { state: KnowledgeState }) {
  const Icon =
    state === 'READY'
      ? CheckCircle2
      : state === 'DEGRADED'
        ? ShieldAlert
        : CircleDashed;
  return (
    <Badge variant="outline" className={cn('gap-1', stateClass(state))}>
      <Icon className="size-3" />
      {state}
    </Badge>
  );
}

const judgmentLabel: Record<KnowledgeJudgment, string> = {
  CONFIRMED: '已确认',
  OBSERVE: '观察中',
  UNCONFIRMED: '尚未确认',
};

function JudgmentBadge({ judgment }: { judgment: KnowledgeJudgment }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'whitespace-nowrap',
        judgment === 'CONFIRMED'
          ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
          : judgment === 'OBSERVE'
            ? 'border-violet-500/35 bg-violet-500/10 text-violet-700 dark:text-violet-300'
            : 'border-slate-400/35 bg-slate-500/10 text-slate-600 dark:text-slate-300',
      )}
    >
      {judgmentLabel[judgment]}
    </Badge>
  );
}

function ModuleCard({ item, index }: { item: KnowledgeModule; index: number }) {
  return (
    <article className="flex min-h-64 flex-col rounded-xl border bg-background/75 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-slate-950 font-mono text-xs font-semibold text-white dark:bg-slate-100 dark:text-slate-950">
            {String(index + 1).padStart(2, '0')}
          </span>
          <div className="min-w-0">
            <h3 className="font-semibold">{item.name}</h3>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
              {item.question}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <StatusBadge state={item.state} />
          <JudgmentBadge judgment={item.judgment} />
        </div>
      </div>

      <p
        className={cn(
          'mt-4 text-lg font-semibold leading-7',
          toneClass(item.tone),
        )}
      >
        {item.conclusion}
      </p>

      <div className="mt-3 space-y-1.5 text-xs leading-5">
        {item.evidence.map((line, evidenceIndex) => (
          <p key={`${item.id}-${evidenceIndex}`} className="flex gap-2">
            <span className="mt-[9px] size-1 shrink-0 rounded-full bg-slate-400" />
            <span>{line}</span>
          </p>
        ))}
      </div>

      <div className="mt-auto space-y-2 border-t pt-3 text-[11px] leading-5">
        <p className="text-muted-foreground">
          <span className="font-semibold text-foreground/75">证据边界：</span>
          {item.boundary}
        </p>
        <p className="rounded-md bg-muted/55 px-2.5 py-2">
          <span className="font-semibold">IF—THEN：</span>
          {item.next}
        </p>
      </div>
    </article>
  );
}

export function UnifiedMarketBoard({
  reading,
}: {
  reading: UnifiedMarketReading;
}) {
  return (
    <section aria-label="盘面十二模块总览" className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-950 to-slate-900 text-slate-100 shadow-sm dark:border-slate-800">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 px-4 py-4 sm:px-5">
          <div className="max-w-4xl">
            <p className="flex items-center gap-2 text-sm font-semibold text-sky-300">
              <BrainCircuit className="size-4" />
              盘面全景 · 预期重新定价
            </p>
            <h2 className="mt-2 text-xl font-semibold leading-8 text-white sm:text-2xl">
              {reading.headline}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              信息改变预期，资金选择把预期变成价格；逻辑只产生候选，价格行为负责验证。
            </p>
          </div>
          <div className="text-right text-xs text-slate-400">
            <p>
              {reading.date.replace(/^(\d{4})-?(\d{2})-?(\d{2})$/, '$1-$2-$3')}{' '}
              {reading.cutoff}
            </p>
            <p className="mt-1">
              数据 READY {reading.readyCount} · DEGRADED {reading.degradedCount}{' '}
              · MISSING {reading.missingCount}
            </p>
          </div>
        </div>

        <div className="grid gap-px bg-slate-800 lg:grid-cols-[160px_1fr]">
          <div className="bg-slate-950 px-4 py-4 text-xs font-semibold text-slate-400 sm:px-5">
            当前事实链
          </div>
          <p className="bg-slate-950 px-4 py-4 text-sm leading-6 text-slate-200 sm:px-5">
            {reading.factChain}
          </p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {reading.modules.map((item, index) => (
          <ModuleCard key={item.id} item={item} index={index} />
        ))}
      </div>

      <div className="rounded-lg border border-dashed bg-muted/25 px-4 py-3 text-xs leading-5 text-muted-foreground">
        <p className="font-semibold text-foreground">统一口径</p>
        <p className="mt-1">
          当前规则与真实行情 ＞ 当时可见的资金和价格 ＞ 市场环境与赚钱/亏钱效应
          ＞ 群体结构 ＞ 个股地位 ＞ 历史统计 ＞
          经验口诀。所有判断冻结在页面标注的时点；没有证据的模块明确显示
          MISSING，并把“数据是否齐全”与“盘面结论是否确认”分开；不用收盘结果或网络概率倒填。
        </p>
      </div>
    </section>
  );
}
