'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { timelineHeadline } from '@/lib/timeline-evidence';
import {
  LadderOverview,
  toEmotionFacts,
} from '@/components/market-reading-board';
import { EmotionTrackingBoard } from '@/components/emotion-tracking-board';
import { UnifiedMarketBoard } from '@/components/unified-market-board';
import { unifiedMarketReading } from '@/lib/unified-market';
import {
  windowedRadarEvents,
  type RadarEvent,
  type RadarHistory,
  type RadarSnapshot as RadarData,
} from '@/lib/radar-evidence';
import {
  Activity,
  ArrowDownRight,
  ArrowLeftRight,
  ArrowUpRight,
  BrainCircuit,
  CalendarDays,
  Clock3,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Swords,
  TrendingUp,
  Zap,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart as RechartsLineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  CloseDatePicker,
  EmotionCycleBoard,
  IntradayEmotionBoard,
} from '@/components/emotion-cycle-board';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  CLOSE_HISTORY,
  LATEST_CLOSE_DATE,
  type CloseHistoryDocument,
  type IntradayEmotionSnapshot,
  type CloseStock,
} from '@/lib/close-history';

type DataState = 'READY' | 'DEGRADED' | 'MISSING';

type SectorFlowPoint = {
  time: string;
  mainNetInflow: number;
};

type SectorFlowSeries = {
  code: string;
  name: string;
  changePct: number | null;
  latestMainNetInflow: number;
  delta5m: number | null;
  delta15m: number | null;
  delta30m: number | null;
  points: SectorFlowPoint[];
  persistenceLabel?: string;
  detailState?: DataState;
  detailBasis?: string;
  subgroups?: Array<{ name: string; count: number; leaders: string[] }>;
  representatives?: Array<{
    code: string;
    name: string;
    industry: string;
    changePct: number | null;
    speedPct: number | null;
    mainNetInflow: number | null;
  }>;
};

type FlowData = {
  status: DataState;
  curveState: DataState;
  splitState: DataState;
  retrievedAt: string;
  tradeDate: string;
  requestedDate?: string;
  sessionState?: 'LIVE' | 'CLOSED';
  phase: string;
  lastPointTime: string | null;
  source?: string;
  basis?: string;
  reason?: string;
  coverage?: { requested: number; available: number };
  series: SectorFlowSeries[];
  split: {
    inflow: SectorFlowSeries[];
    outflow: SectorFlowSeries[];
    cumulativeInflow: SectorFlowSeries[];
    cumulativeOutflow: SectorFlowSeries[];
    persistentStrong: SectorFlowSeries[];
    persistentWeak: SectorFlowSeries[];
    positiveCount: number;
    negativeCount: number;
  };
};

type Promotion = {
  level: string;
  started: number;
  advanced: number;
  failed: number;
  dropped: number;
  ratePct: number;
  lead: string[];
};

type Competitor = {
  code: string;
  name: string;
  fromHeight: number;
  toHeight: number;
  state: 'SEALED' | 'FAILED' | 'DROPPED';
  changePct: number | null;
  speedPct: number | null;
  quoteState: DataState;
  quoteTime?: string;
  quoteSource?: string;
  amount: number | null;
  firstTouch: string | null;
  lastSeal: string | null;
  breakCount: number;
  industry: string;
  sealFund: number | null;
};

type LadderData = {
  status: DataState;
  retrievedAt: string;
  tradeDate?: string;
  previousTradeDate?: string;
  requestedDate?: string;
  phase?: string;
  sessionState?: 'LIVE' | 'CLOSED';
  sourceState?: 'LIVE' | 'ARCHIVED' | 'STALE';
  sealedStocks?: CloseStock[];
  priorDateState?: DataState;
  reason?: string;
  counts?: {
    previousLimitUp: number;
    todaySealed: number;
    todayFailed: number;
  };
  coverage?: {
    competitors: number;
    quoteReady: number;
    priceReady?: number;
    speedReady?: number;
    duplicatesRemoved?: number;
  };
  promotion: Promotion[];
  competitors: Competitor[];
};

type SpeedRow = {
  code: string;
  name: string;
  price: number | null;
  changePct: number | null;
  speedPct: number | null;
  amount: number | null;
  turnoverPct: number | null;
  mainNetInflow: number | null;
  industry: string;
  concepts: string[];
  metadataState: DataState;
  recentLimitCount: number | null;
  recentLimitSessions: number;
  recentLimitState: DataState;
  recentLimitMethod: string;
  limitPct: number;
  distanceToLimitPct: number | null;
  status: string;
};

type SpeedData = {
  status: DataState;
  retrievedAt: string;
  tradeDate: string;
  requestedDate?: string;
  phase?: string;
  sessionState?: 'LIVE' | 'CLOSED';
  reason?: string;
  coverage?: {
    requested: number;
    conceptReady: number;
    recentLimitReady: number;
  };
  rows: SpeedRow[];
};

type MarketTimelineDriver = {
  code: string;
  name: string;
  industry: string;
  atTimeChangePct?: number | null;
  windowChangePct: number | null;
  mainNetInflow: number | null;
  limitState?: 'LIMIT_UP' | 'LIMIT_DOWN' | 'NONE' | 'UNKNOWN';
  role:
    | '同窗价格确认'
    | '同窗方向相反'
    | '同窗价格持平'
    | '同窗窗口缺口'
    | '分钟价格不可用';
};

type MarketTimelineRelatedStock = {
  code: string;
  name: string;
  industry: string;
  changePct: number | null;
  speedPct: number | null;
  mainNetInflow: number | null;
};

type MarketTimelineEvent = {
  id: string;
  kind: 'START' | 'STRONG' | 'CASHOUT' | 'WEAKEN' | 'OBSERVE';
  label: '启动' | '延续强势' | '兑现' | '走弱' | '震荡观察';
  sectorCode: string;
  sectorName: string;
  windowStartTime: string;
  time: string;
  sectorChangePct: number | null;
  sectorDailyFlow: number;
  sectorAtTimeChangePct: number | null;
  sectorWindowChangePct: number | null;
  flowDelta: number;
  flowPreviousDelta: number;
  flowAcceleration: number;
  turnReason: 'FLOW_REVERSAL' | 'FLOW_ACCELERATION';
  indices: Array<{
    code: string;
    name: string;
    changePct: number | null;
    windowChangePct: number | null;
  }>;
  drivers: MarketTimelineDriver[];
  relatedStocks?: MarketTimelineRelatedStock[];
  driverState: DataState;
  driverBasis: string;
};

type MarketTimelineData = {
  status: DataState;
  retrievedAt: string;
  tradeDate: string;
  requestedDate?: string;
  sessionState?: 'LIVE' | 'CLOSED';
  phase: string;
  lastPointTime: string | null;
  reason?: string;
  basis?: string;
  coverage?: {
    sectors: number;
    events: number;
    timeNodes?: number;
    indices: number;
    checkedDrivers?: number;
    confirmedDrivers: number;
    relatedStocks?: number;
  };
  events: MarketTimelineEvent[];
};

type PollState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

function usePolling<T>(url: string, intervalMs: number): PollState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (document.visibilityState === 'hidden') return;
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const response = await fetch(url, { cache: 'no-store' });
      const payload = (await response.json()) as T & { reason?: string };
      if (!response.ok)
        throw new Error(payload.reason || `HTTP ${response.status}`);
      setData(payload);
      setError(null);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : '行情源短暂波动，正在自动重连',
      );
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, [url]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, refresh]);

  return { data, loading, error, refresh };
}

function useWindowedRadar(data: RadarData | null, failed: boolean) {
  const history = useRef<RadarHistory>(new Map());
  const [events, setEvents] = useState<RadarEvent[]>([]);

  useEffect(() => {
    if (!data) return;
    const update = () =>
      setEvents(
        windowedRadarEvents(
          failed ? { ...data, sourceState: 'STALE' } : data,
          history.current,
        ),
      );
    update();
    const timer = window.setInterval(update, 15_000);
    return () => window.clearInterval(timer);
  }, [data, failed]);

  return events;
}

function fmtPct(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value))
    return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

function fmtMoney(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value))
    return '—';
  const amount = value / 100_000_000;
  return `${amount > 0 ? '+' : ''}${amount.toFixed(2)}亿`;
}

function fmtFlowDirection(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value))
    return '数据待补';
  const magnitude = `${(Math.abs(value) / 100_000_000).toFixed(2)}亿`;
  if (value > 0) return `净流入 ${magnitude}`;
  if (value < 0) return `净流出 ${magnitude}`;
  return '净额 0';
}

function fmtAmount(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value))
    return '—';
  return `${(value / 100_000_000).toFixed(1)}亿`;
}

function fmtTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
  });
}

function fmtTradeDate(value?: string | null) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length === 8
    ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
    : value || '最近交易日';
}

