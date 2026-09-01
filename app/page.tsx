'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowLeftRight,
  ArrowUpRight,
  Clock3,
  Layers3,
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

type DataState = 'READY' | 'DEGRADED' | 'MISSING';

type RadarMember = {
  code: string;
  name: string;
  changePct: number | null;
  speedPct: number | null;
  mainNetInflow: number | null;
  amount: number | null;
  industry: string;
  contributionPct?: number | null;
  driverRole?: string;
};

type RadarEvent = {
  code: string;
  name: string;
  changePct: number | null;
  speedPct: number | null;
  mainNetInflow: number | null;
  amount: number | null;
  direction: 'up' | 'down';
  memberCount: number | null;
  directionalCount: number | null;
  drivers: RadarMember[];
  members: RadarMember[];
  driverState: DataState;
  driverBasis: string;
  windowReady?: boolean;
  displayChangePct?: number | null;
  displayFlow?: number | null;
};

type RadarData = {
  status: DataState;
  retrievedAt: string;
  tradeDate: string;
  source?: string;
  reason?: string;
  coverage?: { reported: number; available: number };
  events: RadarEvent[];
};

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
  state: 'SEALED' | 'FAILED';
  changePct: number | null;
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
  priorDateState?: DataState;
  reason?: string;
  counts?: { previousLimitUp: number; todaySealed: number; todayFailed: number };
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
  reason?: string;
  coverage?: { requested: number; conceptReady: number; recentLimitReady: number };
  rows: SpeedRow[];
};

type MarketTimelineDriver = {
  code: string;
  name: string;
  industry: string;
  windowChangePct: number | null;
  mainNetInflow: number | null;
  role: '同窗价格确认' | '当日资金候选';
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
  phase: string;
  lastPointTime: string | null;
  reason?: string;
  basis?: string;
  coverage?: { sectors: number; events: number; timeNodes?: number; indices: number; confirmedDrivers: number; relatedStocks?: number };
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
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const response = await fetch(url, { cache: 'no-store' });
      const payload = await response.json() as T & { reason?: string };
      if (!response.ok) throw new Error(payload.reason || `HTTP ${response.status}`);
      setData(payload);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '行情源短暂波动，正在自动重连');
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

type RadarHistoryPoint = { at: number; event: RadarEvent };

function useWindowedRadar(data: RadarData | null) {
  const history = useRef(new Map<string, RadarHistoryPoint[]>());
  const [events, setEvents] = useState<RadarEvent[]>([]);

  useEffect(() => {
    if (!data?.events?.length) return;
    const now = Date.parse(data.retrievedAt) || Date.now();
    const next = data.events.map((event) => {
      const points = history.current.get(event.code) ?? [];
      const base = [...points].reverse().find((point) => point.at <= now - 165_000);
      const updated = [...points, { at: now, event }].filter((point) => point.at >= now - 6 * 60_000);
      history.current.set(event.code, updated);
      if (!base) {
        return {
          ...event,
          windowReady: false,
          displayChangePct: event.speedPct,
          displayFlow: event.mainNetInflow,
        };
      }
      const deltaChange = (event.changePct ?? 0) - (base.event.changePct ?? 0);
      const deltaFlow = (event.mainNetInflow ?? 0) - (base.event.mainNetInflow ?? 0);
      const direction = event.direction;
      const windowAligns = direction === 'up' ? deltaChange > 0 : deltaChange < 0;
      const baseMembers = new Map(base.event.members.map((member) => [member.code, member]));
      const windowMembers = event.members.map((member) => {
        const before = baseMembers.get(member.code);
        if (!before) return null;
        const memberDeltaFlow = (member.mainNetInflow ?? 0) - (before.mainNetInflow ?? 0);
        const memberDeltaChange = (member.changePct ?? 0) - (before.changePct ?? 0);
        const priceDirectional = direction === 'up' ? memberDeltaChange > 0 : memberDeltaChange < 0;
        if (!priceDirectional) return null;
        const flowDirectional = direction === 'up' ? memberDeltaFlow > 0 : memberDeltaFlow < 0;
        return {
          ...member,
          mainNetInflow: memberDeltaFlow,
          changePct: memberDeltaChange,
          driverRole: flowDirectional ? '价格与资金同向' : '价格速度拖累',
        };
      }).filter(Boolean) as RadarMember[];
      const strong = windowMembers.filter((member) => member.driverRole === '价格与资金同向');
      const priceOnly = windowMembers.filter((member) => member.driverRole !== '价格与资金同向');
      const denominator = strong.reduce((sum, member) => sum + Math.abs(member.mainNetInflow ?? 0), 0);
      const drivers = [
        ...strong.sort((a, b) => Math.abs(b.mainNetInflow ?? 0) - Math.abs(a.mainNetInflow ?? 0)),
        ...priceOnly.sort((a, b) => Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0)),
      ]
        .slice(0, 4)
        .map((member) => ({
          ...member,
          contributionPct: member.driverRole === '价格与资金同向' && denominator > 0
            ? Math.abs(member.mainNetInflow ?? 0) / denominator * 100
            : null,
        }));
      return {
        ...event,
        direction,
        drivers: drivers.length ? drivers : event.drivers,
        driverState: strong.length && windowAligns ? 'READY' as DataState : drivers.length ? 'DEGRADED' as DataState : event.driverState,
        driverBasis: strong.length && windowAligns
          ? '近3分钟个股价格与主力资金同向增量归因'
          : drivers.length ? '近3分钟价格同向，资金未全部同向，按价格拖累/拉动降级展示' : event.driverBasis,
        windowReady: drivers.length > 0 && windowAligns,
        displayChangePct: windowAligns ? deltaChange : event.speedPct,
        displayFlow: deltaFlow,
      };
    });
    setEvents(next);
  }, [data]);

  return events;
}

