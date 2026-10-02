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
  type CoreCandidate,
  type CoreDimension,
  type EmotionCoreEvidence,
  type EmotionTone,
  type ReadingCompetitor,
  type ReadingLadder,
} from '@/lib/market-reading';
import type { TapeStock } from '@/lib/tape-observation';
import type {
  CoreComparativeReading,
  CoreStockReading,
} from '@/lib/core-comparative-reading';

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

function MetricValue({
  metric,
}: {
  metric: {
    value: number | null;
    denominator: number | null;
    state: string;
    knownCount?: number;
    covered?: number;
  };
}) {
  return (
    <span className="font-mono">
      {metric.value === null
        ? metric.covered
          ? `已知${metric.knownCount ?? 0} / ${metric.denominator ?? '—'}（覆盖${metric.covered}）`
          : '—（证据缺失）'
        : `${metric.value}/${metric.denominator === null ? '—' : metric.denominator}`}
    </span>
  );
}

const dimensionLabels: Array<[keyof CoreCandidate['dimensions'], string]> = [
  ['position', '地位'],
  ['initiative', '主动性'],
  ['leadership', '带动性'],
  ['antiFall', '抗跌性'],
  ['identity', '辨识度'],
  ['expectation', '预期差'],
  ['chips', '筹码承接'],
  ['groupInfluence', '群体影响'],
  ['persistence', '持续性'],
];