function StateBadge({ state, label }: { state?: DataState; label?: string }) {
  if (!state) return <Badge variant="secondary">连接中</Badge>;
  if (state === 'READY')
    return (
      <Badge variant="outline" className="status-ready">
        {label ?? 'READY'}
      </Badge>
    );
  if (state === 'DEGRADED')
    return (
      <Badge variant="outline" className="status-degraded">
        {label ?? 'DEGRADED'}
      </Badge>
    );
  return <Badge variant="destructive">{label ?? 'MISSING'}</Badge>;
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function MarketCommandCenter({
  radarEvents,
  flow,
  emotion,
  ladder,
  marketNotice,
  onNavigate,
}: {
  radarEvents: RadarEvent[];
  flow: FlowData | null;
  emotion: IntradayEmotionSnapshot | null;
  ladder: LadderData | null;
  marketNotice: string | null;
  onNavigate: (tab: string) => void;
}) {
  const rising = radarEvents.find((event) => event.direction === 'up');
  const falling = radarEvents.find((event) => event.direction === 'down');
  const inflow = flow?.split.cumulativeInflow[0] ?? flow?.split.inflow[0];
  const outflow = flow?.split.cumulativeOutflow[0] ?? flow?.split.outflow[0];
  const leaderNames = emotion?.leaders?.length
    ? emotion.leaders.join('、')
    : ladder?.sealedStocks
        ?.filter((stock) => stock.height === emotion?.highestBoard)
        .map((stock) => stock.name)
        .join('、');
  const breadthRatio = emotion?.breadth.rowsAvailable
    ? (emotion.breadth.up / emotion.breadth.rowsAvailable) * 100
    : null;
  const emotionState = emotion
    ? [...new Set([emotion.indexMood, ...emotion.cycleNode.split(' · ')])].join(
        ' · ',
      )
    : '情绪数据连接中';
  const strongest = rising
    ? `${rising.name}明显拉升，${
        rising.drivers
          .slice(0, 3)
          .map((stock) => stock.name)
          .join('、') || '驱动股暂不可用'
      }`
    : '当前未检测到达到阈值的板块拉升';
  const weakest = falling
    ? `${falling.name}明显下跌，${
        falling.drivers
          .slice(0, 3)
          .map((stock) => stock.name)
          .join('、') || '领跌股暂不可用'
      }`
    : '当前未检测到达到阈值的集中走弱';

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-950 to-slate-900 text-slate-100 shadow-sm dark:border-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-4 py-3 sm:px-5">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="size-5 text-sky-400" />
            <h2 className="font-semibold">盘面决策台</h2>
            <Badge
              className="border-slate-700 bg-slate-900 text-slate-300"
              variant="outline"
            >
              {flow?.sessionState === 'LIVE' ? '盘中' : '最近定格'}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            {marketNotice ??
              `行情日期 ${fmtTradeDate(flow?.tradeDate ?? emotion?.tradeDate)}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {[
            ['overview', '盘面全景'],
            ['radar', '板块异动'],
            ['emotion', '情绪周期'],
            ['promotion', '连板天梯'],
            ['speed', '涨速共振'],
          ].map(([tab, label]) => (
            <Button
              key={tab}
              variant="outline"
              size="sm"
              className="border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 hover:text-white"
              onClick={() => onNavigate(tab)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-px bg-slate-800 sm:grid-cols-2 xl:grid-cols-5">
        <button
          className="min-h-32 bg-slate-950 p-4 text-left transition hover:bg-slate-900 sm:col-span-2"
          onClick={() => onNavigate('emotion')}
        >
          <span className="text-xs text-slate-400">情绪结论</span>
          <strong className="mt-2 block text-xl text-amber-300">
            {emotionState}
          </strong>
          <span className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-300">
            <span>
              涨停 <b className="text-red-400">{emotion?.limitUp ?? '—'}</b>
            </span>
            <span>
              炸板 <b className="text-amber-300">{emotion?.failed ?? '—'}</b>
            </span>
            <span>
              跌停{' '}
              <b className="text-emerald-400">{emotion?.limitDown ?? '—'}</b>
            </span>
            <span>
              封板率 <b>{emotion ? `${emotion.sealRate.toFixed(1)}%` : '—'}</b>
            </span>
            <span>
              上涨面{' '}
              <b>
                {breadthRatio === null ? '—' : `${breadthRatio.toFixed(1)}%`}
              </b>
            </span>
            <span>
              中位数 <b>{fmtPct(emotion?.breadth.medianChangePct)}</b>
            </span>
          </span>
        </button>

        <button
          className="min-h-32 bg-slate-950 p-4 text-left transition hover:bg-slate-900"
          onClick={() => onNavigate('radar')}
        >
          <span className="text-xs text-slate-400">主线 / 最强启动</span>
          <strong className="mt-2 block text-sm leading-6 text-red-300">
            {strongest}
          </strong>
          <span className="mt-2 block text-xs text-slate-400">
            {inflow
              ? `${inflow.name} ${fmtFlowDirection(inflow.latestMainNetInflow)}`
              : '等待价格与资金同向确认'}
          </span>
        </button>

        <button
          className="min-h-32 bg-slate-950 p-4 text-left transition hover:bg-slate-900"
          onClick={() => onNavigate('radar')}
        >
          <span className="text-xs text-slate-400">弱侧 / 最强下杀</span>
          <strong className="mt-2 block text-sm leading-6 text-emerald-300">
            {weakest}
          </strong>
          <span className="mt-2 block text-xs text-slate-400">
            {outflow
              ? `${outflow.name} ${fmtFlowDirection(outflow.latestMainNetInflow)}`
              : '等待价格与资金同向确认'}
          </span>
        </button>

        <button
          className="min-h-32 bg-slate-950 p-4 text-left transition hover:bg-slate-900"
          onClick={() => onNavigate('promotion')}
        >
          <span className="text-xs text-slate-400">高度 / 核心</span>
          <strong className="mt-2 block text-xl text-sky-300">
            {emotion?.highestBoard ? `${emotion.highestBoard}板` : '—'}
          </strong>
          <span className="mt-2 block text-sm leading-6 text-slate-200">
            {leaderNames || '最高板股票待确认'}
          </span>
          <span className="mt-1 block text-xs text-slate-400">
            连板 {emotion?.consecutiveCount ?? '—'} 家
          </span>
        </button>
      </div>
    </section>
  );
}

const FLOW_COLORS = [
  '#dc2626',
  '#e65b33',
  '#f59e0b',
  '#a855f7',
  '#7c3aed',
  '#2563eb',
  '#0891b2',
  '#0d9488',
  '#16a34a',
  '#65a30d',
  '#475569',
  '#64748b',
  '#9333ea',
  '#db2777',
  '#0f766e',
  '#4f46e5',
];

function SectorFlowChart({ data }: { data: FlowData }) {
  const [mode, setMode] = useState<'all' | 'inflow' | 'outflow'>('all');
  const colorByCode = useMemo(
    () =>
      new Map(
        data.series.map((item, index) => [
          item.code,
          FLOW_COLORS[index % FLOW_COLORS.length],
        ]),
      ),
    [data.series],
  );
  const visible = useMemo(
    () =>
      data.series.filter((item) => {
        if (mode === 'inflow') return item.latestMainNetInflow >= 0;
        if (mode === 'outflow') return item.latestMainNetInflow < 0;
        return true;
      }),
    [data.series, mode],
  );
  const chartData = useMemo(() => {
    const rows = new Map<string, Record<string, string | number>>();
    for (const item of visible) {
      for (const point of item.points) {
        const row = rows.get(point.time) ?? { time: point.time };
        row[item.code] = point.mainNetInflow / 100_000_000;
        rows.set(point.time, row);
      }
    }
    return [...rows.values()].sort((a, b) =>
      String(a.time).localeCompare(String(b.time)),
    );
  }, [visible]);
  const chartConfig = useMemo(
    () =>
      Object.fromEntries(
        visible.map((item) => [
          item.code,
          { label: item.name, color: colorByCode.get(item.code) ?? '#64748b' },
        ]),
      ) as ChartConfig,
    [colorByCode, visible],
  );
  const ranking = [...visible].sort(
    (a, b) => b.latestMainNetInflow - a.latestMainNetInflow,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="size-5" />
          盘中板块主力净流入曲线
        </CardTitle>
        <CardDescription>
          从开盘累计到当前分钟，单位：亿元；右侧为各板块最新累计值
        </CardDescription>
        <CardAction>
          <StateBadge
            state={data.curveState}
            label={`${data.coverage?.available ?? 0}/${data.coverage?.requested ?? 0}板块`}
          />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1">
            {(
              [
                ['all', '全部曲线'],
                ['inflow', '净流入'],
                ['outflow', '净流出'],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={mode === value ? 'default' : 'outline'}
                onClick={() => setMode(value)}
              >
                {label}
              </Button>
            ))}
          </div>
          <div className="text-xs text-muted-foreground">
            {data.tradeDate} · {data.phase} · 最新点 {data.lastPointTime ?? '—'}
          </div>
        </div>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_230px]">
          <ChartContainer
            config={chartConfig}
            className="h-[430px] w-full aspect-auto"
            initialDimension={{ width: 960, height: 430 }}
          >
            <RechartsLineChart
              data={chartData}
              margin={{ top: 10, right: 12, bottom: 0, left: 4 }}
              accessibilityLayer
            >
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="time"
                tickLine={false}
                axisLine={false}
                minTickGap={36}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={58}
                tickFormatter={(value) => `${Number(value).toFixed(0)}亿`}
              />
              <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1.5} />
              <ChartTooltip
                cursor={false}
                content={<ChartTooltipContent indicator="line" />}
              />
              {visible.map((item) => (
                <Line
                  key={item.code}
                  type="monotone"
                  dataKey={item.code}
                  name={item.name}
                  stroke={colorByCode.get(item.code)}
                  strokeWidth={1.8}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
            </RechartsLineChart>
          </ChartContainer>
          <div
            className="grid max-h-[430px] content-start gap-1 overflow-y-auto pr-1"
            aria-label="板块最新主力净流入排名"
          >
            {ranking.map((item) => (
              <div
                key={item.code}
                className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted/70"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: colorByCode.get(item.code) }}
                  />
                  <span className="truncate">{item.name}</span>
                </span>
                <span
                  className={`shrink-0 font-mono font-medium ${item.latestMainNetInflow >= 0 ? 'market-up' : 'market-down'}`}
                >
                  {fmtMoney(item.latestMainNetInflow)}
                </span>
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{data.basis}</p>
      </CardContent>
    </Card>
  );
}

function SectorDetailLine({ item }: { item: SectorFlowSeries }) {
  const subgroups = item.subgroups?.slice(0, 3) ?? [];
  const representatives = item.representatives?.slice(0, 3) ?? [];
  return (
    <div className="space-y-1 text-[11px] text-muted-foreground">
      <div className="flex flex-wrap items-center gap-1">
        <span>成分细分：</span>
        {subgroups.length ? (
          subgroups.map((group) => (
            <Badge
              key={group.name}
              variant="secondary"
              className="h-5 px-1.5 text-[10px]"
            >
              {group.name} {group.count}
            </Badge>
          ))
        ) : (
          <span>暂未补齐</span>
        )}
      </div>
      <div className="truncate">
        活跃股当日主力资金：
        {representatives.length
          ? representatives
              .map(
                (row) =>
                  `${row.name}（${fmtFlowDirection(row.mainNetInflow)}）`,
              )
              .join(' · ')
          : '暂未补齐'}
      </div>
    </div>
  );
}

function FlowSplitList({
  title,
  rows,
  direction,
}: {
  title: string;
  rows: SectorFlowSeries[];
  direction: 'inflow' | 'outflow';
}) {
  const maxValue = Math.max(
    ...rows.map((item) => Math.abs(item.delta5m ?? 0)),
    1,
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle
          className={`flex items-center gap-2 ${direction === 'inflow' ? 'market-up' : 'market-down'}`}
        >
          {direction === 'inflow' ? (
            <ArrowUpRight className="size-5" />
          ) : (
            <ArrowDownRight className="size-5" />
          )}
          {title}
        </CardTitle>
        <CardDescription>
          按最近5个有效交易分钟的主力净流入增量排序
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length ? (
          rows.map((item, index) => (
            <div key={item.code} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">
                  <span className="mr-2 text-xs text-muted-foreground">
                    {index + 1}
                  </span>
                  {item.name}
                </span>
                <span
                  className={`shrink-0 font-mono font-medium ${direction === 'inflow' ? 'market-up' : 'market-down'}`}
                >
                  {fmtMoney(item.delta5m)}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${direction === 'inflow' ? 'bg-red-500' : 'bg-emerald-500'}`}
                  style={{
                    width: `${Math.max(4, (Math.abs(item.delta5m ?? 0) / maxValue) * 100)}%`,
                  }}
                />
              </div>
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>累计 {fmtMoney(item.latestMainNetInflow)}</span>
                <span>15分钟 {fmtMoney(item.delta15m)}</span>
              </div>
              <SectorDetailLine item={item} />
            </div>
          ))
        ) : (
          <EmptyState>当前样本中暂无这一方向的资金增量</EmptyState>
        )}
      </CardContent>
    </Card>
  );
}