function fmtPct(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

function fmtMoney(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const amount = value / 100_000_000;
  return `${amount > 0 ? '+' : ''}${amount.toFixed(2)}亿`;
}

function fmtFlowDirection(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '数据待补';
  const magnitude = `${(Math.abs(value) / 100_000_000).toFixed(2)}亿`;
  if (value > 0) return `净流入 ${magnitude}`;
  if (value < 0) return `净流出 ${magnitude}`;
  return '净额 0';
}

function fmtAmount(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${(value / 100_000_000).toFixed(1)}亿`;
}

function fmtTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

function StateBadge({ state, label }: { state?: DataState; label?: string }) {
  if (!state) return <Badge variant="secondary">连接中</Badge>;
  if (state === 'READY') return <Badge variant="outline" className="status-ready">{label ?? 'READY'}</Badge>;
  if (state === 'DEGRADED') return <Badge variant="outline" className="status-degraded">{label ?? 'DEGRADED'}</Badge>;
  return <Badge variant="destructive">{label ?? 'MISSING'}</Badge>;
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{children}</div>;
}

const FLOW_COLORS = [
  '#dc2626', '#e65b33', '#f59e0b', '#a855f7', '#7c3aed', '#2563eb', '#0891b2', '#0d9488',
  '#16a34a', '#65a30d', '#475569', '#64748b', '#9333ea', '#db2777', '#0f766e', '#4f46e5',
];

function SectorFlowChart({ data }: { data: FlowData }) {
  const [mode, setMode] = useState<'all' | 'inflow' | 'outflow'>('all');
  const colorByCode = useMemo(() => new Map(
    data.series.map((item, index) => [item.code, FLOW_COLORS[index % FLOW_COLORS.length]]),
  ), [data.series]);
  const visible = useMemo(() => data.series.filter((item) => {
    if (mode === 'inflow') return item.latestMainNetInflow >= 0;
    if (mode === 'outflow') return item.latestMainNetInflow < 0;
    return true;
  }), [data.series, mode]);
  const chartData = useMemo(() => {
    const rows = new Map<string, Record<string, string | number>>();
    for (const item of visible) {
      for (const point of item.points) {
        const row = rows.get(point.time) ?? { time: point.time };
        row[item.code] = point.mainNetInflow / 100_000_000;
        rows.set(point.time, row);
      }
    }
    return [...rows.values()].sort((a, b) => String(a.time).localeCompare(String(b.time)));
  }, [visible]);
  const chartConfig = useMemo(() => Object.fromEntries(visible.map((item) => [
    item.code,
    { label: item.name, color: colorByCode.get(item.code) ?? '#64748b' },
  ])) as ChartConfig, [colorByCode, visible]);
  const ranking = [...visible].sort((a, b) => b.latestMainNetInflow - a.latestMainNetInflow);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Activity className="size-5" />盘中板块主力净流入曲线</CardTitle>
        <CardDescription>从开盘累计到当前分钟，单位：亿元；右侧为各板块最新累计值</CardDescription>
        <CardAction><StateBadge state={data.curveState} label={`${data.coverage?.available ?? 0}/${data.coverage?.requested ?? 0}板块`} /></CardAction>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1">
            {([['all', '全部曲线'], ['inflow', '净流入'], ['outflow', '净流出']] as const).map(([value, label]) => (
              <Button key={value} type="button" size="sm" variant={mode === value ? 'default' : 'outline'} onClick={() => setMode(value)}>{label}</Button>
            ))}
          </div>
          <div className="text-xs text-muted-foreground">{data.tradeDate} · {data.phase} · 最新点 {data.lastPointTime ?? '—'}</div>
        </div>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_230px]">
          <ChartContainer config={chartConfig} className="h-[430px] w-full aspect-auto" initialDimension={{ width: 960, height: 430 }}>
            <RechartsLineChart data={chartData} margin={{ top: 10, right: 12, bottom: 0, left: 4 }} accessibilityLayer>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis dataKey="time" tickLine={false} axisLine={false} minTickGap={36} />
              <YAxis tickLine={false} axisLine={false} width={58} tickFormatter={(value) => `${Number(value).toFixed(0)}亿`} />
              <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1.5} />
              <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
              {visible.map((item) => (
                <Line key={item.code} type="monotone" dataKey={item.code} name={item.name} stroke={colorByCode.get(item.code)} strokeWidth={1.8} dot={false} connectNulls={false} isAnimationActive={false} />
              ))}
            </RechartsLineChart>
          </ChartContainer>
          <div className="grid max-h-[430px] content-start gap-1 overflow-y-auto pr-1" aria-label="板块最新主力净流入排名">
            {ranking.map((item) => (
              <div key={item.code} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted/70">
                <span className="flex min-w-0 items-center gap-2"><span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: colorByCode.get(item.code) }} /><span className="truncate">{item.name}</span></span>
                <span className={`shrink-0 font-mono font-medium ${item.latestMainNetInflow >= 0 ? 'market-up' : 'market-down'}`}>{fmtMoney(item.latestMainNetInflow)}</span>
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
        {subgroups.length ? subgroups.map((group) => <Badge key={group.name} variant="secondary" className="h-5 px-1.5 text-[10px]">{group.name} {group.count}</Badge>) : <span>暂未补齐</span>}
      </div>
      <div className="truncate">活跃股当日主力资金：{representatives.length ? representatives.map((row) => `${row.name}（${fmtFlowDirection(row.mainNetInflow)}）`).join(' · ') : '暂未补齐'}</div>
    </div>
  );
}

function FlowSplitList({ title, rows, direction }: {
  title: string;
  rows: SectorFlowSeries[];
  direction: 'inflow' | 'outflow';
}) {
  const maxValue = Math.max(...rows.map((item) => Math.abs(item.delta5m ?? 0)), 1);
  return (
    <Card>
      <CardHeader>
        <CardTitle className={`flex items-center gap-2 ${direction === 'inflow' ? 'market-up' : 'market-down'}`}>
          {direction === 'inflow' ? <ArrowUpRight className="size-5" /> : <ArrowDownRight className="size-5" />}{title}
        </CardTitle>
        <CardDescription>按最近5个有效交易分钟的主力净流入增量排序</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length ? rows.map((item, index) => (
          <div key={item.code} className="space-y-1.5">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate"><span className="mr-2 text-xs text-muted-foreground">{index + 1}</span>{item.name}</span>
              <span className={`shrink-0 font-mono font-medium ${direction === 'inflow' ? 'market-up' : 'market-down'}`}>{fmtMoney(item.delta5m)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className={`h-full rounded-full ${direction === 'inflow' ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${Math.max(4, Math.abs(item.delta5m ?? 0) / maxValue * 100)}%` }} />
            </div>
            <div className="flex justify-between text-[11px] text-muted-foreground"><span>累计 {fmtMoney(item.latestMainNetInflow)}</span><span>15分钟 {fmtMoney(item.delta15m)}</span></div>
            <SectorDetailLine item={item} />
          </div>
        )) : <EmptyState>当前样本中暂无这一方向的资金增量</EmptyState>}
      </CardContent>
    </Card>
  );
}

function HorizonFlowList({ title, rows, direction, horizon }: {
  title: string;
  rows: SectorFlowSeries[];
  direction: 'inflow' | 'outflow';
  horizon: 'day' | '30m';
}) {
  const valueOf = (item: SectorFlowSeries) => horizon === 'day' ? item.latestMainNetInflow : item.delta30m;
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className={`text-sm font-medium ${direction === 'inflow' ? 'market-up' : 'market-down'}`}>{title}</h4>
        <span className="text-[11px] text-muted-foreground">{horizon === 'day' ? '开盘至今' : '日内方向 · 30分钟状态'}</span>
      </div>
      <div className="grid gap-2">
        {rows.length ? rows.map((item, index) => (
          <div key={item.code} className="rounded-md bg-muted/45 px-2.5 py-2">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0"><div className="flex min-w-0 items-center gap-1.5"><div className="truncate text-sm"><span className="mr-2 text-xs text-muted-foreground">{index + 1}</span>{item.name}</div>{horizon === '30m' && item.persistenceLabel ? <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px]">{item.persistenceLabel}</Badge> : null}</div><div className="mt-0.5 text-[11px] text-muted-foreground">板块涨跌 {fmtPct(item.changePct)} · 累计 {fmtMoney(item.latestMainNetInflow)}</div></div>
              <span className={`shrink-0 font-mono text-sm font-medium ${(valueOf(item) ?? 0) >= 0 ? 'market-up' : 'market-down'}`}>{fmtMoney(valueOf(item))}</span>
            </div>
            <div className="mt-2"><SectorDetailLine item={item} /></div>
          </div>
        )) : <div className="rounded-md border border-dashed px-3 py-5 text-center text-xs text-muted-foreground">当前没有满足同向价格与资金条件的板块</div>}
      </div>
    </div>
  );
}

function PersistentStrengthBoard({ data }: { data: FlowData }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>长周期持续强弱</CardTitle>
        <CardDescription>先按开盘至今板块涨跌与累计主力资金同向筛选，再标注最近30分钟是持续、回流还是转弱；短时反抽不再让日内弱势整体消失</CardDescription>
        <CardAction><StateBadge state={data.series.some((item) => item.delta30m !== null) ? 'READY' : 'DEGRADED'} label="长周期" /></CardAction>
      </CardHeader>
      <CardContent className="grid gap-3 lg:grid-cols-2">
        <HorizonFlowList title="持续强势" rows={data.split.persistentStrong} direction="inflow" horizon="30m" />
        <HorizonFlowList title="持续弱势" rows={data.split.persistentWeak} direction="outflow" horizon="30m" />
      </CardContent>
    </Card>
  );
}

function FlowSplitBoard({ data }: { data: FlowData }) {
  const leadersIn = data.split.inflow.slice(0, 3).map((item) => item.name).join('、') || '暂无';
  const leadersOut = data.split.outflow.slice(0, 3).map((item) => item.name).join('、') || '暂无';
  return (
    <div className="space-y-4">
      <section className="grid gap-3 md:grid-cols-3" aria-label="资金分流摘要">
        <Card size="sm"><CardHeader><CardTitle>流入侧扩散</CardTitle><CardAction><span className="market-up text-lg font-semibold">{data.split.positiveCount}</span></CardAction><CardDescription>{leadersIn}</CardDescription></CardHeader></Card>
        <Card size="sm"><CardHeader><CardTitle>流出侧扩散</CardTitle><CardAction><span className="market-down text-lg font-semibold">{data.split.negativeCount}</span></CardAction><CardDescription>{leadersOut}</CardDescription></CardHeader></Card>
        <Card size="sm"><CardHeader><CardTitle>观察窗口</CardTitle><CardAction><StateBadge state={data.splitState} /></CardAction><CardDescription>最近5个有效交易分钟 · {data.phase} {data.lastPointTime ?? '—'}</CardDescription></CardHeader></Card>
      </section>
      <div className="rounded-lg border bg-muted/35 px-4 py-3 text-sm">
        <div className="flex items-center gap-2 font-medium"><ArrowLeftRight className="size-4" />资金分流观察</div>
        <p className="mt-1 text-muted-foreground">流出侧集中在「{leadersOut}」，流入侧集中在「{leadersIn}」。这是概念板块的方向对照，不代表这些板块之间存在可逐笔证明的一一转移关系。</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <FlowSplitList title="资金正在流入" rows={data.split.inflow} direction="inflow" />
        <FlowSplitList title="资金正在流出" rows={data.split.outflow} direction="outflow" />
      </div>
      <Card>
        <CardHeader><CardTitle>当日累计净流入 / 净流出</CardTitle><CardDescription>即使最近5分钟发生回流，日内累计失血板块仍会保留在净流出侧，不再消失</CardDescription></CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-2">
          <HorizonFlowList title="当日累计净流入" rows={data.split.cumulativeInflow} direction="inflow" horizon="day" />
          <HorizonFlowList title="当日累计净流出" rows={data.split.cumulativeOutflow} direction="outflow" horizon="day" />
        </CardContent>
      </Card>
    </div>
  );
}

function MarketTimelineBoard({ data }: { data: MarketTimelineData }) {
  const starts = data.events.filter((event) => event.kind === 'START');
  const strongs = data.events.filter((event) => event.kind === 'STRONG');
  const cashouts = data.events.filter((event) => event.kind === 'CASHOUT');
  const weakens = data.events.filter((event) => event.kind === 'WEAKEN');
  const strongest = [...starts].sort((a, b) => (b.sectorWindowChangePct ?? 0) - (a.sectorWindowChangePct ?? 0))[0];
  const relatedCount = new Set(data.events.flatMap((event) => (event.relatedStocks ?? []).map((stock) => stock.code))).size;
  const groups = [...data.events.reduce((grouped, event) => {
    const sameMinute = grouped.get(event.time) ?? [];
    sameMinute.push(event);
    grouped.set(event.time, sameMinute);
    return grouped;
  }, new Map<string, MarketTimelineEvent[]>()).entries()]
    .sort(([a], [b]) => b.localeCompare(a));

  const eventPhrase = (events: MarketTimelineEvent[]) => {
    const phrases: string[] = [];
    const add = (kind: MarketTimelineEvent['kind'], singular: string, multiple: string) => {
      const names = events.filter((event) => event.kind === kind).map((event) => event.sectorName);
      if (names.length) phrases.push(`${names.join('、')}${names.length > 1 ? multiple : singular}`);
    };
    add('START', '启动', '同步启动');
    add('STRONG', '延续强势', '同步延续强势');
    add('CASHOUT', '出现兑现', '同步出现兑现');
    add('WEAKEN', '转弱', '同步转弱');
    add('OBSERVE', '进入震荡观察', '同步进入震荡观察');
    return phrases.join('；');
  };

  const indexPhrase = (events: MarketTimelineEvent[]) => {
    const indices = events.find((event) => event.indices.length)?.indices ?? [];
    if (!indices.length) return '指数同窗数据待补。';
    const detail = indices.map((marketIndex) => `${marketIndex.name}当时${fmtPct(marketIndex.changePct)}、转折窗${fmtPct(marketIndex.windowChangePct)}`).join('，');
    const windows = indices.map((marketIndex) => marketIndex.windowChangePct).filter((value): value is number => value !== null);
    const hasStart = events.some((event) => (event.sectorWindowChangePct ?? 0) > 0);
    const hasExit = events.some((event) => (event.sectorWindowChangePct ?? 0) < 0);
    let relation = '指数分化，题材走势相对独立';
    if (windows.length && windows.every((value) => value > 0)) relation = hasStart ? '题材与指数共振上行' : '板块回落时指数仍有承接';
    if (windows.length && windows.every((value) => value < 0)) relation = hasStart ? '题材逆指数启动' : '板块回落与指数同向';
    if (hasStart && hasExit) relation = '同一分钟板块发生切换，指数仅作环境参照';
    return `${detail}，${relation}。`;
  };
  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="盘面脉络摘要">
        <Card size="sm"><CardHeader><CardTitle>启动 / 延续</CardTitle><CardAction><span className="market-up text-lg font-semibold">{starts.length + strongs.length}</span></CardAction><CardDescription>启动{starts.length} · 延续{strongs.length} · {data.coverage?.timeNodes ?? groups.length}个资金转折</CardDescription></CardHeader></Card>
        <Card size="sm"><CardHeader><CardTitle>兑现 / 走弱</CardTitle><CardAction><span className="market-down text-lg font-semibold">{cashouts.length + weakens.length}</span></CardAction><CardDescription>兑现{cashouts.length} · 走弱{weakens.length}</CardDescription></CardHeader></Card>
        <Card size="sm"><CardHeader><CardTitle>最强启动</CardTitle><CardAction><ArrowUpRight className="size-4 market-up" /></CardAction><CardDescription>{strongest ? `${strongest.time} ${strongest.sectorName} ${fmtPct(strongest.sectorWindowChangePct)}` : '等待新启动'}</CardDescription></CardHeader></Card>
        <Card size="sm"><CardHeader><CardTitle>个股覆盖</CardTitle><CardAction><StateBadge state={data.status} /></CardAction><CardDescription>{data.coverage ? `${data.coverage.confirmedDrivers}只同窗确认 · ${relatedCount}只当日相关异动` : '正在对齐分钟序列'}</CardDescription></CardHeader></Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Clock3 className="size-5" />今日盘面直播</CardTitle>
          <CardDescription>最新在上 · 仅在板块资金方向反转或流入/流出明显加速时记录，时间取真实转折分钟</CardDescription>
          <CardAction><StateBadge state={data.status} label={`${data.phase} ${data.lastPointTime ?? '—'}`} /></CardAction>
        </CardHeader>
        <CardContent>
          {groups.length ? (
            <div>
              {groups.map(([time, events], groupIndex) => {
                const bullish = events.reduce((sum, event) => sum + (event.sectorWindowChangePct ?? 0), 0) >= 0;
                const relatedStocks = [...events.flatMap((event) => event.relatedStocks ?? []).reduce((stocks, stock) => {
                  if (!stocks.has(stock.code)) stocks.set(stock.code, stock);
                  return stocks;
                }, new Map<string, MarketTimelineRelatedStock>()).values()].slice(0, 16);
                const confirmedDrivers = [...events.flatMap((event) => event.drivers.filter((driver) => driver.role === '同窗价格确认')).reduce((drivers, driver) => {
                  if (!drivers.has(driver.code)) drivers.set(driver.code, driver);
                  return drivers;
                }, new Map<string, MarketTimelineDriver>()).values()];
                const moveText = events.map((event) => `${event.sectorName}${fmtPct(event.sectorWindowChangePct)}`).join('、');
                const flowText = events.map((event) => `${event.sectorName}${fmtFlowDirection(event.flowDelta)}，前窗${fmtFlowDirection(event.flowPreviousDelta)}`).join('；');
                return (
                  <article key={`${time}-${events.map((event) => event.id).join('-')}`} className="grid grid-cols-[54px_18px_minmax(0,1fr)] gap-x-2 sm:grid-cols-[66px_20px_minmax(0,1fr)] sm:gap-x-3">
                    <time className="pt-4 text-right font-mono text-sm font-semibold tabular-nums whitespace-nowrap">{time}</time>
                    <div className="relative flex justify-center">
                      <span className={`absolute w-px bg-border ${groupIndex === 0 ? 'top-5' : 'top-0'} ${groupIndex === groups.length - 1 ? 'bottom-5' : 'bottom-0'}`} />
                      <span className={`relative mt-[18px] size-2.5 shrink-0 rounded-full ring-4 ring-background ${bullish ? 'bg-red-500' : 'bg-emerald-500'}`} />
                    </div>
                    <div className={`mb-4 min-w-0 rounded-lg border p-3.5 sm:p-4 ${bullish ? 'border-red-500/25 bg-red-500/[0.035]' : 'border-emerald-500/25 bg-emerald-500/[0.035]'}`}>
                      <div className="flex flex-wrap gap-2">
                        {events.map((event) => <Badge key={event.id} variant="outline" className={(event.sectorWindowChangePct ?? 0) >= 0 ? 'status-ready' : 'status-degraded'}>{event.sectorName} · {event.label}</Badge>)}
                      </div>
                      <p className="mt-3 text-[15px] font-medium leading-7 sm:text-base">
                        {eventPhrase(events)}。资金转折窗：{flowText}；同期板块价格变化为{moveText}。{indexPhrase(events)}
                      </p>

                      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {events.map((event) => (
                          <div key={event.id} className="rounded-md border bg-background/75 px-3 py-2 text-xs leading-5">
                            <div className="flex items-center justify-between gap-2"><span className="font-medium">{event.sectorName}</span><span className={`font-mono font-semibold ${(event.sectorWindowChangePct ?? 0) >= 0 ? 'market-up' : 'market-down'}`}>{fmtPct(event.sectorWindowChangePct)}</span></div>
                            <div className="text-muted-foreground">3分钟资金 {fmtFlowDirection(event.flowDelta)} · 较前窗加速度 {fmtMoney(event.flowAcceleration)}</div>
                            <div className="text-muted-foreground">当时 {fmtPct(event.sectorAtTimeChangePct)} · 最新 {fmtPct(event.sectorChangePct)} · 当日主力 {fmtFlowDirection(event.sectorDailyFlow)}</div>
                          </div>
                        ))}
                      </div>

                      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-medium">同窗确认股</span>
                        {confirmedDrivers.length ? confirmedDrivers.map((driver) => (
                          <span key={driver.code} className="rounded-md border border-amber-500/25 bg-amber-500/[0.06] px-2 py-1">
                            {driver.name} <span className={(driver.windowChangePct ?? 0) >= 0 ? 'market-up' : 'market-down'}>{fmtPct(driver.windowChangePct)}</span>
                          </span>
                        )) : <StateBadge state="DEGRADED" label="同窗价格未确认" />}
                      </div>

                      <div className="mt-4">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-medium">板块相关异动股</span><span className="text-[11px] text-muted-foreground">当日最新排名 · 与历史节点分开</span></div>
                        {relatedStocks.length ? (
                          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-4">
                            {relatedStocks.map((stock) => (
                              <div key={stock.code} className="flex min-w-0 items-center justify-between gap-2 rounded-md bg-muted/70 px-2.5 py-2 text-xs">
                                <span className="min-w-0 truncate" title={`${stock.name} · ${stock.industry}`}>{stock.name}</span>
                                <span className={`shrink-0 font-mono font-semibold ${(stock.changePct ?? 0) >= 0 ? 'market-up' : 'market-down'}`}>{fmtPct(stock.changePct)}</span>
                              </div>
                            ))}
                          </div>
                        ) : <EmptyState>相关异动股当前不可用</EmptyState>}
                      </div>
                      <p className="mt-3 text-[11px] leading-5 text-muted-foreground">{events.map((event) => `${event.sectorName}：${event.driverBasis}`).join('；')}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : <EmptyState>当前还没有达到阈值的板块启动或兑现节点</EmptyState>}
          {data.basis ? <p className="mt-4 border-t pt-3 text-xs leading-5 text-muted-foreground">{data.basis}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}

export default function Home() {
  const radar = usePolling<RadarData>('/api/radar', 15_000);
  const flow = usePolling<FlowData>('/api/flow', 60_000);
  const timeline = usePolling<MarketTimelineData>('/api/timeline', 60_000);
  const ladder = usePolling<LadderData>('/api/ladder', 30_000);
  const speed = usePolling<SpeedData>('/api/speed', 1_000);
  const radarEvents = useWindowedRadar(radar.data);
  const [selectedSector, setSelectedSector] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!radarEvents.length) return;
    if (!selectedSector || !radarEvents.some((event) => event.code === selectedSector)) {
      setSelectedSector(radarEvents[0].code);
    }
  }, [radarEvents, selectedSector]);

  const selectedEvent = radarEvents.find((event) => event.code === selectedSector) ?? radarEvents[0];
  const latestAt = [radar.data?.retrievedAt, flow.data?.retrievedAt, timeline.data?.retrievedAt, ladder.data?.retrievedAt, speed.data?.retrievedAt]
    .filter(Boolean).sort().at(-1);
  const sourceError = radar.error || flow.error || timeline.error || ladder.error || speed.error;
  const sourceNotice = sourceError || radar.data?.reason || flow.data?.reason || timeline.data?.reason || ladder.data?.reason || speed.data?.reason;
  const manualRefresh = async () => {
    setRefreshing(true);
    await Promise.all([radar.refresh(), flow.refresh(), timeline.refresh(), ladder.refresh(), speed.refresh()]);
    setRefreshing(false);
  };

  const ladderSummary = ladder.data?.counts;
  const speedCoverage = speed.data?.coverage;
  const radarCoverage = radar.data?.coverage;
  const flowCoverage = flow.data?.coverage;
  const timelineCoverage = timeline.data?.coverage;
  const genericConcepts = new Set(['融资融券', '深股通', '沪股通', 'MSCI中国', '富时罗素', '标普道琼斯A股', '国企改革', '央企改革', '央国企改革', '专精特新']);
  const speedConceptCounts = new Map<string, number>();
  for (const row of speed.data?.rows ?? []) {
    for (const concept of new Set(row.concepts.filter((item) => !genericConcepts.has(item)))) {
      speedConceptCounts.set(concept, (speedConceptCounts.get(concept) ?? 0) + 1);
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
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground"><Activity /></div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold tracking-tight sm:text-lg">李米看板</h1>
              <p className="truncate text-xs text-muted-foreground">盘面脉络、板块资金、连板梯队与涨速一屏联动</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="hidden gap-1.5 sm:inline-flex"><span className={`size-1.5 rounded-full ${sourceNotice ? 'bg-amber-500' : 'bg-emerald-500'}`} />{sourceNotice ? '自动降级' : '监控中'} {fmtTime(latestAt)}</Badge>
            <Button variant="outline" size="sm" onClick={() => void manualRefresh()} aria-label="刷新盘中数据">
              <RefreshCw className={refreshing ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">刷新</span>
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] space-y-4 px-4 py-4 sm:px-6 sm:py-6">
        {sourceNotice && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <span>{sourceNotice}。系统会自动重连，已有快照时继续展示并标记为降级。</span>
          </div>
        )}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6" aria-label="数据状态">
          <Card size="sm"><CardHeader><CardTitle className="flex items-center gap-2"><Clock3 className="size-4 text-cyan-500" />盘面脉络</CardTitle><CardAction><StateBadge state={timeline.data?.status} /></CardAction><CardDescription>{timelineCoverage ? `${timelineCoverage.timeNodes ?? timelineCoverage.events}个资金转折 · ${timelineCoverage.events}个板块节点` : '正在重建时间轴'} · 60秒刷新</CardDescription></CardHeader></Card>
          <Card size="sm"><CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4 text-emerald-500" />概念板块</CardTitle><CardAction><StateBadge state={radar.data?.status} /></CardAction><CardDescription>{radarCoverage ? `${radarCoverage.available}/${radarCoverage.reported}板块` : '正在连接'} · 15秒刷新</CardDescription></CardHeader></Card>
          <Card size="sm"><CardHeader><CardTitle className="flex items-center gap-2"><Activity className="size-4 text-violet-500" />资金曲线</CardTitle><CardAction><StateBadge state={flow.data?.status} /></CardAction><CardDescription>{flowCoverage ? `${flowCoverage.available}/${flowCoverage.requested}板块` : '正在连接'} · 分钟序列</CardDescription></CardHeader></Card>
          <Card size="sm"><CardHeader><CardTitle className="flex items-center gap-2"><Layers3 className="size-4 text-sky-500" />驱动成分</CardTitle><CardAction><StateBadge state={selectedEvent?.driverState} label={selectedEvent?.windowReady ? '3分钟就绪' : '预热中'} /></CardAction><CardDescription>{selectedEvent ? `${selectedEvent.directionalCount ?? 0}/${selectedEvent.memberCount ?? 0}只同向` : '等待板块异动'} · 贡献可追溯</CardDescription></CardHeader></Card>
          <Card size="sm"><CardHeader><CardTitle className="flex items-center gap-2"><Swords className="size-4 text-amber-500" />连板梯队</CardTitle><CardAction><StateBadge state={ladder.data?.status} /></CardAction><CardDescription>{ladderSummary ? `昨日${ladderSummary.previousLimitUp} · 今封${ladderSummary.todaySealed} · 炸${ladderSummary.todayFailed}` : '正在连接'} · 30秒刷新</CardDescription></CardHeader></Card>
          <Card size="sm"><CardHeader><CardTitle className="flex items-center gap-2"><Zap className="size-4 text-rose-500" />涨速样本</CardTitle><CardAction><StateBadge state={speed.data?.status} /></CardAction><CardDescription>{speedCoverage ? `概念${speedCoverage.conceptReady}/${speedCoverage.requested} · 涨停史${speedCoverage.recentLimitReady}/${speedCoverage.requested}` : '正在连接'} · 每秒刷新</CardDescription></CardHeader></Card>
        </section>

        <Tabs defaultValue="timeline" className="gap-4">
          <TabsList variant="line" className="max-w-full overflow-x-auto">
            <TabsTrigger value="timeline"><Clock3 />盘面脉络</TabsTrigger>
            <TabsTrigger value="radar"><Activity />板块异动</TabsTrigger>
            <TabsTrigger value="flow"><ArrowLeftRight />资金分流</TabsTrigger>
            <TabsTrigger value="promotion"><TrendingUp />连板晋级</TabsTrigger>
            <TabsTrigger value="competition"><Swords />梯队竞争</TabsTrigger>
            <TabsTrigger value="speed"><Zap />涨速榜</TabsTrigger>
          </TabsList>

          <TabsContent value="timeline">
            {timeline.data?.events?.length ? <MarketTimelineBoard data={timeline.data} /> : <EmptyState>{timeline.loading ? '正在对齐板块、指数与个股的分钟节点…' : timeline.data?.reason || timeline.error || '当前还没有达到阈值的盘面节点'}</EmptyState>}
          </TabsContent>

          <TabsContent value="radar" className="space-y-4">
            {flow.data?.series?.length ? <SectorFlowChart data={flow.data} /> : <EmptyState>{flow.loading ? '正在读取板块主力净流入分钟曲线…' : flow.data?.reason || flow.error || '当前没有可用的板块资金曲线'}</EmptyState>}
            {!radarEvents.length ? <EmptyState>{radar.loading ? '正在建立板块监控…' : radar.data?.reason || radar.error || '当前没有达到阈值的板块异动'}</EmptyState> : (
              <>
                <div className="grid gap-4 lg:grid-cols-2">
                  {(['up', 'down'] as const).map((direction) => (
                    <Card key={direction}>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">{direction === 'up' ? <ArrowUpRight className="market-up" /> : <ArrowDownRight className="market-down" />}{direction === 'up' ? '明显拉升' : '明显下跌'}</CardTitle>
                        <CardDescription>{radarEvents.some((item) => item.windowReady) ? '近3分钟同窗口变化' : '板块涨速与当前资金代理，约3分钟后升级'}</CardDescription>
                      </CardHeader>
                      <CardContent className="grid gap-2">
                        {radarEvents.filter((item) => item.direction === direction).map((item) => (
                          <button key={item.code} type="button" onClick={() => setSelectedSector(item.code)} className={`w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/70 ${selectedSector === item.code ? 'border-ring bg-muted/60 ring-1 ring-ring' : 'bg-muted/30'}`}>
                            <div className="flex items-start justify-between gap-3">
                              <div><h3 className="font-medium">{item.name}</h3><p className="mt-1 truncate text-xs text-muted-foreground">{item.drivers.map((driver) => driver.name).join(' · ') || '驱动股待补齐'}</p></div>
                              <div className="text-right"><p className={`text-base font-medium ${direction === 'up' ? 'market-up' : 'market-down'}`}>{fmtPct(item.displayChangePct)}</p><p className={`text-xs ${direction === 'up' ? 'market-up' : 'market-down'}`}>{fmtMoney(item.displayFlow)}</p></div>
                            </div>
                            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground"><span>{item.windowReady ? '3分钟资金与价格同向' : '窗口预热 · 当前代理'}</span><span>{item.directionalCount ?? '—'}/{item.memberCount ?? '—'}只同向</span></div>
                          </button>
                        ))}
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {flow.data?.series?.length ? <PersistentStrengthBoard data={flow.data} /> : null}

                {selectedEvent && (
                  <Card>
                    <CardHeader>
                      <CardTitle>{selectedEvent.name} · 主要驱动个股</CardTitle>
                      <CardDescription>{selectedEvent.driverBasis}</CardDescription>
                      <CardAction><StateBadge state={selectedEvent.driverState} label={selectedEvent.windowReady ? '同窗口归因' : '当前资金代理'} /></CardAction>
                    </CardHeader>
                    <CardContent>
                      {selectedEvent.drivers.length ? <Table><TableHeader><TableRow><TableHead>个股</TableHead><TableHead>细分行业</TableHead><TableHead>归因层级</TableHead><TableHead className="text-right">{selectedEvent.windowReady ? '3分钟价格变化' : '当前涨速'}</TableHead><TableHead className="text-right">资金增量/代理</TableHead><TableHead className="text-right">资金贡献</TableHead></TableRow></TableHeader><TableBody>{selectedEvent.drivers.map((driver) => <TableRow key={driver.code}><TableCell><div className="font-medium">{driver.name}</div><div className="text-xs text-muted-foreground">{driver.code}</div></TableCell><TableCell>{driver.industry || '未知'}</TableCell><TableCell><Badge variant="outline" className={driver.driverRole === '价格与资金同向' ? 'status-ready' : 'status-degraded'}>{driver.driverRole || '当前代理'}</Badge></TableCell><TableCell className={`text-right ${selectedEvent.direction === 'up' ? 'market-up' : 'market-down'}`}>{fmtPct(selectedEvent.windowReady ? driver.changePct : driver.speedPct)}</TableCell><TableCell className={`text-right ${(driver.mainNetInflow ?? 0) >= 0 ? 'market-up' : 'market-down'}`}>{fmtMoney(driver.mainNetInflow)}</TableCell><TableCell className="text-right">{fmtPct(driver.contributionPct ?? null, 1)}</TableCell></TableRow>)}</TableBody></Table> : <EmptyState>成分股暂时无法建立可追溯归因</EmptyState>}
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="flow">
            {flow.data?.series?.length ? <FlowSplitBoard data={flow.data} /> : <EmptyState>{flow.loading ? '正在计算盘中资金分流…' : flow.data?.reason || flow.error || '当前没有可用的资金分流样本'}</EmptyState>}
          </TabsContent>

          <TabsContent value="promotion">
            <Card>
              <CardHeader><CardTitle>连板晋级漏斗</CardTitle><CardDescription>{ladder.data?.previousTradeDate ?? '上一交易日'} → {ladder.data?.tradeDate ?? '当前交易日'}；昨日涨停按原身位统计今日封板、炸板和掉队</CardDescription><CardAction><StateBadge state={ladder.data?.priorDateState} label={ladder.data?.priorDateState === 'DEGRADED' ? '请求日期绑定' : undefined} /></CardAction></CardHeader>
              <CardContent>{ladder.data?.promotion?.length ? <Table><TableHeader><TableRow><TableHead>梯队</TableHead><TableHead className="text-right">昨日存量</TableHead><TableHead className="text-right">成功晋级</TableHead><TableHead className="text-right">炸板</TableHead><TableHead className="text-right">未触板</TableHead><TableHead className="text-right">晋级率</TableHead><TableHead>当前领先</TableHead></TableRow></TableHeader><TableBody>{ladder.data.promotion.map((row) => <TableRow key={row.level}><TableCell className="font-medium">{row.level}</TableCell><TableCell className="text-right">{row.started}</TableCell><TableCell className="text-right market-up">{row.advanced}</TableCell><TableCell className="text-right market-down">{row.failed}</TableCell><TableCell className="text-right text-muted-foreground">{row.dropped}</TableCell><TableCell className="text-right">{row.ratePct.toFixed(0)}%</TableCell><TableCell>{row.lead.join(' · ') || '—'}</TableCell></TableRow>)}</TableBody></Table> : <EmptyState>{ladder.loading ? '正在重建晋级梯队…' : ladder.data?.reason || ladder.error || '当前没有可统计的晋级梯队'}</EmptyState>}</CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="competition">
            <Card>
              <CardHeader><CardTitle>同梯队竞争</CardTitle><CardDescription>同身位比较封板状态、首次触板、最终回封、开板次数与成交容量</CardDescription></CardHeader>
              <CardContent>{ladder.data?.competitors?.length ? <Table><TableHeader><TableRow><TableHead>目标梯队</TableHead><TableHead>个股</TableHead><TableHead>行业</TableHead><TableHead>状态</TableHead><TableHead>首次触板</TableHead><TableHead>最终回封</TableHead><TableHead className="text-right">开板</TableHead><TableHead className="text-right">成交额</TableHead><TableHead className="text-right">封单</TableHead></TableRow></TableHeader><TableBody>{ladder.data.competitors.map((row) => <TableRow key={`${row.code}-${row.toHeight}`}><TableCell><Badge variant="secondary">{row.toHeight}板</Badge></TableCell><TableCell><div className="font-medium">{row.name}</div><div className="text-xs text-muted-foreground">{row.code}</div></TableCell><TableCell>{row.industry}</TableCell><TableCell>{row.state === 'SEALED' ? <Badge variant="outline" className="status-ready">封板</Badge> : <Badge variant="outline" className="status-degraded">炸板</Badge>}</TableCell><TableCell className="tabular-nums">{row.firstTouch ?? '—'}</TableCell><TableCell className="tabular-nums">{row.lastSeal ?? '—'}</TableCell><TableCell className="text-right">{row.breakCount}</TableCell><TableCell className="text-right">{fmtAmount(row.amount)}</TableCell><TableCell className="text-right">{fmtAmount(row.sealFund)}</TableCell></TableRow>)}</TableBody></Table> : <EmptyState>{ladder.loading ? '正在比较同梯队个股…' : ladder.data?.reason || ladder.error || '当前没有封板或炸板竞争者'}</EmptyState>}</CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="speed">
            <Card>
              <CardHeader><CardTitle>涨速榜 · 打板观察</CardTitle><CardDescription>涨速只做触发器；同一核心概念同时进入多只票时加红提示共振，同时展示涨幅、板制距离与近20个交易日涨停次数</CardDescription><CardAction><div className="flex items-center gap-1 text-xs text-muted-foreground"><Clock3 className="size-3.5" />每秒刷新</div></CardAction></CardHeader>
              <CardContent>
                {hotConcepts.length ? <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-red-500/35 bg-red-500/[0.08] px-3 py-2 text-sm"><ShieldAlert className="size-4 shrink-0 text-red-600" /><span className="font-medium text-red-700 dark:text-red-400">同概念共振</span>{hotConcepts.slice(0, 8).map(([concept, count]) => <Badge key={concept} variant="outline" className="border-red-500/45 bg-red-500/15 text-red-700 dark:text-red-300">{concept} · {count}只</Badge>)}</div> : null}
                {speed.data?.rows?.length ? <Table><TableHeader><TableRow><TableHead>#</TableHead><TableHead>个股</TableHead><TableHead className="text-right">涨速</TableHead><TableHead className="text-right">涨幅</TableHead><TableHead>核心概念</TableHead><TableHead>近20日涨停</TableHead><TableHead className="text-right">距名义涨停</TableHead><TableHead>状态</TableHead></TableRow></TableHeader><TableBody>{speed.data.rows.map((row, index) => {
                  const rowHotConcepts = row.concepts.filter((concept) => (speedConceptCounts.get(concept) ?? 0) >= 2);
                  return <TableRow key={row.code} className={rowHotConcepts.length ? 'bg-red-500/[0.055] hover:bg-red-500/[0.09]' : undefined}><TableCell className="text-muted-foreground">{index + 1}</TableCell><TableCell><div className={rowHotConcepts.length ? 'font-semibold text-red-700 dark:text-red-300' : 'font-medium'}>{row.name}</div><div className="text-xs text-muted-foreground">{row.code} · {row.limitPct}%板</div></TableCell><TableCell className={`text-right font-medium ${(row.speedPct ?? 0) >= 0 ? 'market-up' : 'market-down'}`}>{fmtPct(row.speedPct)}</TableCell><TableCell className={`text-right ${(row.changePct ?? 0) >= 0 ? 'market-up' : 'market-down'}`}>{fmtPct(row.changePct)}</TableCell><TableCell><div className="flex min-w-[210px] flex-wrap gap-1">{row.concepts.length ? row.concepts.map((concept) => {
                    const count = speedConceptCounts.get(concept) ?? 0;
                    return <Badge key={concept} variant={count >= 2 ? 'outline' : 'secondary'} className={count >= 2 ? 'border-red-500/45 bg-red-500/15 text-red-700 dark:text-red-300' : undefined}>{concept}{count >= 2 ? ` · ${count}只` : ''}</Badge>;
                  }) : <StateBadge state="MISSING" label="概念缺失" />}</div></TableCell><TableCell><span className="font-medium">{row.recentLimitCount ?? '—'}次</span><span className="ml-1 text-xs text-muted-foreground">/{row.recentLimitSessions}日</span></TableCell><TableCell className="text-right">{fmtPct(row.distanceToLimitPct)}</TableCell><TableCell><Badge variant="outline">{row.status}</Badge></TableCell></TableRow>;
                })}</TableBody></Table> : <EmptyState>{speed.loading ? '正在补齐涨速票概念与近期涨停历史…' : speed.data?.reason || speed.error || '当前没有涨速样本'}</EmptyState>}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}
