'use client';

import { useMemo, useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  FlaskConical,
  GitBranch,
  ShieldAlert,
} from 'lucide-react';
import type {
  DynamicMainlineDay,
  DynamicMainlineDocument,
  DynamicMainlineNode,
} from '@/lib/dynamic-mainline-source';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';

type Filter = 'ALL' | 'RISE' | 'FALL' | 'REPAIR';

const EVENT_META: Record<
  string,
  { label: string; filter: Exclude<Filter, 'ALL'>; tone: string }
> = {
  SECTOR_STARTUP: {
    label: '板块启动',
    filter: 'RISE',
    tone: 'border-red-500/30 bg-red-500/[0.045]',
  },
  SECTOR_DIFFUSION: {
    label: '领涨扩散',
    filter: 'RISE',
    tone: 'border-red-500/30 bg-red-500/[0.045]',
  },
  TARGET_IGNITION: {
    label: '个股点火',
    filter: 'RISE',
    tone: 'border-red-500/30 bg-red-500/[0.045]',
  },
  CORE_LED_START: {
    label: '核心先动',
    filter: 'RISE',
    tone: 'border-red-500/30 bg-red-500/[0.045]',
  },
  CORE_BREADTH_DIVERGENCE: {
    label: '核心与宽度分歧',
    filter: 'FALL',
    tone: 'border-amber-500/35 bg-amber-500/[0.055]',
  },
  SECTOR_REALIZATION: {
    label: '板块兑现',
    filter: 'FALL',
    tone: 'border-emerald-500/30 bg-emerald-500/[0.045]',
  },
  REALIZATION: {
    label: '个股兑现',
    filter: 'FALL',
    tone: 'border-emerald-500/30 bg-emerald-500/[0.045]',
  },
  ANTI_NUCLEAR_RECOVERY: {
    label: '反核拉回',
    filter: 'REPAIR',
    tone: 'border-violet-500/30 bg-violet-500/[0.045]',
  },
  RECOVERY_RETEST: {
    label: '修复后回踩',
    filter: 'REPAIR',
    tone: 'border-violet-500/30 bg-violet-500/[0.045]',
  },
  SECOND_RECOVERY_SUPPORTED: {
    label: '有支持的二次承接',
    filter: 'REPAIR',
    tone: 'border-violet-500/30 bg-violet-500/[0.045]',
  },
  TARGET_ONLY_SECOND_RECOVERY: {
    label: '孤立二次修复',
    filter: 'REPAIR',
    tone: 'border-amber-500/35 bg-amber-500/[0.055]',
  },
};

const EVIDENCE_LABELS: Record<string, string> = {
  target_return_pct: '当时个股涨跌',
  target_change_window_pct: '短窗个股变化',
  core_return_pct: '当时前日核心涨跌',
  core_change_window_pct: '短窗核心变化',
  sector_positive_rate: '板块上涨宽度',
  median_change_window_pct: '板块中位短窗变化',
  breadth_change: '上涨宽度变化',
  positive_rate: '板块上涨宽度',
  strong_count: '2%以上个股',
  positive_rate_drop_from_peak: '宽度较高点回落',
  median_return_pct: '板块中位涨跌',
  median_fade_from_peak_pct: '中位数较高点回落',
  strong_count_drop_from_peak: '强势股较高点减少',
  intraday_low_return_pct: '日内深水低点',
  recovery_from_low_pct: '从低点拉回',
  first_recovery_peak_pct: '首次修复高点',
  drawdown_pct: '修复后回踩',
  retest_low_return_pct: '回踩低点',
  recovery_from_retest_pct: '二次拉回',
  intraday_high_return_pct: '日内高点',
  fade_from_high_pct: '较高点回落',
};

const pctKeys = new Set([
  'target_return_pct',
  'target_change_window_pct',
  'core_return_pct',
  'core_change_window_pct',
  'median_change_window_pct',
  'median_return_pct',
  'median_fade_from_peak_pct',
  'intraday_low_return_pct',
  'recovery_from_low_pct',
  'first_recovery_peak_pct',
  'drawdown_pct',
  'retest_low_return_pct',
  'recovery_from_retest_pct',
  'intraday_high_return_pct',
  'fade_from_high_pct',
]);
const rateKeys = new Set([
  'sector_positive_rate',
  'positive_rate',
  'breadth_change',
  'positive_rate_drop_from_peak',
]);

