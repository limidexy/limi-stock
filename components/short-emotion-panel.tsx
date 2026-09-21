'use client';

import {
  Activity,
  ArrowRightLeft,
  ShieldAlert,
  ThermometerSun,
} from 'lucide-react';
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
const date = (value?: string) =>
  value?.replace(/^(\d{4})-?(\d{2})-?(\d{2})$/, '$1-$2-$3') ?? '—';

type EvidenceRow = {
  label: string;
  value: string;
  detail: string;
  state: string;
};

function EvidenceGrid({ rows }: { rows: EvidenceRow[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {rows.map((row) => (
        <div key={row.label} className="rounded-lg border bg-background/75 p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs text-muted-foreground">{row.label}</p>
            <span
              className={cn(
                'text-[10px] font-medium',
                row.state === 'READY'
                  ? 'text-sky-600 dark:text-sky-400'
                  : row.state === 'MISSING'
                    ? 'text-muted-foreground'
                    : 'text-amber-700 dark:text-amber-400',
              )}
            >
              {row.state}
            </span>
          </div>
          <p className="mt-1 text-sm font-semibold leading-5">{row.value}</p>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            {row.detail}
          </p>
        </div>
      ))}
    </div>
  );
}

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
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
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
                ? '触及晋级板后未封住'
                : '未触及晋级板'}
          </p>
        </div>
      ))}
    </div>
  );
}

function JudgmentCard({
  kind,
  label,
  tone,
  summary,
  badge,
  evidence,
}: {
  kind: '高标生态' | '接力生态';
  label: string;
  tone: EmotionTone;
  summary: string;
  badge: string;
  evidence: EvidenceRow[];
}) {
  const Icon = kind === '高标生态' ? Activity : ArrowRightLeft;
  return (
    <article className="space-y-3 rounded-xl border bg-background/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Icon className="size-4 text-amber-500" />
            {kind}
          </p>
          <h4
            className={cn('mt-2 text-xl font-semibold', emotionToneClass(tone))}
          >
            {label}
          </h4>
        </div>
        <Badge variant="outline">{badge}</Badge>
      </div>
      <p className="text-sm leading-6">{summary}</p>
      <EvidenceGrid rows={evidence} />
    </article>
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
  return (
    <section
      aria-label="高标与接力情绪判断"
      className="space-y-4 rounded-xl border border-amber-500/35 bg-gradient-to-br from-amber-500/[0.07] via-background to-background p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <ThermometerSun className="size-4 text-amber-500" />
            短线情绪 · 高标与接力分开判断
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {date(facts.date)} {facts.cutoff} ·
            先看事实，再看结论；比例同时显示分子与分母
          </p>
        </div>
        <Badge variant="outline">
          {reading.status} · {reading.quoteComplete ? '反馈完整' : '证据有缺口'}
        </Badge>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <JudgmentCard
          kind="高标生态"
          label={reading.highBoard.label}
          tone={reading.highBoard.tone}
          summary={reading.highBoard.summary}
          badge={`动态高标池 ${reading.highBoard.rows.length}只`}
          evidence={reading.highBoard.evidence}
        />
        <JudgmentCard
          kind="接力生态"
          label={`${reading.relay.label}${reading.relay.direction === '单时点' ? '' : `｜${reading.relay.direction}`}`}
          tone={reading.relay.tone}
          summary={reading.relay.summary}
          badge={`候选 ${reading.relay.candidateCount}只`}
          evidence={reading.relay.evidence}
        />
      </div>

      <div className="rounded-lg border bg-background/65 px-3 py-2 text-xs leading-5">
        <p className="font-semibold">市场边际线索：{reading.transition}</p>
        <p className="text-muted-foreground">
          这是全市场封板与梯队的相邻收盘对照，不冒充接力同口径历史序列。
        </p>
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
        </details>
      )}

      {reading.missing.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-800 dark:text-amber-300">
          <p className="flex items-center gap-2 font-semibold">
            <ShieldAlert className="size-4" />
            判断证据缺口
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {[...new Set(reading.missing)].map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      <details className="text-xs leading-5 text-muted-foreground">
        <summary className="cursor-pointer font-medium">判断顺序与边界</summary>
        <p className="mt-2">{reading.caution}</p>
        <p className="mt-1">
          接力固定按“数据完整 → 上一批反馈 → 高标/中位风险 → 尝试率 → 晋级率 →
          接力封板率 → 失败成本 → 高中低梯队 → 行业接力线索 → 一字/换手 →
          相邻收盘边际”判断。接力封板率=成功晋级÷触及晋级板，不再使用全市场封板率代替。
        </p>
        <p className="mt-1">
          高标池按当日相对高度动态选取最高与次高层级，不固定为4板以上。主线高标、情绪高标、容量高标、预期差、卡位和反核仍需要概念关系、成交额、竞价与分钟路径；字段缺失就显示缺口，不由板数猜测。
        </p>
        <p className="mt-1">
          所有阈值是可解释的盘面观察规则，未经预测有效性验证，不输出情绪分数、胜率或买卖建议。
        </p>
      </details>
    </section>
  );
}