function HorizonFlowList({
  title,
  rows,
  direction,
  horizon,
}: {
  title: string;
  rows: SectorFlowSeries[];
  direction: 'inflow' | 'outflow';
  horizon: 'day' | '30m';
}) {
  const valueOf = (item: SectorFlowSeries) =>
    horizon === 'day' ? item.latestMainNetInflow : item.delta30m;
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4
          className={`text-sm font-medium ${direction === 'inflow' ? 'market-up' : 'market-down'}`}
        >
          {title}
        </h4>
        <span className="text-[11px] text-muted-foreground">
          {horizon === 'day' ? '开盘至今' : '日内方向 · 30分钟状态'}
        </span>
      </div>
      <div className="grid gap-2">
        {rows.length ? (
          rows.map((item, index) => (
            <div key={item.code} className="rounded-md bg-muted/45 px-2.5 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <div className="truncate text-sm">
                      <span className="mr-2 text-xs text-muted-foreground">
                        {index + 1}
                      </span>
                      {item.name}
                    </div>
                    {horizon === '30m' && item.persistenceLabel ? (
                      <Badge
                        variant="outline"
                        className="h-5 shrink-0 px-1.5 text-[10px]"
                      >
                        {item.persistenceLabel}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    板块涨跌 {fmtPct(item.changePct)} · 累计{' '}
                    {fmtMoney(item.latestMainNetInflow)}
                  </div>
                </div>
                <span
                  className={`shrink-0 font-mono text-sm font-medium ${(valueOf(item) ?? 0) >= 0 ? 'market-up' : 'market-down'}`}
                >
                  {fmtMoney(valueOf(item))}
                </span>
              </div>
              <div className="mt-2">
                <SectorDetailLine item={item} />
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-md border border-dashed px-3 py-5 text-center text-xs text-muted-foreground">
            当前没有满足同向价格与资金条件的板块
          </div>
        )}
      </div>
    </div>
  );
}

function PersistentStrengthBoard({ data }: { data: FlowData }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>长周期持续强弱</CardTitle>
        <CardDescription>
          先按开盘至今板块涨跌与累计主力资金同向筛选，再标注最近30分钟是持续、回流还是转弱；短时反抽不再让日内弱势整体消失
        </CardDescription>
        <CardAction>
          <StateBadge
            state={
              data.series.some((item) => item.delta30m !== null)
                ? 'READY'
                : 'DEGRADED'
            }
            label="长周期"
          />
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-3 lg:grid-cols-2">
        <HorizonFlowList
          title="持续强势"
          rows={data.split.persistentStrong}
          direction="inflow"
          horizon="30m"
        />
        <HorizonFlowList
          title="持续弱势"
          rows={data.split.persistentWeak}
          direction="outflow"
          horizon="30m"
        />
      </CardContent>
    </Card>
  );
}

function FlowSplitBoard({ data }: { data: FlowData }) {
  const leadersIn =
    data.split.inflow
      .slice(0, 3)
      .map((item) => item.name)
      .join('、') || '暂无';
  const leadersOut =
    data.split.outflow
      .slice(0, 3)
      .map((item) => item.name)
      .join('、') || '暂无';
  return (
    <div className="space-y-4">
      <section className="grid gap-3 md:grid-cols-3" aria-label="资金分流摘要">
        <Card size="sm">
          <CardHeader>
            <CardTitle>流入侧扩散</CardTitle>
            <CardAction>
              <span className="market-up text-lg font-semibold">
                {data.split.positiveCount}
              </span>
            </CardAction>
            <CardDescription>{leadersIn}</CardDescription>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle>流出侧扩散</CardTitle>
            <CardAction>
              <span className="market-down text-lg font-semibold">
                {data.split.negativeCount}
              </span>
            </CardAction>
            <CardDescription>{leadersOut}</CardDescription>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle>观察窗口</CardTitle>
            <CardAction>
              <StateBadge state={data.splitState} />
            </CardAction>
            <CardDescription>
              最近5个有效交易分钟 · {data.phase} {data.lastPointTime ?? '—'}
            </CardDescription>
          </CardHeader>
        </Card>
      </section>
      <div className="rounded-lg border bg-muted/35 px-4 py-3 text-sm">
        <div className="flex items-center gap-2 font-medium">
          <ArrowLeftRight className="size-4" />
          资金分流观察
        </div>
        <p className="mt-1 text-muted-foreground">
          流出侧集中在「{leadersOut}」，流入侧集中在「{leadersIn}
          」。这是概念板块的方向对照，不代表这些板块之间存在可逐笔证明的一一转移关系。
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <FlowSplitList
          title="资金正在流入"
          rows={data.split.inflow}
          direction="inflow"
        />
        <FlowSplitList
          title="资金正在流出"
          rows={data.split.outflow}
          direction="outflow"
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>当日累计净流入 / 净流出</CardTitle>
          <CardDescription>
            即使最近5分钟发生回流，日内累计失血板块仍会保留在净流出侧，不再消失
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-2">
          <HorizonFlowList
            title="当日累计净流入"
            rows={data.split.cumulativeInflow}
            direction="inflow"
            horizon="day"
          />
          <HorizonFlowList
            title="当日累计净流出"
            rows={data.split.cumulativeOutflow}
            direction="outflow"
            horizon="day"
          />
        </CardContent>
      </Card>
    </div>
  );
}

function LadderHeightTrend({ history }: { history: CloseHistoryDocument }) {
  const snapshots = history.snapshots;
  const dates = snapshots.map((snapshot) => snapshot.date);
  const defaultStart = dates[Math.max(0, dates.length - 10)] ?? '';
  const defaultEnd = dates.at(-1) ?? '';
  const [selectedStart, setSelectedStart] = useState<string | null>(null);
  const [selectedEnd, setSelectedEnd] = useState<string | null>(null);
  const startDate =
    selectedStart && dates.includes(selectedStart)
      ? selectedStart
      : defaultStart;
  const endDate =
    selectedEnd && dates.includes(selectedEnd) ? selectedEnd : defaultEnd;
  const rows = snapshots
    .filter(
      (snapshot) => snapshot.date >= startDate && snapshot.date <= endDate,
    )
    .map((snapshot) => ({
      date: snapshot.date,
      day: snapshot.date.slice(5).replace('-', '/'),
      highestBoard: snapshot.highestBoard,
      consecutiveCount: snapshot.consecutiveCount,
      leaders: snapshot.leaders,
      leaderText: snapshot.leaders.join('、') || '暂无高标',
    }));
  const latest = rows.at(-1);
  const previous = rows.at(-2);
  const heightChange =
    latest && previous ? latest.highestBoard - previous.highestBoard : 0;
  const config = {
    highestBoard: { label: '最高板高度', color: '#ef4444' },
    consecutiveCount: { label: '连板家数', color: '#f59e0b' },
  } satisfies ChartConfig;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="size-5 text-rose-500" />
          连板高度趋势
        </CardTitle>
        <CardDescription>
          红线看最高板，黄线看连板家数；下方直接列出每天最高板股票，均为15:00收盘定格
        </CardDescription>
        <CardAction>
          <Badge
            variant="outline"
            className="max-w-[360px] text-right font-mono whitespace-normal"
          >
            {latest
              ? `${latest.highestBoard}板 · ${latest.leaderText}${previous ? ` · 较${previous.day} ${heightChange === 0 ? '持平' : `${heightChange > 0 ? '+' : ''}${heightChange}板`}` : ''}`
              : '暂无数据'}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/35 p-2.5">
          <span className="text-xs font-medium text-muted-foreground">
            时间区间
          </span>
          <NativeSelect
            size="sm"
            aria-label="连板趋势开始日期"
            value={startDate}
            onChange={(event) => {
              const next = event.target.value;
              setSelectedStart(next);
              if (next > endDate) setSelectedEnd(next);
            }}
          >
            {dates.map((date) => (
              <NativeSelectOption key={`start-${date}`} value={date}>
                {date}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <span className="text-xs text-muted-foreground">至</span>
          <NativeSelect
            size="sm"
            aria-label="连板趋势结束日期"
            value={endDate}
            onChange={(event) => {
              const next = event.target.value;
              setSelectedEnd(next);
              if (next < startDate) setSelectedStart(next);
            }}
          >
            {dates.map((date) => (
              <NativeSelectOption key={`end-${date}`} value={date}>
                {date}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setSelectedStart(null);
              setSelectedEnd(null);
            }}
          >
            最近10日
          </Button>
          <Badge variant="secondary">{rows.length}个交易日</Badge>
        </div>
        {rows.length > 1 ? (
          <ChartContainer
            config={config}
            className="h-[280px] w-full aspect-auto"
          >
            <RechartsLineChart
              accessibilityLayer
              data={rows}
              margin={{ top: 12, right: 12, left: 0, bottom: 0 }}
            >
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="day"
                tickLine={false}
                axisLine={false}
                tickMargin={10}
              />
              <YAxis
                yAxisId="height"
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                width={34}
                domain={[0, 'dataMax + 1']}
                tickFormatter={(value) => `${value}板`}
              />
              <YAxis
                yAxisId="count"
                orientation="right"
                allowDecimals={false}
                tickLine={false}
                axisLine={false}
                width={34}
                tickFormatter={(value) => `${value}家`}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, payload) =>
                      `${payload?.[0]?.payload?.date ?? ''} · ${payload?.[0]?.payload?.leaderText ?? ''}`
                    }
                  />
                }
              />
              <Line
                yAxisId="height"
                type="linear"
                dataKey="highestBoard"
                stroke="var(--color-highestBoard)"
                strokeWidth={3}
                dot={{ r: 3, fill: 'var(--color-highestBoard)' }}
                activeDot={{ r: 5 }}
              />
              <Line
                yAxisId="count"
                type="linear"
                dataKey="consecutiveCount"
                stroke="var(--color-consecutiveCount)"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={{ r: 2.5, fill: 'var(--color-consecutiveCount)' }}
                activeDot={{ r: 4 }}
              />
            </RechartsLineChart>
          </ChartContainer>
        ) : (
          <EmptyState>至少需要两个收盘交易日才能绘制趋势</EmptyState>
        )}
        {rows.length ? (
          <div>
            <div className="mb-2 text-xs font-medium">每日最高板股票</div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((row) => (
                <div
                  key={`leader-${row.date}`}
                  className="grid grid-cols-[54px_48px_minmax(0,1fr)] items-center gap-2 rounded-lg border bg-background px-3 py-2.5"
                >
                  <time className="font-mono text-xs text-muted-foreground">
                    {row.day}
                  </time>
                  <Badge className="justify-center bg-red-500/15 text-red-700 hover:bg-red-500/15 dark:text-red-300">
                    {row.highestBoard}板
                  </Badge>
                  <span className="min-w-0 text-sm leading-5 font-semibold">
                    {row.leaderText}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function MarketTimelineBoard({ data }: { data: MarketTimelineData }) {
  const events = data.events.filter(
    (event) =>
      !/^(MSCI中国|融资融券|富时罗素|历史新高|近期新高|破增发价股|百元股|昨日.*)$/.test(
        event.sectorName,
      ),
  );
  const starts = events.filter((event) => event.kind === 'START');
  const strongs = events.filter((event) => event.kind === 'STRONG');
  const cashouts = events.filter((event) => event.kind === 'CASHOUT');
  const weakens = events.filter((event) => event.kind === 'WEAKEN');
  const strongest = [...starts, ...strongs].sort(
    (a, b) => Math.abs(b.flowDelta) - Math.abs(a.flowDelta),
  )[0];
  const leadingSectors = [
    ...new Set([...starts, ...strongs].map((e) => e.sectorName)),
  ].slice(0, 3);
  const fadingSectors = [
    ...new Set([...cashouts, ...weakens].map((e) => e.sectorName)),
  ].slice(0, 3);
  const relatedCount = new Set(
    events.flatMap((event) =>
      (event.relatedStocks ?? []).map((stock) => stock.code),
    ),
  ).size;
  const groups = [
    ...events
      .reduce((grouped, event) => {
        const sameMinute = grouped.get(event.time) ?? [];
        sameMinute.push(event);
        grouped.set(event.time, sameMinute);
        return grouped;
      }, new Map<string, MarketTimelineEvent[]>())
      .entries(),
  ].sort(([a], [b]) => b.localeCompare(a));
  const timelineDriverCodes = new Set(
    events.flatMap((event) => event.drivers.map((driver) => driver.code)),
  );
  const checkedDriverCount = events
    .flatMap((event) => event.drivers)
    .filter((driver) => driver.windowChangePct !== null).length;
  const confirmedDriverCount = events
    .flatMap((event) => event.drivers)
    .filter((driver) => driver.role === '同窗价格确认').length;
  const stockPrimaryTime = new Map<string, string>();
  const stockSectors = new Map<string, Set<string>>();
  for (const [time, events] of groups) {
    for (const event of events) {
      for (const stock of event.relatedStocks ?? []) {
        const sectors = stockSectors.get(stock.code) ?? new Set<string>();
        sectors.add(event.sectorName);
        stockSectors.set(stock.code, sectors);
        if (
          !timelineDriverCodes.has(stock.code) &&
          !stockPrimaryTime.has(stock.code)
        )
          stockPrimaryTime.set(stock.code, time);
      }
    }
  }

  const eventHeadline = timelineHeadline;

  const indexPhrase = (events: MarketTimelineEvent[]) => {
    const indices = events.find((event) => event.indices.length)?.indices ?? [];
    if (!indices.length) return '指数同窗数据暂时不可用。';
    const detail = indices
      .map(
        (marketIndex) =>
          `${marketIndex.name}${fmtPct(marketIndex.changePct)}（近3分钟${fmtPct(marketIndex.windowChangePct)}）`,
      )
      .join('，');
    const windows = indices
      .map((marketIndex) => marketIndex.windowChangePct)
      .filter((value): value is number => value !== null);
    const hasStart = events.some(
      (event) => (event.sectorWindowChangePct ?? 0) > 0,
    );
    const hasExit = events.some(
      (event) => (event.sectorWindowChangePct ?? 0) < 0,
    );
    let relation = '指数分化，题材走势相对独立';
    if (windows.length && windows.every((value) => value > 0))
      relation = hasStart ? '题材与指数共振上行' : '板块回落时指数仍有承接';
    if (windows.length && windows.every((value) => value < 0))
      relation = hasStart ? '题材逆指数启动' : '板块回落与指数同向';
    if (hasStart && hasExit)
      relation = '同一分钟板块发生切换，指数仅作环境参照';
    return `指数环境：${detail}，${relation}。`;
  };
  return (
    <div className="space-y-4">
      <section
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="盘面脉络摘要"
      >
        <Card size="sm">
          <CardHeader>
            <CardTitle>主线与回流</CardTitle>
            <CardAction>
              <span className="market-up text-lg font-semibold">
                {starts.length + strongs.length}
              </span>
            </CardAction>
            <CardDescription>
              {leadingSectors.join(' · ') || '尚无明显主线'}
              <span className="mt-1 block">
                启动{starts.length} · 延续{strongs.length}
              </span>
            </CardDescription>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle>兑现 / 走弱</CardTitle>
            <CardAction>
              <span className="market-down text-lg font-semibold">
                {cashouts.length + weakens.length}
              </span>
            </CardAction>
            <CardDescription>
              {fadingSectors.join(' · ') || '尚无明显负反馈'}
              <span className="mt-1 block">
                兑现{cashouts.length} · 走弱{weakens.length}
              </span>
            </CardDescription>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle>关键转折</CardTitle>
            <CardAction>
              <ArrowUpRight className="size-4 market-up" />
            </CardAction>
            <CardDescription>
              {strongest
                ? `${strongest.time} ${strongest.sectorName}${strongest.label}`
                : '等待新转折'}
              <span className="mt-1 block">
                {groups.length}个时点 · {events.length}个板块节点
              </span>
            </CardDescription>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardTitle>个股同步度</CardTitle>
            <CardAction>
              <StateBadge state={data.status} />
            </CardAction>
            <CardDescription>
              {confirmedDriverCount}只同向 · {checkedDriverCount}只已核验 ·{' '}
              {relatedCount}只关联股
            </CardDescription>
          </CardHeader>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock3 className="size-5" />
            今日盘面脉络
          </CardTitle>
          <CardDescription>
            最新在上 · 先看“板块动作 → 涨停/领涨股”，再看指数环境与量化解释 ·
            时间取真实资金转折分钟，个股涨停按节点分钟价格确认
          </CardDescription>
          <CardAction>
            <StateBadge
              state={data.status}
              label={`${data.phase} ${data.lastPointTime ?? '—'}`}
            />
          </CardAction>
        </CardHeader>
        <CardContent>
          {groups.length ? (
            <div>
              {groups.map(([time, events], groupIndex) => {
                const bullish =
                  events.reduce((sum, event) => sum + event.flowDelta, 0) >= 0;
                const groupRelatedStocks = [
                  ...events
                    .flatMap((event) => event.relatedStocks ?? [])
                    .reduce((stocks, stock) => {
                      if (!stocks.has(stock.code))
                        stocks.set(stock.code, stock);
                      return stocks;
                    }, new Map<string, MarketTimelineRelatedStock>())
                    .values(),
                ];
                const relatedStocks = groupRelatedStocks
                  .filter(
                    (stock) =>
                      !timelineDriverCodes.has(stock.code) &&
                      stockPrimaryTime.get(stock.code) === time,
                  )
                  .slice(0, 16);
                const mergedRelatedCount =
                  groupRelatedStocks.length - relatedStocks.length;
                const confirmedDrivers = [
                  ...events
                    .flatMap((event) =>
                      event.drivers.filter(
                        (driver) => driver.role === '同窗价格确认',
                      ),
                    )
                    .reduce((drivers, driver) => {
                      if (!drivers.has(driver.code))
                        drivers.set(driver.code, driver);
                      return drivers;
                    }, new Map<string, MarketTimelineDriver>())
                    .values(),
                ];
                const checkedButUnaligned = [
                  ...events
                    .flatMap((event) =>
                      event.drivers.filter(
                        (driver) =>
                          driver.windowChangePct !== null &&
                          driver.role !== '同窗价格确认' &&
                          !confirmedDrivers.some(
                            (confirmed) => confirmed.code === driver.code,
                          ),
                      ),
                    )
                    .reduce((drivers, driver) => {
                      if (!drivers.has(driver.code))
                        drivers.set(driver.code, driver);
                      return drivers;
                    }, new Map<string, MarketTimelineDriver>())
                    .values(),
                ];
                const unavailableDrivers = events
                  .flatMap((event) => event.drivers)
                  .filter((driver) => driver.windowChangePct === null);
                const sectorNarrative = events
                  .map(
                    (event) =>
                      `${event.sectorName}${event.label}，近3分钟${fmtPct(event.sectorWindowChangePct)}，主力${fmtFlowDirection(event.flowDelta)}`,
                  )
                  .join('；');
                const headlineNarrative = events
                  .map((event) => eventHeadline(event))
                  .join('；');
                return (
                  <article
                    key={`${time}-${events.map((event) => event.id).join('-')}`}
                    className="grid grid-cols-[54px_18px_minmax(0,1fr)] gap-x-2 sm:grid-cols-[66px_20px_minmax(0,1fr)] sm:gap-x-3"
                  >
                    <time className="pt-4 text-right font-mono text-sm font-semibold tabular-nums whitespace-nowrap">
                      {time}
                    </time>
                    <div className="relative flex justify-center">
                      <span
                        className={`absolute w-px bg-border ${groupIndex === 0 ? 'top-5' : 'top-0'} ${groupIndex === groups.length - 1 ? 'bottom-5' : 'bottom-0'}`}
                      />
                      <span
                        className={`relative mt-[18px] size-2.5 shrink-0 rounded-full ring-4 ring-background ${bullish ? 'bg-red-500' : 'bg-emerald-500'}`}
                      />
                    </div>
                    <div
                      className={`mb-4 min-w-0 rounded-lg border p-3.5 sm:p-4 ${bullish ? 'border-red-500/25 bg-red-500/[0.035]' : 'border-emerald-500/25 bg-emerald-500/[0.035]'}`}
                    >
                      <div className="flex flex-wrap gap-2">
                        {events.map((event) => (
                          <Badge
                            key={event.id}
                            variant="outline"
                            className={
                              event.flowDelta >= 0
                                ? 'status-ready'
                                : 'status-degraded'
                            }
                          >
                            {event.sectorName} · {event.label}
                          </Badge>
                        ))}
                      </div>
                      <p className="mt-3 text-[15px] leading-7 sm:text-base">
                        <span className="font-semibold">
                          {headlineNarrative}。
                        </span>
                      </p>
                      <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                        {sectorNarrative}。{indexPhrase(events)}
                      </p>

                      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {events.map((event) => (
                          <div
                            key={event.id}
                            className="rounded-md border bg-background/75 px-3 py-2 text-xs leading-5"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium">
                                {event.sectorName}
                              </span>
                              <span
                                className={`font-mono font-semibold ${(event.sectorWindowChangePct ?? 0) >= 0 ? 'market-up' : 'market-down'}`}
                              >
                                {fmtPct(event.sectorWindowChangePct)}
                              </span>
                            </div>
                            <div className="text-muted-foreground">
                              节点时{fmtPct(event.sectorAtTimeChangePct)} ·
                              近3分钟
                              {fmtPct(event.sectorWindowChangePct)}
                            </div>
                            <div className="text-muted-foreground">
                              近3分钟资金{fmtFlowDirection(event.flowDelta)} ·
                              当日累计{fmtFlowDirection(event.sectorDailyFlow)}
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-medium">
                          节点同步个股 / 反向个股
                        </span>
                        {confirmedDrivers.length
                          ? confirmedDrivers.map((driver) => (
                              <span
                                key={`confirmed-${driver.code}`}
                                className="rounded-md border border-amber-500/25 bg-amber-500/[0.06] px-2 py-1"
                              >
                                <span className="font-semibold">
                                  {driver.name}
                                </span>{' '}
                                <span
                                  className={
                                    (driver.windowChangePct ?? 0) >= 0
                                      ? 'market-up'
                                      : 'market-down'
                                  }
                                >
                                  节点{fmtPct(driver.atTimeChangePct)}
                                </span>{' '}
                                <span className="text-muted-foreground">
                                  {driver.limitState === 'LIMIT_UP'
                                    ? '涨停'
                                    : driver.limitState === 'LIMIT_DOWN'
                                      ? '跌停'
                                      : `3分钟${fmtPct(driver.windowChangePct)}`}
                                </span>
                              </span>
                            ))
                          : null}
                        {checkedButUnaligned.length
                          ? checkedButUnaligned.map((driver) => (
                              <span
                                key={`checked-${driver.code}`}
                                className="rounded-md border bg-muted/55 px-2 py-1"
                              >
                                <span className="font-semibold">
                                  {driver.name}
                                </span>{' '}
                                <span
                                  className={
                                    (driver.windowChangePct ?? 0) >= 0
                                      ? 'market-up'
                                      : 'market-down'
                                  }
                                >
                                  节点{fmtPct(driver.atTimeChangePct)}
                                </span>{' '}
                                <span className="text-muted-foreground">
                                  {driver.role === '同窗价格持平'
                                    ? '持平'
                                    : '反向变动'}
                                </span>
                              </span>
                            ))
                          : null}
                        {!confirmedDrivers.length &&
                        !checkedButUnaligned.length ? (
                          <StateBadge
                            state="DEGRADED"
                            label={
                              unavailableDrivers.length
                                ? `节点价格暂不可用 ${unavailableDrivers.length}只`
                                : '核心成分股暂不可用'
                            }
                          />
                        ) : null}
                      </div>

                      {relatedStocks.length > 0 ? (
                        <div className="mt-4">
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs font-medium">
                              板块内跟随个股（当前涨幅）
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              不冒充节点时刻的历史涨幅 · 个股跨节点去重
                            </span>
                          </div>
                          {relatedStocks.length ? (
                            <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-4">
                              {relatedStocks.map((stock) => {
                                const sectors = [
                                  ...(stockSectors.get(stock.code) ?? []),
                                ];
                                return (
                                  <div
                                    key={stock.code}
                                    className="flex min-w-0 items-center justify-between gap-2 rounded-md bg-muted/70 px-2.5 py-2 text-xs"
                                  >
                                    <span className="flex min-w-0 items-center gap-1.5">
                                      <span
                                        className="truncate"
                                        title={`${stock.name} · ${stock.industry} · ${sectors.join('、')}`}
                                      >
                                        {stock.name}
                                      </span>
                                      {sectors.length > 1 ? (
                                        <span className="shrink-0 rounded bg-sky-500/10 px-1 py-0.5 text-[10px] text-sky-700 dark:text-sky-300">
                                          跨{sectors.length}板块
                                        </span>
                                      ) : null}
                                    </span>
                                    <span
                                      className={`shrink-0 font-mono font-semibold ${(stock.changePct ?? 0) >= 0 ? 'market-up' : 'market-down'}`}
                                    >
                                      {fmtPct(stock.changePct)}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <EmptyState>
                              {mergedRelatedCount
                                ? `本节点${mergedRelatedCount}只重叠股已合并到同窗核验或更新节点`
                                : '相关异动股当前不可用'}
                            </EmptyState>
                          )}
                        </div>
                      ) : null}
                      <details className="mt-3 rounded-md border border-dashed px-3 py-2 text-[11px] text-muted-foreground">
                        <summary className="cursor-pointer font-medium text-foreground/75">
                          查看资金转折判定与数据边界
                        </summary>
                        <p className="mt-2 leading-5">
                          {events
                            .map(
                              (event) =>
                                `${event.sectorName}：资金较前窗变化${fmtMoney(event.flowAcceleration)}；${event.driverBasis}`,
                            )
                            .join('；')}
                        </p>
                      </details>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState>当前还没有达到阈值的板块启动或兑现节点</EmptyState>
          )}
          {data.basis ? (
            <p className="mt-4 border-t pt-3 text-xs leading-5 text-muted-foreground">
              {data.basis}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

export default function Home() {
  const [activeTab, setActiveTab] = useState('overview');
  const radar = usePolling<RadarData>('/api/radar', 15_000);
  const flow = usePolling<FlowData>('/api/flow', 60_000);
  const ladder = usePolling<LadderData>('/api/ladder', 30_000);
  const speed = usePolling<SpeedData>(
    '/api/speed',
    activeTab === 'speed' ? 1_000 : 15_000,
  );
  const intradayEmotion = usePolling<IntradayEmotionSnapshot>(
    '/api/intraday-emotion',
    30_000,
  );
  const closeHistory = usePolling<CloseHistoryDocument>(
    '/api/close-history',
    60_000,
  );
  const history = closeHistory.data ?? CLOSE_HISTORY;
  const radarEvents = useWindowedRadar(radar.data, Boolean(radar.error));
  const emotionDate = intradayEmotion.data?.tradeDate.replaceAll('-', '') ?? '';
  const currentEmotionClose = history.snapshots.find(
    (snapshot) => snapshot.date.replaceAll('-', '') === emotionDate,
  );
  const previousEmotionClose = history.snapshots
    .filter((snapshot) => snapshot.date.replaceAll('-', '') < emotionDate)
    .at(-1);
  const unifiedReading = intradayEmotion.data
    ? unifiedMarketReading({
        facts: toEmotionFacts(intradayEmotion.data),
        close: currentEmotionClose,
        previousClose: previousEmotionClose,
        ladder: ladder.data,
        radar: radar.data,
        radarEvents,
        flow: flow.data,
        speed: speed.data,
      })
    : null;
  const sharedRadarSectors = useMemo(() => {
    const sectors = new Map<string, string[]>();
    for (const event of radarEvents)
      for (const driver of event.drivers) {
        sectors.set(driver.code, [
          ...new Set([...(sectors.get(driver.code) ?? []), event.name]),
        ]);
      }
    return sectors;
  }, [radarEvents]);
  const [selectedSector, setSelectedSector] = useState<string | null>(null);
  const [selectedCloseDate, setSelectedCloseDate] = useState(LATEST_CLOSE_DATE);
  const closeDatePinned = useRef(false);
  const [competitionFilter, setCompetitionFilter] = useState('ALL');
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!radarEvents.length) return;
    if (
      !selectedSector ||
      !radarEvents.some((event) => event.code === selectedSector)
    ) {
      setSelectedSector(radarEvents[0].code);
    }
  }, [radarEvents, selectedSector]);

  useEffect(() => {
    const latest = history.snapshots.at(-1)?.date;
    if (!latest) return;
    const available = history.snapshots.some(
      (snapshot) => snapshot.date === selectedCloseDate,
    );
    if (!closeDatePinned.current || !available) setSelectedCloseDate(latest);
  }, [history.snapshots, selectedCloseDate]);

  const selectedEvent =
    radarEvents.find((event) => event.code === selectedSector) ??
    radarEvents[0];
  const latestAt = [
    radar.data?.retrievedAt,
    flow.data?.retrievedAt,
    ladder.data?.retrievedAt,
    speed.data?.retrievedAt,
    intradayEmotion.data?.retrievedAt,
  ]
    .filter(Boolean)
    .sort((a, b) => String(a).localeCompare(String(b)))
    .at(-1);
  const closedSnapshot =
    history.archive?.sessionState === 'CLOSED' ? history.archive : undefined;
  const moduleHealth = [
    {
      name: '板块异动',
      error: radar.error,
      state: radar.data?.status,
      date: radar.data?.tradeDate,
      detail: radar.data?.reason,
    },
    {
      name: '资金分流',
      error: flow.error,
      state: flow.data?.status,
      date: flow.data?.tradeDate,
      detail: flow.data?.reason,
    },
    {
      name: '连板梯队',
      error: ladder.error,
      state: ladder.data?.status,
      date: ladder.data?.tradeDate,
      detail: ladder.data?.reason,
    },
    {
      name: '涨速榜',
      error: speed.error,
      state: speed.data?.status,
      date: speed.data?.tradeDate,
      detail: speed.data?.reason,
    },
    {
      name: '盘中情绪',
      error: intradayEmotion.error,
      state: intradayEmotion.data?.status,
      date: intradayEmotion.data?.tradeDate,
      detail: intradayEmotion.data?.reason,
    },
    {
      name: '情绪周期',
      error: closeHistory.error,
      state: closeHistory.data?.archive?.state,
      date: history.snapshots.at(-1)?.date,
      detail:
        closeHistory.data?.archive?.state === 'DEGRADED'
          ? closeHistory.data.archive.message
          : undefined,
    },
  ];
  const alignedDate = moduleHealth
    .map((item) => fmtTradeDate(item.date))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort()
    .at(-1);
  const issueModules = moduleHealth.filter(
    (item) =>
      item.error || item.state === 'MISSING' || item.state === 'DEGRADED',
  );
  const staleModules = alignedDate
    ? moduleHealth.filter(
        (item) => item.date && fmtTradeDate(item.date) !== alignedDate,
      )
    : [];
  const sourceNotice = issueModules.length
    ? `${issueModules.length}个模块降级：${issueModules.map((item) => item.name).join('、')}`
    : staleModules.length
      ? `${staleModules.length}个模块日期未对齐：${staleModules.map((item) => item.name).join('、')}`
      : null;
  const marketNotice = closedSnapshot
    ? `当前休市，展示 ${fmtTradeDate(closedSnapshot.marketDate ?? closedSnapshot.latestDate)} 的最近可用快照；各模块的数据缺口单独标注。`
    : null;
  const manualRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      radar.refresh(),
      flow.refresh(),
      ladder.refresh(),
      speed.refresh(),
      intradayEmotion.refresh(),
      closeHistory.refresh(),
    ]);
    setRefreshing(false);
  };
  const selectCloseDate = (date: string) => {
    closeDatePinned.current = true;
    setSelectedCloseDate(date);
    setActiveTab('emotion');
  };

  const visibleCompetitors = (ladder.data?.competitors ?? []).filter(
    (row) =>
      competitionFilter === 'ALL' ||
      (competitionFilter === 'NEGATIVE'
        ? row.changePct !== null && row.changePct < 0
        : row.state === competitionFilter),
  );
  const genericConcepts = new Set([
    '融资融券',
    '深股通',
    '沪股通',
    'MSCI中国',
    '富时罗素',
    '标普道琼斯A股',
    '国企改革',
    '央企改革',
    '央国企改革',
    '专精特新',
  ]);
  const speedConceptCounts = new Map<string, number>();
  for (const row of speed.data?.rows ?? []) {
    for (const concept of new Set(
      row.concepts.filter((item) => !genericConcepts.has(item)),
    )) {
      speedConceptCounts.set(
        concept,
        (speedConceptCounts.get(concept) ?? 0) + 1,
      );
    }
  }
  const hotConcepts = [...speedConceptCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border/80 bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Activity />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold tracking-tight sm:text-lg">
                李米看板
              </h1>
              <p className="truncate text-xs text-muted-foreground">
                板块异动、资金分流、情绪与连板梯队一屏联动
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="hidden gap-1.5 sm:inline-flex">
              <span
                className={`size-1.5 rounded-full ${sourceNotice ? 'bg-amber-500' : closedSnapshot ? 'bg-sky-500' : 'bg-emerald-500'}`}
              />
              {sourceNotice
                ? '部分数据不全'
                : closedSnapshot
                  ? '休市快照'
                  : '监控中'}{' '}
              {fmtTime(latestAt)}
            </Badge>
            <CloseDatePicker
              value={selectedCloseDate}
              onChange={selectCloseDate}
              history={history}
              compact
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => void manualRefresh()}
              aria-label="刷新盘中数据"
            >
              <RefreshCw className={refreshing ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">刷新</span>
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] space-y-4 px-4 py-4 sm:px-6 sm:py-6">
        <MarketCommandCenter
          radarEvents={radarEvents}
          flow={flow.data}
          emotion={intradayEmotion.data}
          ladder={ladder.data}
          marketNotice={marketNotice}
          onNavigate={setActiveTab}
        />

        <details className="rounded-lg border bg-card px-4 py-3 text-sm">
          <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 font-medium">
            <span className="flex items-center gap-2">
              {sourceNotice ? (
                <ShieldAlert className="size-4 text-amber-500" />
              ) : (
                <ShieldCheck className="size-4 text-emerald-500" />
              )}
              数据健康
              <span
                className={sourceNotice ? 'text-amber-600' : 'text-emerald-600'}
              >
                {sourceNotice ??
                  `${moduleHealth.length}/${moduleHealth.length}模块已对齐`}
              </span>
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              行情日 {alignedDate ?? '连接中'} · 点击查看来源边界
            </span>
          </summary>
          <div className="mt-3 grid gap-2 border-t pt-3 sm:grid-cols-2 lg:grid-cols-4">
            {moduleHealth.map((item) => {
              const state = item.error ? 'MISSING' : item.state;
              const stale = Boolean(
                alignedDate &&
                item.date &&
                fmtTradeDate(item.date) !== alignedDate,
              );
              return (
                <div key={item.name} className="rounded-md border px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{item.name}</span>
                    <StateBadge
                      state={stale && state === 'READY' ? 'DEGRADED' : state}
                      label={stale ? '日期未对齐' : undefined}
                    />
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {fmtTradeDate(item.date)}
                    {item.error || item.detail
                      ? ` · ${item.error || item.detail}`
                      : ''}
                  </p>
                </div>
              );
            })}
          </div>
          {history.archive?.missingDates?.length ? (
            <p className="mt-3 border-t pt-3 text-xs text-amber-600">
              收盘证据缺口：
              {history.archive.missingDates
                .map((date) => fmtTradeDate(date))
                .join('、')}
              。这些日期不会用相邻交易日或实时行情替代。
            </p>
          ) : null}
        </details>

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value)}
          className="gap-4"
        >
          <TabsList variant="line" className="max-w-full overflow-x-auto">
            <TabsTrigger value="overview">
              <BrainCircuit />
              盘面全景
            </TabsTrigger>
            <TabsTrigger value="emotion">
              <CalendarDays />
              情绪周期
            </TabsTrigger>
            <TabsTrigger value="emotion-tracking">
              <Activity />
              情绪跟踪
            </TabsTrigger>
            <TabsTrigger value="radar">
              <Activity />
              板块异动
            </TabsTrigger>
            <TabsTrigger value="flow">
              <ArrowLeftRight />
              资金分流
            </TabsTrigger>
            <TabsTrigger value="promotion">
              <TrendingUp />
              连板晋级
            </TabsTrigger>
            <TabsTrigger value="competition">
              <Swords />
              梯队竞争
            </TabsTrigger>
            <TabsTrigger value="speed">
              <Zap />
              涨速榜
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            {unifiedReading ? (
              <UnifiedMarketBoard reading={unifiedReading} />
            ) : (
              <EmptyState>
                {intradayEmotion.loading
                  ? '正在建立盘面十二模块…'
                  : intradayEmotion.error || '盘面证据暂不可用'}
              </EmptyState>
            )}
          </TabsContent>

          <TabsContent value="emotion" className="space-y-4">
            <IntradayEmotionBoard
              snapshot={intradayEmotion.data}
              loading={intradayEmotion.loading}
              error={intradayEmotion.error}
              history={history}
              ladder={ladder.data}
            />
            <EmotionCycleBoard
              selectedDate={selectedCloseDate}
              onDateChange={selectCloseDate}
              history={history}
              ladder={ladder.data}
            />
          </TabsContent>

          <TabsContent value="emotion-tracking">
            <EmotionTrackingBoard
              history={history}
              selectedDate={selectedCloseDate}
              onDateChange={(date) => {
                closeDatePinned.current = true;
                setSelectedCloseDate(date);
              }}
            />
          </TabsContent>

          <TabsContent value="radar" className="space-y-4">
            {flow.data?.series?.length ? (
              <SectorFlowChart data={flow.data} />
            ) : (
              <EmptyState>
                {flow.loading
                  ? '正在读取板块主力净流入分钟曲线…'
                  : flow.data?.reason ||
                    flow.error ||
                    '当前没有可用的板块资金曲线'}
              </EmptyState>
            )}
            {!radarEvents.length ? (
              <EmptyState>
                {radar.loading
                  ? '正在建立板块监控…'
                  : radar.data?.reason ||
                    radar.error ||
                    '当前没有达到阈值的板块异动'}
              </EmptyState>
            ) : (
              <>
                <div className="grid gap-4 lg:grid-cols-2">
                  {(['up', 'down'] as const).map((direction) => (
                    <Card key={direction}>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          {direction === 'up' ? (
                            <ArrowUpRight className="market-up" />
                          ) : (
                            <ArrowDownRight className="market-down" />
                          )}
                          {radar.data?.sessionState === 'CLOSED'
                            ? direction === 'up'
                              ? '当日强势板块'
                              : '当日弱势板块'
                            : direction === 'up'
                              ? '明显拉升'
                              : '明显下跌'}
                        </CardTitle>
                        <CardDescription>
                          {radar.data?.sessionState === 'CLOSED'
                            ? `${radar.data.tradeDate}日涨跌幅 · 非当前实时，休市不计算3分钟变化`
                            : '逐卡标注当前涨速、日涨跌幅或实测3分钟变化；报价时间不齐时不做短窗确认'}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="grid gap-2">
                        {radarEvents
                          .filter((item) => item.direction === direction)
                          .map((item) => (
                            <button
                              key={item.code}
                              type="button"
                              aria-label={`查看${item.name}${direction === 'up' ? '拉升' : '下跌'}驱动个股`}
                              onClick={() => setSelectedSector(item.code)}
                              className={`w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/70 ${selectedSector === item.code ? 'border-ring bg-muted/60 ring-1 ring-ring' : 'bg-muted/30'}`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <h3 className="font-medium">{item.name}</h3>
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {item.drivers
                                      .map(
                                        (driver) =>
                                          `${driver.name}${(sharedRadarSectors.get(driver.code)?.length ?? 0) > 1 ? '（跨题材）' : ''}`,
                                      )
                                      .join(' · ') || '驱动股待补齐'}
                                  </p>
                                </div>
                                <div className="text-right">
                                  <p
                                    className={`text-base font-medium ${direction === 'up' ? 'market-up' : 'market-down'}`}
                                  >
                                    {fmtPct(item.displayChangePct)}
                                  </p>
                                  <p
                                    className={`text-xs ${(item.displayFlow ?? 0) >= 0 ? 'market-up' : 'market-down'}`}
                                  >
                                    {item.windowReady
                                      ? '净额变化 '
                                      : '日内净额 '}
                                    {fmtMoney(item.displayFlow)}
                                  </p>
                                </div>
                              </div>
                              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                                <span>
                                  {item.windowReady
                                    ? '实测约3分钟价格变化'
                                    : item.selectionBasis === 'DAY_CHANGE'
                                      ? '日涨跌幅'
                                      : '当前报价涨速'}
                                </span>
                                <span>
                                  同向{item.directionalCount ?? '—'}只 · 样本
                                  {item.members.length}/
                                  {item.memberCount ?? '—'}只
                                </span>
                              </div>
                            </button>
                          ))}
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {selectedEvent && (
                  <Card>
                    <CardHeader>
                      <CardTitle>{selectedEvent.name} · 主要驱动个股</CardTitle>
                      <CardDescription>
                        {selectedEvent.driverBasis}
                        <span className="mt-1 block">
                          成分查询{selectedEvent.memberQueriesReady ?? '—'}/
                          {selectedEvent.memberQueriesRequested ?? '—'} · 样本
                          {selectedEvent.members.length}/
                          {selectedEvent.memberCount ?? '—'}只 · 报价时间
                          {selectedEvent.quoteTime
                            ? new Date(selectedEvent.quoteTime).toLocaleString(
                                'zh-CN',
                                { timeZone: 'Asia/Shanghai', hour12: false },
                              )
                            : '未记录'}
                        </span>
                        {selectedEvent.missingReasons?.length ? (
                          <span className="mt-1 block text-amber-700 dark:text-amber-400">
                            {selectedEvent.missingReasons.join('；')}
                          </span>
                        ) : null}
                      </CardDescription>
                      <CardAction>
                        <StateBadge
                          state={selectedEvent.driverState}
                          label={
                            selectedEvent.windowReady
                              ? '实测短窗关联'
                              : selectedEvent.selectionBasis === 'DAY_CHANGE'
                                ? '日内同向样本'
                                : '当前涨速样本'
                          }
                        />
                      </CardAction>
                    </CardHeader>
                    <CardContent>
                      <p className="mb-3 text-xs text-muted-foreground">
                        同一股票可能属于多个题材，交叉出现不代表新增一笔资金，不能跨板块累加。
                      </p>
                      {selectedEvent.drivers.length ? (
                        <>
                          <div className="grid gap-2 md:hidden">
                            {selectedEvent.drivers.map((driver) => (
                              <article
                                key={driver.code}
                                className="rounded-lg border bg-muted/20 p-3"
                              >
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div>
                                    <p className="font-medium">{driver.name}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {driver.code} ·{' '}
                                      {driver.industry || '行业未提供'}
                                    </p>
                                  </div>
                                  <Badge variant="outline">
                                    {driver.driverRole}
                                  </Badge>
                                </div>
                                <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
                                  <div>
                                    <dt className="text-muted-foreground">
                                      {selectedEvent.windowReady
                                        ? '3分钟价格变化'
                                        : selectedEvent.selectionBasis ===
                                            'DAY_CHANGE'
                                          ? '日涨跌幅'
                                          : '当前涨速'}
                                    </dt>
                                    <dd
                                      className={`mt-1 text-base font-medium ${selectedEvent.direction === 'up' ? 'market-up' : 'market-down'}`}
                                    >
                                      {fmtPct(
                                        selectedEvent.windowReady ||
                                          selectedEvent.selectionBasis ===
                                            'DAY_CHANGE'
                                          ? driver.changePct
                                          : driver.speedPct,
                                      )}
                                    </dd>
                                  </div>
                                  <div>
                                    <dt className="text-muted-foreground">
                                      {selectedEvent.windowReady
                                        ? '净额变化'
                                        : '日内主力净额'}
                                    </dt>
                                    <dd
                                      className={`mt-1 text-base font-medium ${(driver.mainNetInflow ?? 0) >= 0 ? 'market-up' : 'market-down'}`}
                                    >
                                      {fmtMoney(driver.mainNetInflow)}
                                    </dd>
                                  </div>
                                </dl>
                                <p className="mt-2 text-xs text-muted-foreground">
                                  同向资金样本占比：
                                  {driver.contributionPct == null
                                    ? '—'
                                    : `${driver.contributionPct.toFixed(1)}%`}
                                </p>
                                {(sharedRadarSectors.get(driver.code)?.length ??
                                  0) > 1 ? (
                                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                                    跨题材：
                                    {sharedRadarSectors
                                      .get(driver.code)
                                      ?.join(' / ')}
                                  </p>
                                ) : null}
                              </article>
                            ))}
                          </div>
                          <Table className="hidden md:table">
                            <TableHeader>
                              <TableRow>
                                <TableHead>个股</TableHead>
                                <TableHead>细分行业</TableHead>
                                <TableHead>同向关系</TableHead>
                                <TableHead className="text-right">
                                  {selectedEvent.windowReady
                                    ? '3分钟价格变化'
                                    : selectedEvent.selectionBasis ===
                                        'DAY_CHANGE'
                                      ? '日涨跌幅'
                                      : '当前涨速'}
                                </TableHead>
                                <TableHead className="text-right">
                                  {selectedEvent.windowReady
                                    ? '净额变化'
                                    : '日内主力净额'}
                                </TableHead>
                                <TableHead className="text-right">
                                  同向资金样本占比
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {selectedEvent.drivers.map((driver) => (
                                <TableRow key={driver.code}>
                                  <TableCell>
                                    <div className="font-medium">
                                      {driver.name}
                                    </div>
                                    <div className="text-xs text-muted-foreground">
                                      {driver.code}
                                    </div>
                                    {(sharedRadarSectors.get(driver.code)
                                      ?.length ?? 0) > 1 ? (
                                      <div className="text-xs text-amber-700 dark:text-amber-400">
                                        跨题材：
                                        {sharedRadarSectors
                                          .get(driver.code)
                                          ?.join(' / ')}
                                      </div>
                                    ) : null}
                                  </TableCell>
                                  <TableCell>
                                    {driver.industry || '未知'}
                                  </TableCell>
                                  <TableCell>
                                    <Badge
                                      variant="outline"
                                      className={
                                        driver.driverRole === '价格与资金同向'
                                          ? 'status-ready'
                                          : 'status-degraded'
                                      }
                                    >
                                      {driver.driverRole || '当前代理'}
                                    </Badge>
                                  </TableCell>
                                  <TableCell
                                    className={`text-right ${selectedEvent.direction === 'up' ? 'market-up' : 'market-down'}`}
                                  >
                                    {fmtPct(
                                      selectedEvent.windowReady ||
                                        selectedEvent.selectionBasis ===
                                          'DAY_CHANGE'
                                        ? driver.changePct
                                        : driver.speedPct,
                                    )}
                                  </TableCell>
                                  <TableCell
                                    className={`text-right ${(driver.mainNetInflow ?? 0) >= 0 ? 'market-up' : 'market-down'}`}
                                  >
                                    {fmtMoney(driver.mainNetInflow)}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {driver.contributionPct == null
                                      ? '—'
                                      : `${driver.contributionPct.toFixed(1)}%`}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </>
                      ) : (
                        <EmptyState>
                          暂无可用同向个股；查询失败与缺失原因见上方说明。
                        </EmptyState>
                      )}
                    </CardContent>
                  </Card>
                )}
                {flow.data?.series?.length ? (
                  <PersistentStrengthBoard data={flow.data} />
                ) : null}
              </>
            )}
          </TabsContent>

          <TabsContent value="flow">
            {flow.data?.series?.length ? (
              <FlowSplitBoard data={flow.data} />
            ) : (
              <EmptyState>
                {flow.loading
                  ? '正在计算盘中资金分流…'
                  : flow.data?.reason ||
                    flow.error ||
                    '当前没有可用的资金分流样本'}
              </EmptyState>
            )}
          </TabsContent>

          <TabsContent value="promotion" className="space-y-4">
            <LadderOverview
              ladder={ladder.data}
              close={history.snapshots.find(
                (snapshot) =>
                  snapshot.date.replaceAll('-', '') === ladder.data?.tradeDate,
              )}
              onCompetition={() => setActiveTab('competition')}
            />
            <LadderHeightTrend history={history} />
            <Card>
              <CardHeader>
                <CardTitle>晋级统计明细</CardTitle>
                <CardDescription>
                  {ladder.data?.previousTradeDate ?? '上一交易日'} →{' '}
                  {ladder.data?.tradeDate ?? '当前交易日'}
                  ；昨日涨停按原身位统计今日封板、炸板和掉队
                </CardDescription>
                <CardAction>
                  <StateBadge
                    state={ladder.data?.priorDateState}
                    label={
                      ladder.data?.priorDateState === 'DEGRADED'
                        ? '请求日期绑定'
                        : undefined
                    }
                  />
                </CardAction>
              </CardHeader>
              <CardContent>
                {ladder.data?.promotion?.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>梯队</TableHead>
                        <TableHead className="text-right">昨日存量</TableHead>
                        <TableHead className="text-right">成功晋级</TableHead>
                        <TableHead className="text-right">炸板</TableHead>
                        <TableHead className="text-right">其他未封</TableHead>
                        <TableHead className="text-right">晋级率</TableHead>
                        <TableHead>当前领先</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ladder.data.promotion.map((row) => (
                        <TableRow key={row.level}>
                          <TableCell className="font-medium">
                            {row.level}
                          </TableCell>
                          <TableCell className="text-right">
                            {row.started}
                          </TableCell>
                          <TableCell className="text-right market-up">
                            {row.advanced}
                          </TableCell>
                          <TableCell className="text-right market-down">
                            {row.failed}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {row.dropped}
                          </TableCell>
                          <TableCell className="text-right">
                            {row.ratePct.toFixed(0)}%
                          </TableCell>
                          <TableCell>{row.lead.join(' · ') || '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <EmptyState>
                    {ladder.loading
                      ? '正在重建晋级梯队…'
                      : ladder.data?.reason ||
                        ladder.error ||
                        '当前没有可统计的晋级梯队'}
                  </EmptyState>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="competition">
            <Card>
              <CardHeader className="max-sm:grid-cols-1!">
                <CardTitle>同梯队竞争</CardTitle>
                <CardDescription>
                  昨日涨停池按股票代码去重展示；目标梯队从高到低，同梯队内涨幅、涨速靠前。涨速为行情源的短窗涨幅，不是每秒收益。
                </CardDescription>
                <CardAction className="max-sm:col-start-1 max-sm:row-start-3 max-sm:justify-self-start">
                  {ladder.data?.coverage ? (
                    <StateBadge
                      state={
                        ladder.data.coverage.quoteReady ===
                        ladder.data.coverage.competitors
                          ? 'READY'
                          : 'DEGRADED'
                      }
                      label={`${ladder.data.coverage.competitors}只 · 涨幅 ${ladder.data.coverage.priceReady ?? ladder.data.coverage.quoteReady}/${ladder.data.coverage.competitors} · 涨速 ${ladder.data.coverage.speedReady ?? ladder.data.coverage.quoteReady}/${ladder.data.coverage.competitors}`}
                    />
                  ) : null}
                </CardAction>
              </CardHeader>
              <CardContent>
                <div
                  className="mb-4 flex flex-wrap gap-2"
                  aria-label="竞争个股筛选"
                >
                  {(
                    [
                      ['ALL', '全部'],
                      ['SEALED', '封板晋级'],
                      ['FAILED', '炸板未封'],
                      ['DROPPED', '其他未封'],
                      ['NEGATIVE', '只看下跌'],
                    ] as const
                  ).map(([value, label]) => (
                    <Button
                      key={value}
                      size="sm"
                      variant={
                        competitionFilter === value ? 'secondary' : 'outline'
                      }
                      aria-pressed={competitionFilter === value}
                      onClick={() => setCompetitionFilter(value)}
                    >
                      {label}
                    </Button>
                  ))}
                  <span className="self-center text-xs text-muted-foreground">
                    显示 {visibleCompetitors.length} /{' '}
                    {ladder.data?.competitors.length ?? 0}只
                  </span>
                </div>
                {ladder.data?.competitors?.length ? (
                  <>
                    <div
                      className="space-y-2 sm:hidden"
                      aria-label="竞争个股手机卡片"
                    >
                      {visibleCompetitors.map((row) => (
                        <article
                          key={row.code}
                          className="rounded-lg border p-3"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold">{row.name}</span>
                            <Badge variant="outline">
                              {row.fromHeight}进{row.toHeight} ·{' '}
                              {row.state === 'SEALED'
                                ? '已封板'
                                : row.state === 'FAILED'
                                  ? '炸板未封'
                                  : '未封板'}
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {row.code} · {row.industry}
                          </p>
                          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                            <p>
                              涨幅{' '}
                              <span
                                className={`font-mono font-semibold ${(row.changePct ?? 0) < 0 ? 'market-down' : 'market-up'}`}
                              >
                                {fmtPct(row.changePct)}
                              </span>
                            </p>
                            <p>
                              涨速{' '}
                              <span
                                className={`font-mono font-semibold ${(row.speedPct ?? 0) < 0 ? 'market-down' : 'market-up'}`}
                              >
                                {fmtPct(row.speedPct)}
                              </span>
                            </p>
                          </div>
                          {row.firstTouch && (
                            <p className="mt-1 text-xs text-muted-foreground">
                              首次触板 {row.firstTouch} · 开板{row.breakCount}次
                            </p>
                          )}
                        </article>
                      ))}
                    </div>
                    <div className="hidden sm:block">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>目标梯队</TableHead>
                            <TableHead>个股</TableHead>
                            <TableHead>行业</TableHead>
                            <TableHead>状态</TableHead>
                            <TableHead className="text-right">涨幅</TableHead>
                            <TableHead className="text-right">涨速</TableHead>
                            <TableHead>首次触板</TableHead>
                            <TableHead>最终回封</TableHead>
                            <TableHead className="text-right">开板</TableHead>
                            <TableHead className="text-right">成交额</TableHead>
                            <TableHead className="text-right">封单</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {visibleCompetitors.map((row) => (
                            <TableRow key={`${row.code}-${row.toHeight}`}>
                              <TableCell>
                                <Badge variant="secondary">
                                  {row.toHeight}板
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <div className="font-medium">{row.name}</div>
                                <div className="text-xs text-muted-foreground">
                                  {row.code}
                                </div>
                                {row.quoteState !== 'READY' ? (
                                  <div className="text-xs text-muted-foreground">
                                    {row.changePct === null
                                      ? '涨幅待补'
                                      : '涨速待补'}
                                  </div>
                                ) : null}
                              </TableCell>
                              <TableCell>{row.industry}</TableCell>
                              <TableCell>
                                {row.state === 'SEALED' ? (
                                  <Badge
                                    variant="outline"
                                    className="status-ready"
                                  >
                                    封板
                                  </Badge>
                                ) : row.state === 'FAILED' ? (
                                  <Badge
                                    variant="outline"
                                    className="status-degraded"
                                  >
                                    炸板
                                  </Badge>
                                ) : (
                                  <Badge
                                    variant="outline"
                                    className={
                                      (row.changePct ?? 0) < 0
                                        ? 'market-down'
                                        : 'text-muted-foreground'
                                    }
                                  >
                                    {(row.changePct ?? 0) < 0
                                      ? '下跌掉队'
                                      : '未封板'}
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell
                                className={`text-right font-medium ${(row.changePct ?? 0) >= 0 ? 'market-up' : 'market-down'}`}
                              >
                                {fmtPct(row.changePct)}
                              </TableCell>
                              <TableCell
                                className={`text-right font-medium ${(row.speedPct ?? 0) >= 0 ? 'market-up' : 'market-down'}`}
                              >
                                {fmtPct(row.speedPct)}
                              </TableCell>
                              <TableCell className="tabular-nums">
                                {row.firstTouch ?? '—'}
                              </TableCell>
                              <TableCell className="tabular-nums">
                                {row.lastSeal ?? '—'}
                              </TableCell>
                              <TableCell className="text-right">
                                {row.breakCount}
                              </TableCell>
                              <TableCell className="text-right">
                                {fmtAmount(row.amount)}
                              </TableCell>
                              <TableCell className="text-right">
                                {fmtAmount(row.sealFund)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                    {!visibleCompetitors.length && (
                      <EmptyState>
                        当前筛选下没有个股，可切回“全部”。
                      </EmptyState>
                    )}
                  </>
                ) : (
                  <EmptyState>
                    {ladder.loading
                      ? '正在比较同梯队个股…'
                      : ladder.data?.reason ||
                        ladder.error ||
                        '当前没有上一交易日涨停池数据'}
                  </EmptyState>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="speed">
            <Card>
              <CardHeader>
                <CardTitle>涨速榜 · 打板观察</CardTitle>
                <CardDescription>
                  涨速只做触发器；同一核心概念同时进入多只票时加红提示共振，同时展示涨幅、板制距离与近20个交易日涨停次数
                </CardDescription>
                <CardAction>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock3 className="size-3.5" />
                    每秒刷新
                  </div>
                </CardAction>
              </CardHeader>
              <CardContent>
                {hotConcepts.length ? (
                  <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-red-500/35 bg-red-500/[0.08] px-3 py-2 text-sm">
                    <ShieldAlert className="size-4 shrink-0 text-red-600" />
                    <span className="font-medium text-red-700 dark:text-red-400">
                      同概念共振
                    </span>
                    {hotConcepts.slice(0, 8).map(([concept, count]) => (
                      <Badge
                        key={concept}
                        variant="outline"
                        className="border-red-500/45 bg-red-500/15 text-red-700 dark:text-red-300"
                      >
                        {concept} · {count}只
                      </Badge>
                    ))}
                  </div>
                ) : null}
                {speed.data?.rows?.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>个股</TableHead>
                        <TableHead className="text-right">涨速</TableHead>
                        <TableHead className="text-right">涨幅</TableHead>
                        <TableHead>核心概念</TableHead>
                        <TableHead>近20日涨停</TableHead>
                        <TableHead className="text-right">距名义涨停</TableHead>
                        <TableHead>状态</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {speed.data.rows.map((row, index) => {
                        const rowHotConcepts = row.concepts.filter(
                          (concept) =>
                            (speedConceptCounts.get(concept) ?? 0) >= 2,
                        );
                        return (
                          <TableRow
                            key={row.code}
                            className={
                              rowHotConcepts.length
                                ? 'bg-red-500/[0.055] hover:bg-red-500/[0.09]'
                                : undefined
                            }
                          >
                            <TableCell className="text-muted-foreground">
                              {index + 1}
                            </TableCell>
                            <TableCell>
                              <div
                                className={
                                  rowHotConcepts.length
                                    ? 'font-semibold text-red-700 dark:text-red-300'
                                    : 'font-medium'
                                }
                              >
                                {row.name}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {row.code} · {row.limitPct}%板
                              </div>
                            </TableCell>
                            <TableCell
                              className={`text-right font-medium ${(row.speedPct ?? 0) >= 0 ? 'market-up' : 'market-down'}`}
                            >
                              {fmtPct(row.speedPct)}
                            </TableCell>
                            <TableCell
                              className={`text-right ${(row.changePct ?? 0) >= 0 ? 'market-up' : 'market-down'}`}
                            >
                              {fmtPct(row.changePct)}
                            </TableCell>
                            <TableCell>
                              <div className="flex min-w-[210px] flex-wrap gap-1">
                                {row.concepts.length ? (
                                  row.concepts.map((concept) => {
                                    const count =
                                      speedConceptCounts.get(concept) ?? 0;
                                    return (
                                      <Badge
                                        key={concept}
                                        variant={
                                          count >= 2 ? 'outline' : 'secondary'
                                        }
                                        className={
                                          count >= 2
                                            ? 'border-red-500/45 bg-red-500/15 text-red-700 dark:text-red-300'
                                            : undefined
                                        }
                                      >
                                        {concept}
                                        {count >= 2 ? ` · ${count}只` : ''}
                                      </Badge>
                                    );
                                  })
                                ) : (
                                  <StateBadge
                                    state="MISSING"
                                    label="概念缺失"
                                  />
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className="font-medium">
                                {row.recentLimitCount ?? '—'}次
                              </span>
                              <span className="ml-1 text-xs text-muted-foreground">
                                /{row.recentLimitSessions}日
                              </span>
                            </TableCell>
                            <TableCell className="text-right">
                              {fmtPct(row.distanceToLimitPct)}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">{row.status}</Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                ) : (
                  <EmptyState>
                    {speed.loading
                      ? '正在补齐涨速票概念与近期涨停历史…'
                      : speed.data?.reason || speed.error || '当前没有涨速样本'}
                  </EmptyState>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}