function dateLabel(value: string) {
  return /^\d{8}$/.test(value)
    ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`
    : value;
}

function stockNames(node: DynamicMainlineNode) {
  const names = [
    ...new Set(node.stocks.map((stock) => stock.name).filter(Boolean)),
  ];
  return names.length ? names.join('、') : '代表股待补';
}

function coreNames(node: DynamicMainlineNode) {
  return [
    ...new Set(
      node.stocks
        .map((stock) => stock.priorCoreName)
        .filter((name): name is string => Boolean(name)),
    ),
  ];
}

function headline(node: DynamicMainlineNode) {
  const stocks = stockNames(node);
  const cores = coreNames(node).join('、');
  switch (node.eventType) {
    case 'SECTOR_STARTUP':
      return `${node.sector}启动，${stocks}率先加速。`;
    case 'SECTOR_DIFFUSION':
      return `${node.sector}从局部转向扩散，${stocks}等多股跟随。`;
    case 'CORE_BREADTH_DIVERGENCE':
      return `${node.sector}核心仍强，但上涨宽度回落，核心与跟风开始分歧。`;
    case 'SECTOR_REALIZATION':
      return `${node.sector}强势股数量与中位涨幅同时回落，出现板块兑现。`;
    case 'CORE_LED_START':
      return `${cores || stocks}先动，${node.sector}同组股进入跟随观察。`;
    case 'TARGET_IGNITION':
      return `${stocks}主动点火，${node.sector}开始出现同组响应。`;
    case 'ANTI_NUCLEAR_RECOVERY':
      return `${stocks}从日内深水快速拉回，${node.sector}出现反核修复。`;
    case 'RECOVERY_RETEST':
      return `${stocks}首次修复后回踩，承接开始重新接受检验。`;
    case 'SECOND_RECOVERY_SUPPORTED':
      return `${stocks}回踩后再次修复，核心或同组宽度给出支持。`;
    case 'TARGET_ONLY_SECOND_RECOVERY':
      return `${stocks}出现二次修复，但核心和同组尚未确认。`;
    case 'REALIZATION':
      return `${stocks}从日内高点回落，${node.sector}个股端出现兑现。`;
    default:
      return `${node.sector}出现动态转折，${stocks}是当时代表股。`;
  }
}

function evidenceValue(key: string, value: string | number | boolean) {
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'string') return value;
  if (pctKeys.has(key)) return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
  if (rateKeys.has(key)) return `${(value * 100).toFixed(1)}%`;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function evidenceChips(node: DynamicMainlineNode) {
  return Object.entries(node.evidence)
    .filter(([key]) => EVIDENCE_LABELS[key])
    .slice(0, 4);
}

function ProbabilityProgress({
  data,
}: {
  data: DynamicMainlineDocument['probabilityResearch'];
}) {
  const progress = Math.min(
    100,
    (data.dynamicDates / Math.max(1, data.dynamicDateTarget)) * 100,
  );
  const gates = [
    [
      '动态交易日',
      data.gates.atLeast60DynamicDates,
      `${data.dynamicDates}/${data.dynamicDateTarget}日`,
    ],
    [
      '独立标签样本',
      data.gates.atLeast300LabeledCandidates && data.gates.separateLabels,
      `${data.labeledCandidates}只候选`,
    ],
    [
      '滚动留出验证',
      data.gates.rollingHoldoutCompleted,
      data.gates.rollingHoldoutCompleted ? '已完成' : '待新周期',
    ],
    [
      '概率校准',
      data.gates.probabilityCalibrated,
      data.gates.probabilityCalibrated ? '通过' : '未通过',
    ],
  ] as const;
  return (
    <Card className="border-violet-500/25">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="size-5 text-violet-500" />
          修复概率·样本积累中
        </CardTitle>
        <CardDescription>
          收红、严格反包、重新涨停分开学习；当前只展示研究进度，不给个股虚假概率
        </CardDescription>
        <CardAction>
          <Badge variant="outline" className="status-degraded">
            尚未校准
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">旧截面母样本</p>
            <p className="mt-1 text-2xl font-semibold">
              {data.checkpointDates}日
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {data.checkpointEvents.toLocaleString()}条事件·
              {data.checkpointPathSamples}条盘中路径·
              {data.checkpointRelationReady}条关系齐备
            </p>
          </div>
          <div className="rounded-lg bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">动态事件交易日</p>
            <p className="mt-1 text-2xl font-semibold">
              {data.dynamicDates}/{data.dynamicDateTarget}
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-violet-500"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
          <div className="rounded-lg bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">动态候选与事件</p>
            <p className="mt-1 text-2xl font-semibold">
              {data.dynamicCandidates.toLocaleString()}只
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {data.dynamicCandidateEvents.toLocaleString()}条个股动态关系事件
            </p>
          </div>
          <div className="rounded-lg bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">独立结果标签</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {data.labels.map((label) => (
                <Badge key={label.key} variant="secondary">
                  {label.label}
                </Badge>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              标签只用于事后验证，不回填盘中特征
            </p>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {gates.map(([label, passed, detail]) => (
            <div
              key={label}
              className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
            >
              <span className="flex items-center gap-2">
                {passed ? (
                  <CheckCircle2 className="size-4 text-emerald-500" />
                ) : (
                  <ShieldAlert className="size-4 text-amber-500" />
                )}
                {label}
              </span>
              <span className="text-xs text-muted-foreground">{detail}</span>
            </div>
          ))}
        </div>
        <p className="text-xs leading-5 text-muted-foreground">{data.note}</p>
      </CardContent>
    </Card>
  );
}

function DynamicDaySummary({ day }: { day: DynamicMainlineDay }) {
  const rising = day.nodes.filter(
    (node) => EVENT_META[node.eventType]?.filter === 'RISE',
  ).length;
  const falling = day.nodes.filter(
    (node) => EVENT_META[node.eventType]?.filter === 'FALL',
  ).length;
  const repairing = day.nodes.filter(
    (node) => EVENT_META[node.eventType]?.filter === 'REPAIR',
  ).length;
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Card size="sm">
        <CardHeader>
          <CardTitle>动态主线节点</CardTitle>
          <CardAction className="text-xl font-semibold">
            {day.visibleNodes}
          </CardAction>
          <CardDescription>
            {day.visibleSectorCount}个板块链·隐藏{day.hiddenNodes}个低优先级节点
          </CardDescription>
        </CardHeader>
      </Card>
      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowUpRight className="size-4 market-up" />
            启动与扩散
          </CardTitle>
          <CardAction className="market-up text-xl font-semibold">
            {rising}
          </CardAction>
          <CardDescription>板块跨阈值、核心先动与领涨扩散</CardDescription>
        </CardHeader>
      </Card>
      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArrowDownRight className="size-4 market-down" />
            分歧与兑现
          </CardTitle>
          <CardAction className="market-down text-xl font-semibold">
            {falling}
          </CardAction>
          <CardDescription>核心与宽度分离、强势股数量回落</CardDescription>
        </CardHeader>
      </Card>
      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitBranch className="size-4 text-violet-500" />
            反核与二次承接
          </CardTitle>
          <CardAction className="text-xl font-semibold text-violet-600">
            {repairing}
          </CardAction>
          <CardDescription>深水拉回、回踩和再次修复分开看</CardDescription>
        </CardHeader>
      </Card>
    </section>
  );
}

export function DynamicMainlineBoard({
  data,
}: {
  data: DynamicMainlineDocument;
}) {
  const [selectedDate, setSelectedDate] = useState(
    data.dates.at(-1)?.date ?? '',
  );
  const [filter, setFilter] = useState<Filter>('ALL');
  const [expanded, setExpanded] = useState(false);
  const day =
    data.dates.find((item) => item.date === selectedDate) ?? data.dates.at(-1);
  const nodes = useMemo(() => {
    const rows = day?.nodes ?? [];
    const filtered =
      filter === 'ALL'
        ? rows
        : rows.filter((node) => EVENT_META[node.eventType]?.filter === filter);
    return expanded ? filtered : filtered.slice(0, 30);
  }, [day, expanded, filter]);
  const totalFiltered =
    filter === 'ALL'
      ? (day?.nodes.length ?? 0)
      : (day?.nodes ?? []).filter(
          (node) => EVENT_META[node.eventType]?.filter === filter,
        ).length;

  if (!day)
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        动态主线研究数据尚未生成。
      </div>
    );

  return (
    <div className="space-y-4">
      <ProbabilityProgress data={data.probabilityResearch} />
      <DynamicDaySummary day={day} />
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Activity className="size-5 text-cyan-500" />
                动态盘面主线·历史回放
              </CardTitle>
              <CardDescription className="mt-1">
                按真实转折分钟生成，依次看谁先动、是否扩散、何时兑现、回踩后有没有二次承接
              </CardDescription>
            </div>
            <Badge variant="outline" className="status-degraded">
              历史回放·非当前实时
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect
              aria-label="动态主线回放日期"
              value={day.date}
              onChange={(event) => {
                setSelectedDate(event.target.value);
                setExpanded(false);
              }}
            >
              {data.dates.map((item) => (
                <NativeSelectOption key={item.date} value={item.date}>
                  {dateLabel(item.date)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {(
              [
                ['ALL', '全部主线'],
                ['RISE', '启动·扩散'],
                ['FALL', '分歧·兑现'],
                ['REPAIR', '反核·承接'],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                size="sm"
                variant={filter === value ? 'default' : 'outline'}
                onClick={() => {
                  setFilter(value);
                  setExpanded(false);
                }}
              >
                {label}
              </Button>
            ))}
            <span className="text-xs text-muted-foreground">
              {day.minuteSnapshots}个分钟快照·{day.candidateWithObservations}/
              {day.candidateCount}只候选有观测
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-0">
            {nodes.map((node, index) => {
              const meta = EVENT_META[node.eventType] ?? {
                label: node.eventType,
                filter: 'RISE' as const,
                tone: 'border-border bg-muted/20',
              };
              const chips = evidenceChips(node);
              return (
                <article
                  key={node.id}
                  className="grid grid-cols-[54px_18px_minmax(0,1fr)] gap-x-2 sm:grid-cols-[68px_20px_minmax(0,1fr)] sm:gap-x-3"
                >
                  <time className="pt-4 text-right font-mono text-sm font-semibold tabular-nums">
                    {node.time}
                  </time>
                  <div className="relative flex justify-center">
                    <span
                      className={`absolute w-px bg-border ${index === 0 ? 'top-5' : 'top-0'} ${index === nodes.length - 1 ? 'bottom-5' : 'bottom-0'}`}
                    />
                    <span
                      className={`relative mt-[18px] size-2.5 rounded-full ring-4 ring-background ${meta.filter === 'FALL' ? 'bg-emerald-500' : meta.filter === 'REPAIR' ? 'bg-violet-500' : 'bg-red-500'}`}
                    />
                  </div>
                  <div className={`mb-4 rounded-lg border p-3.5 ${meta.tone}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{node.sector}</Badge>
                      <Badge variant="secondary">{meta.label}</Badge>
                      {node.mergedRawEvents > 1 ? (
                        <span className="text-xs text-muted-foreground">
                          合并{node.mergedRawEvents}条相邻证据·确认至
                          {node.lastConfirmedAt}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-3 text-[15px] leading-7 font-semibold sm:text-base">
                      {headline(node)}
                    </p>
                    {chips.length ? (
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        {chips.map(([key, value]) => (
                          <span key={key}>
                            {EVIDENCE_LABELS[key]}
                            <strong className="ml-1 font-medium text-foreground">
                              {evidenceValue(key, value)}
                            </strong>
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <details className="mt-2 text-xs text-muted-foreground">
                      <summary className="cursor-pointer">
                        查看代表股、关系链与边界
                      </summary>
                      <div className="mt-2 space-y-2 leading-5">
                        <p>
                          代表股：
                          {node.stocks
                            .map((stock) => `${stock.name}（${stock.code}）`)
                            .join('、') || '待补'}
                          。
                        </p>
                        {coreNames(node).length ? (
                          <p>前日冻结核心：{coreNames(node).join('、')}。</p>
                        ) : null}
                        <p>
                          同板块关系链覆盖{node.chain.phaseCount}类转折、
                          {node.chain.stockCount}只股；排序只用节点当时强度，
                          不使用收盘结果。“先动”只表示可观测时序，不声称因果。
                        </p>
                      </div>
                    </details>
                  </div>
                </article>
              );
            })}
          </div>
          {totalFiltered > 30 ? (
            <Button
              variant="outline"
              className="ml-[74px] sm:ml-[91px]"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? '收起后续节点' : `展开全部${totalFiltered}个节点`}
            </Button>
          ) : null}
          <p className="mt-4 border-t pt-3 text-xs leading-5 text-muted-foreground">
            {data.sourceNotice}默认层只保留高重要性板块链与有支持的修复节点；
            其余{data.coverage.hiddenNodes.toLocaleString()}
            个低优先级节点仍保留在研究证据包中， 没有被删除。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