function DimensionGrid({
  dimensions,
}: {
  dimensions: CoreCandidate['dimensions'];
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {dimensionLabels.map(([key, label]) => {
        const item: CoreDimension = dimensions[key];
        const resultLabel =
          item.result === 'OBSERVED'
            ? '已观察'
            : item.result === 'NOT_OBSERVED'
              ? '本窗口未见'
              : item.result === 'UNRESOLVED'
                ? '未能解析'
                : null;
        return (
          <div key={key} className="rounded-md border bg-background/60 p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{label}</span>
              <span className="text-right text-[10px]">
                <span
                  className={cn(
                    item.state === 'READY'
                      ? 'text-sky-600 dark:text-sky-400'
                      : item.state === 'DEGRADED'
                        ? 'text-amber-700 dark:text-amber-400'
                        : 'text-muted-foreground',
                  )}
                >
                  {item.state}
                </span>
                {resultLabel ? (
                  <span className="ml-1 text-muted-foreground">
                    · {resultLabel}
                  </span>
                ) : null}
              </span>
            </div>
            <p className="mt-1 text-xs leading-5">{item.fact}</p>
            <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
              {item.basis} · {item.observedAt} · {item.source}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function PricePathFacts({ path }: { path: TapeStock | undefined }) {
  if (!path)
    return (
      <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
        分钟价格路径：当前证据未接入；不把此处缺口改写成“空间观察”或“本窗口未见”。
      </p>
    );
  const facts = [
    ...path.initiative.facts,
    ...path.response.facts,
    ...path.resilience.facts,
  ].filter(Boolean);
  return (
    <div className="mt-2 rounded-md border border-sky-500/20 bg-sky-500/[0.035] p-2 text-[11px] leading-5">
      <p>
        分钟路径：{path.supportLabel} · 承接：{path.resilience.label}{' '}
        <span className="text-muted-foreground">
          （{path.resilience.state} · {path.resilience.result}）
        </span>
      </p>
      <p className="text-muted-foreground">
        可见窗口 {path.firstTime ?? '—'}—{path.lastTime ?? '—'} · 价格变化{' '}
        {pct(path.changePct)} · 报价时刻 {path.quoteTime ?? '—'} · {path.source}
      </p>
      {facts.length ? (
        <p className="text-muted-foreground">
          关键分钟事实：{[...new Set(facts)].slice(0, 4).join('；')}
        </p>
      ) : null}
    </div>
  );
}

function CoreCandidateCard({
  candidate,
  pricePath,
  analysis,
}: {
  candidate: CoreCandidate;
  pricePath?: TapeStock;
  analysis?: CoreStockReading;
}) {
  const extended = candidate as CoreCandidate & {
    peakHeight?: number | null;
    historicalHeight?: number | null;
    currentRole?: string;
  };
  const historicalPeak = extended.peakHeight ?? extended.historicalHeight;
  const path = candidate.pricePath ?? pricePath;
  return (
    <article className="rounded-lg border bg-background/70 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">
            {candidate.name}{' '}
            <span className="font-mono text-xs font-normal text-muted-foreground">
              {candidate.code}
            </span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {extended.currentRole ??
              (candidate.roles.join(' · ') || '候选观察')}{' '}
            ·{' '}
            {candidate.height === null
              ? `${candidate.trend ?? '趋势'}${historicalPeak ? ` · 历史峰值${historicalPeak}板` : ''}`
              : `当前${candidate.height}板${historicalPeak ? ` · 历史峰值${historicalPeak}板` : ''}`}
          </p>
        </div>
        <Badge variant="outline">
          {candidate.state}
          {' · 不等于市场核心认证'}
        </Badge>
      </div>
      {analysis ? (
        <div className="mt-3 space-y-2 text-sm leading-6">
          <p className="text-muted-foreground">{analysis.premise}</p>
          <p>{analysis.reading}</p>
          <p className="rounded-md bg-muted/45 p-2">
            <span className="font-semibold">接下来盯谁：</span>
            {analysis.nextCheck}
          </p>
          <p className="text-muted-foreground">{analysis.boundary}</p>
        </div>
      ) : null}
      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-medium">
          展开身份、分钟路径与原始依据
        </summary>
        {candidate.interpretation ? (
          <div className="mt-3 grid gap-3 rounded-lg border bg-background/70 p-3 text-sm leading-6 sm:grid-cols-2">
            <div>
              <p className="font-semibold">
                身份依据 · {candidate.interpretation.identity.label}
              </p>
              <p className="text-muted-foreground">
                {candidate.interpretation.identity.basis}
              </p>
            </div>
            <div>
              <p className="font-semibold">
                当下反馈 · {candidate.interpretation.feedback.label}
              </p>
              <p className="text-muted-foreground">
                {candidate.interpretation.feedback.basis}
              </p>
            </div>
            <div className="sm:col-span-2">
              <p className="font-semibold">
                影响范围 · {candidate.interpretation.influence.label}
              </p>
              {candidate.interpretation.influence.groups.map((group) => (
                <p
                  key={`${group.concept}-${group.direction}`}
                  className={
                    group.direction === 'down' ? 'market-down' : 'market-up'
                  }
                >
                  {group.concept} ·{' '}
                  {group.direction === 'down' ? '负向' : '正向'}：
                  {group.members
                    .map((m) => `${m.name} ${m.time}（滞后${m.lag}分钟）`)
                    .join('、')}
                  {group.historyDays.length
                    ? `；另有${group.historyDays.length}个同题材同方向历史观察日（非连续性认证）`
                    : '；尚无同题材同方向跨日记录'}
                </p>
              ))}
              <p className="text-muted-foreground">
                {candidate.interpretation.influence.basis}
              </p>
            </div>
            <div className="sm:col-span-2 border-t pt-2">
              <p>
                <span className="font-semibold">反证与限制：</span>
                {candidate.interpretation.counterEvidence.join('；')}
              </p>
              <p className="mt-1">
                <span className="font-semibold">后续怎么判断：</span>
                {candidate.interpretation.nextCheck}
              </p>
            </div>
          </div>
        ) : null}
        <PricePathFacts path={path} />
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <span
            className={
              candidate.changePct !== null && candidate.changePct >= 0
                ? 'market-up'
                : 'market-down'
            }
          >
            涨幅 {pct(candidate.changePct)}
          </span>
          <span>
            报价 {candidate.quoteTime ?? '—'} · {candidate.quoteState}
          </span>
          <span>
            涨速 {pct(candidate.speedPct)}
            {candidate.amount !== null ? ` · 额${candidate.amount}` : ''}
          </span>
        </div>
        <p className="mt-2 text-xs leading-5">
          入池：{candidate.reasons.join('；') || '暂无可解释召回依据'}
        </p>
        {candidate.scopeReason ? (
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            当前范围：{candidate.scope ?? '未标注'} · {candidate.scopeReason}
          </p>
        ) : null}
        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
          状态依据：{candidate.statusBasis}
          {candidate.transitionTrace.length
            ? ` · ${candidate.transitionTrace.at(-1)!.from ?? '无前态'}→${candidate.transitionTrace.at(-1)!.to}（${candidate.transitionTrace.at(-1)!.observedAt}）`
            : ''}
        </p>
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer font-medium">
            展开九维原始事实矩阵
          </summary>
          <div className="mt-2">
            <p className="mb-2 leading-5 text-muted-foreground">
              可核验事实：{candidate.confirmedEvidence.join('；') || '暂无'}
              <br />
              缺口：{candidate.missingEvidence.join('；') || '暂无'}
            </p>
            <DimensionGrid dimensions={candidate.dimensions} />
            <div className="mt-3 space-y-1 rounded-md border p-2">
              <p className="font-medium">可见证据驱动的状态迁移</p>
              {candidate.transitionTrace.map((step, index) => (
                <p
                  key={`${step.observedAt}-${index}`}
                  className="text-[11px] leading-5 text-muted-foreground"
                >
                  {step.observedAt} · {step.from ?? '首次召回'} → {step.to}：
                  {step.evidence}（{step.source}）
                </p>
              ))}
            </div>
          </div>
        </details>
      </details>
    </article>
  );
}

function ComparativeReading({ reading }: { reading: CoreComparativeReading }) {
  return (
    <section
      aria-label="核心竞争与分歧分析"
      className="space-y-3 rounded-lg border border-sky-500/30 bg-sky-500/[0.035] p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">核心竞争与分歧 · 放在一起判断</h3>
          <p className="mt-1 text-sm text-muted-foreground">{reading.scope}</p>
        </div>
        <Badge variant="outline">{reading.state}</Badge>
      </div>
      {reading.cases.length ? (
        reading.cases.map((item) => (
          <article
            key={item.id}
            className="rounded-lg border bg-background/80 p-3 text-sm leading-6"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h4
                className={cn(
                  'font-semibold',
                  item.verdict === 'PRESSURE_REMAINS'
                    ? 'market-down'
                    : item.verdict === 'SPLIT'
                      ? 'text-amber-700 dark:text-amber-400'
                      : '',
                )}
              >
                {item.question}
              </h4>
              {item.state !== 'READY' ? (
                <Badge variant="outline">{item.state}</Badge>
              ) : null}
            </div>
            <p className="mt-2">{item.reading}</p>
            <p className="mt-2 border-l-2 border-sky-500/40 pl-3">
              {item.nextCheck}
            </p>
            <details className="mt-2 text-muted-foreground">
              <summary className="cursor-pointer">
                为什么这样比较 · 依据与边界
              </summary>
              <p className="mt-1">{item.premise}</p>
              <p>{item.boundary}</p>
            </details>
          </article>
        ))
      ) : (
        <p className="text-sm leading-6">
          当前证据不足以把同身位、方向响应与失败侧放在同一窗口比较。下方保留已知个股事实，不以空样本判断整体修复或退潮。
        </p>
      )}
    </section>
  );
}

type ExtendedCoreReading = NonNullable<
  ReturnType<typeof shortEmotionReading>['core']
> & {
  activeCandidates?: CoreCandidate[];
  historicalCandidates?: CoreCandidate[];
  attackerObservations?: TapeStock[];
  tape?: { rows: TapeStock[] } | null;
};

function coreView(
  core: ReturnType<typeof shortEmotionReading>['core'],
): ExtendedCoreReading | null {
  return core ? (core as ExtendedCoreReading) : null;
}

function AttackerObservations({ rows }: { rows: TapeStock[] }) {
  return (
    <section className="rounded-lg border border-violet-500/25 bg-violet-500/[0.035] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold">盘中新进攻观察</h4>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            原始分钟价格观察，不是确认证券龙头；普通首板不自动进入核心名单，行业比较也不等于概念因果。
          </p>
        </div>
        <Badge variant="outline">{rows.length}只可见样本</Badge>
      </div>
      {rows.length ? (
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {rows.map((row) => (
            <article
              key={row.code}
              className="rounded-md border bg-background/60 p-2 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {row.name}{' '}
                  <span className="font-mono text-muted-foreground">
                    {row.code}
                  </span>
                </span>
                <span
                  className={
                    row.changePct !== null && row.changePct >= 0
                      ? 'market-up'
                      : 'market-down'
                  }
                >
                  {pct(row.changePct)}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                窗口 {row.firstTime ?? '—'}—{row.lastTime ?? '—'} · 报价{' '}
                {row.quoteTime ?? '—'} · {row.supportLabel}
              </p>
              <p className="mt-1 leading-5">
                相对发动：{row.initiative.label}。
                {row.initiative.facts.join('；')}
              </p>
              <p className="mt-1 leading-5">
                之前已强：
                {row.initiative.facts
                  .filter((fact) => fact.includes('此前已强'))
                  .join('；') || '未见已知先强者'}
              </p>
              <p className="leading-5">
                随后响应：
                {row.response.facts.join('；') || '本比较窗口未见随后响应'}
              </p>
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          当前没有可读的程序核心名单之外进攻窗口。
        </p>
      )}
    </section>
  );
}

function CoreFeedback({
  reading,
}: {
  reading: ReturnType<typeof shortEmotionReading>;
}) {
  const core = reading.core;
  if (!core) return null;
  const feedback = core.highFeedback;
  const metrics = [
    ['强', feedback.strong],
    ['分歧', feedback.disagreement],
    ['断板影响', feedback.brokenImpact],
    ['深水', feedback.deepWater],
    ['跌停/极端', feedback.extreme],
    ['反核尝试', feedback.antiAttempt],
    ['修复扩散', feedback.repairSpread],
    ['退出', feedback.exits],
  ] as const;
  const middle = core.middle;
  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-background/60 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-xs font-semibold">高标群体反馈</h4>
          <span className="text-[10px] text-muted-foreground">
            覆盖 {feedback.covered}/{feedback.denominator ?? '—'} ·{' '}
            {feedback.state}
          </span>
        </div>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map(([label, metric]) => (
            <div key={label} className="rounded-md border px-2 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span>{label}</span>
                <span className="text-[10px] text-muted-foreground">
                  {metric.state}
                </span>
              </div>
              <p className="mt-1 font-semibold">
                <MetricValue metric={metric} />
              </p>
              <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                {metric.detail}
              </p>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-lg border bg-background/60 p-3 text-xs leading-5">
        <h4 className="font-semibold">中位真实梯队反馈</h4>
        <p className="mt-1">
          晋级{' '}
          <span className="font-mono">
            {middle.promoted ?? '—'}/{middle.denominator ?? '—'}
          </span>{' '}
          · 深水{' '}
          <span className="font-mono">
            {middle.deepWater ?? `已知${middle.deepWaterKnown}`}/
            {middle.sampleCount}
          </span>{' '}
          · 炸板{' '}
          <span className="font-mono">
            {middle.failed ?? '—'}/{middle.sampleCount}
          </span>{' '}
          · 跌停{' '}
          <span className="font-mono">
            {middle.limitDown ?? '—'}/{middle.sampleCount}
          </span>{' '}
          · 连续两日负反馈{' '}
          <span className="font-mono">
            {middle.twoDayNegative ?? `已知${middle.twoDayNegativeKnown}`}（覆盖
            {middle.twoDayCovered}/{middle.sampleCount}）
          </span>{' '}
          · 天地板（分钟采样） <MetricValue metric={middle.skyFloor} />
        </p>
        <p className="mt-1 text-muted-foreground">
          {middle.spread.detail} · 高位方向 {middle.spread.state}，低位方向{' '}
          {middle.spread.state}
        </p>
        <p className="mt-1 text-muted-foreground">{core.middle.detail}</p>
        <details className="mt-2">
          <summary className="cursor-pointer font-medium">
            中位成员、晋级资格与逐股证据
          </summary>
          {middle.rows.map((row) => (
            <p
              key={row.code}
              className="mt-1 text-[11px] text-muted-foreground"
            >
              {row.name} {row.code} · {row.reasons.join('；')} ·{' '}
              {row.eligibleForPromotion
                ? '纳入晋级分母'
                : '断板跟踪，不纳入晋级分母'}{' '}
              · 当前{pct(row.quote.value)}（{row.quote.time ?? '时刻缺失'}，
              {row.quote.state}） · 前一交易日{pct(row.previousChangePct)}
            </p>
          ))}
        </details>
      </div>
    </div>
  );
}

export function ShortEmotionPanel({
  facts,
  previous,
  ladder,
  coreEvidence,
}: {
  facts: EmotionFacts;
  previous?: EmotionFacts | null;
  ladder?: ReadingLadder | null;
  coreEvidence?: EmotionCoreEvidence | null;
}) {
  const reading = shortEmotionReading(facts, previous, ladder, coreEvidence);
  const core = coreView(reading.core);
  const allCandidates = core?.candidates ?? [];
  const activeCandidates =
    core?.activeCandidates ??
    allCandidates.filter((candidate) => candidate.scope !== 'HISTORY');
  const historicalCandidates =
    core?.historicalCandidates ??
    allCandidates.filter((candidate) => candidate.scope === 'HISTORY');
  const tapeRows = core?.tape?.rows ?? coreEvidence?.tracking?.tape?.rows ?? [];
  const tapeByCode = new Map(tapeRows.map((row) => [row.code, row]));
  const coreCodes = new Set(allCandidates.map((candidate) => candidate.code));
  const attackerObservations =
    core?.attackerObservations ??
    tapeRows.filter(
      (row) => !coreCodes.has(row.code) && row.upEvents.length > 0,
    );
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
            高标与接力 · 看竞争、分歧与修复
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            情绪池：{date(facts.date)} {facts.cutoff}
            {facts.stale ? '（同日旧快照）' : ''} · 核心判断：
            {reading.core.observedAt} ·{' '}
            {reading.core.decisionMode === 'LIVE' ? '实时新判断' : '固定时点'} ·
            报价以逐股时刻为准
          </p>
        </div>
        <Badge variant="outline">
          {reading.status} · {reading.quoteComplete ? '反馈完整' : '证据有缺口'}
        </Badge>
      </div>

      {core ? (
        <details className="rounded-lg border border-amber-500/30 bg-amber-500/[0.045] p-3">
          <summary className="cursor-pointer text-sm font-semibold">
            观察范围与已知强弱 · 展开统计
          </summary>
          <p className="mt-1 text-sm leading-6">{core.summary}</p>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            高标反馈按当前活跃与竞争观察计数；历史身份保留在单独展开区，不混当前分母，也不能据此当作已退出。
          </p>
        </details>
      ) : null}

      {core?.comparativeReading ? (
        <ComparativeReading reading={core.comparativeReading} />
      ) : null}

      <CoreFeedback reading={reading} />

      <div className="grid gap-4 xl:grid-cols-2">
        <JudgmentCard
          kind="高标生态"
          label={reading.highBoard.label}
          tone={reading.highBoard.tone}
          summary={reading.highBoard.summary}
          badge={`当前角色观察 ${activeCandidates.length}只`}
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

      <section className="space-y-3 rounded-lg border border-sky-500/25 bg-sky-500/[0.035] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">
            回到个股 · 它在这场竞争里说明什么
          </h3>
          <span className="text-xs text-muted-foreground">
            {activeCandidates.length
              ? `${activeCandidates.length}只活跃／竞争观察；普通首板、孤立高板不自动确认`
              : '候选缺失，不以0伪装'}
          </span>
        </div>
        {activeCandidates.length ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {activeCandidates.map((candidate) => (
              <CoreCandidateCard
                key={candidate.code}
                candidate={candidate}
                pricePath={tapeByCode.get(candidate.code)}
                analysis={core?.comparativeReading.stocks[candidate.code]}
              />
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            当前没有可解释候选，或 coreEvidence
            日期/截止时点尚未对齐；历史身份不会因单次接口失败被清空。
          </p>
        )}
      </section>

      {historicalCandidates.length ? (
        <details className="rounded-lg border bg-background/60 p-3 text-xs">
          <summary className="cursor-pointer font-semibold">
            历史身份跟踪 · {historicalCandidates.length}
            只（保留身份，不混当前分母）
          </summary>
          <p className="mt-2 leading-5 text-muted-foreground">
            此处保留可追溯的历史身份；当前影响是否仍在，需要新的价格、响应和衰减证据核验，不能把它们当作已退出。
          </p>
          <div className="mt-3 grid gap-3 xl:grid-cols-2">
            {historicalCandidates.map((candidate) => (
              <CoreCandidateCard
                key={candidate.code}
                candidate={candidate}
                pricePath={tapeByCode.get(candidate.code)}
                analysis={core?.comparativeReading.stocks[candidate.code]}
              />
            ))}
          </div>
        </details>
      ) : null}

      <AttackerObservations rows={attackerObservations} />

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
          接力封板率 → 失败成本 → 高中低梯队 → 行业接力线索 → 封板记录 →
          相邻收盘边际”判断。接力封板率=成功晋级÷触及晋级板，不再使用全市场封板率代替。
          非一字、开板后封住都不等于健康换手；承接质量还需逐分钟量价与同批失败侧对照。
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
