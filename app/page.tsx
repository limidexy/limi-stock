'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowDownRight,
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
      setError(String(reason));
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
      const direction: 'up' | 'down' = deltaChange >= 0 ? 'up' : 'down';
      const baseMembers = new Map(base.event.members.map((member) => [member.code, member]));
      const candidates = event.members.map((member) => {
        const before = baseMembers.get(member.code);
        if (!before) return null;
        const memberDeltaFlow = (member.mainNetInflow ?? 0) - (before.mainNetInflow ?? 0);
        const memberDeltaChange = (member.changePct ?? 0) - (before.changePct ?? 0);
        const sameDirection = direction === 'up'
          ? memberDeltaFlow > 0 && memberDeltaChange > 0
          : memberDeltaFlow < 0 && memberDeltaChange < 0;
        return sameDirection ? { ...member, mainNetInflow: memberDeltaFlow, changePct: memberDeltaChange } : null;
      }).filter(Boolean) as RadarMember[];
      const denominator = candidates.reduce((sum, member) => sum + Math.abs(member.mainNetInflow ?? 0), 0);
      const drivers = candidates
        .sort((a, b) => Math.abs(b.mainNetInflow ?? 0) - Math.abs(a.mainNetInflow ?? 0))
        .slice(0, 4)
        .map((member) => ({
          ...member,
          contributionPct: denominator > 0 ? Math.abs(member.mainNetInflow ?? 0) / denominator * 100 : null,
        }));
      return {
        ...event,
        direction,
        drivers: drivers.length ? drivers : event.drivers,
        driverState: drivers.length ? 'READY' as DataState : event.driverState,
        driverBasis: drivers.length ? '近3分钟个股主力净流入增量，占同向成分股增量的比例' : event.driverBasis,
        windowReady: drivers.length > 0,
        displayChangePct: deltaChange,
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

export default function Home() {
  const radar = usePolling<RadarData>('/api/radar', 15_000);
  const ladder = usePolling<LadderData>('/api/ladder', 30_000);
  const speed = usePolling<SpeedData>('/api/speed', 5_000);
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
  const latestAt = [radar.data?.retrievedAt, ladder.data?.retrievedAt, speed.data?.retrievedAt]
    .filter(Boolean).sort().at(-1);
  const sourceError = radar.error || ladder.error || speed.error;
  const manualRefresh = async () => {
    setRefreshing(true);
    await Promise.all([radar.refresh(), ladder.refresh(), speed.refresh()]);
    setRefreshing(false);
  };

  const ladderSummary = ladder.data?.counts;
  const speedCoverage = speed.data?.coverage;
  const radarCoverage = radar.data?.coverage;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border/80 bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground"><Activity /></div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold tracking-tight sm:text-lg">等风盘中 · 异动与晋级监控</h1>
              <p className="truncate text-xs text-muted-foreground">板块驱动、连板梯队与打板涨速一屏联动</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="hidden gap-1.5 sm:inline-flex"><span className={`size-1.5 rounded-full ${sourceError ? 'bg-amber-500' : 'bg-emerald-500'}`} />{sourceError ? '部分异常' : '监控中'} {fmtTime(latestAt)}</Badge>
            <Button variant="outline" size="sm" onClick={() => void manualRefresh()} aria-label="刷新盘中数据">
              <RefreshCw className={refreshing ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">刷新</span>
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] space-y-4 px-4 py-4 sm:px-6 sm:py-6">
        {sourceError && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <span>部分数据暂时不可用，页面保留最近一次成功结果：{sourceError}</span>
          </div>
        )}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="数据状态">
          <Card size="sm"><CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4 text-emerald-500" />概念板块</CardTitle><CardAction><StateBadge state={radar.data?.status} /></CardAction><CardDescription>{radarCoverage ? `${radarCoverage.available}/${radarCoverage.reported}板块` : '正在连接'} · 15秒刷新</CardDescription></CardHeader></Card>
          <Card size="sm"><CardHeader><CardTitle className="flex items-center gap-2"><Layers3 className="size-4 text-sky-500" />驱动成分</CardTitle><CardAction><StateBadge state={selectedEvent?.driverState} label={selectedEvent?.windowReady ? '3分钟就绪' : '预热中'} /></CardAction><CardDescription>{selectedEvent ? `${selectedEvent.directionalCount ?? 0}/${selectedEvent.memberCount ?? 0}只同向` : '等待板块异动'} · 贡献可追溯</CardDescription></CardHeader></Card>
          <Card size="sm"><CardHeader><CardTitle className="flex items-center gap-2"><Swords className="size-4 text-amber-500" />连板梯队</CardTitle><CardAction><StateBadge state={ladder.data?.status} /></CardAction><CardDescription>{ladderSummary ? `昨日${ladderSummary.previousLimitUp} · 今封${ladderSummary.todaySealed} · 炸${ladderSummary.todayFailed}` : '正在连接'} · 30秒刷新</CardDescription></CardHeader></Card>
          <Card size="sm"><CardHeader><CardTitle className="flex items-center gap-2"><Zap className="size-4 text-rose-500" />涨速样本</CardTitle><CardAction><StateBadge state={speed.data?.status} /></CardAction><CardDescription>{speedCoverage ? `概念${speedCoverage.conceptReady}/${speedCoverage.requested} · 涨停史${speedCoverage.recentLimitReady}/${speedCoverage.requested}` : '正在连接'} · 5秒刷新</CardDescription></CardHeader></Card>
        </section>

        <Tabs defaultValue="radar" className="gap-4">
          <TabsList variant="line" className="max-w-full overflow-x-auto">
            <TabsTrigger value="radar"><Activity />板块异动</TabsTrigger>
            <TabsTrigger value="promotion"><TrendingUp />连板晋级</TabsTrigger>
            <TabsTrigger value="competition"><Swords />梯队竞争</TabsTrigger>
            <TabsTrigger value="speed"><Zap />涨速榜</TabsTrigger>
          </TabsList>

          <TabsContent value="radar" className="space-y-4">
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

                {selectedEvent && (
                  <Card>
                    <CardHeader>
                      <CardTitle>{selectedEvent.name} · 主要驱动个股</CardTitle>
                      <CardDescription>{selectedEvent.driverBasis}</CardDescription>
                      <CardAction><StateBadge state={selectedEvent.driverState} label={selectedEvent.windowReady ? '同窗口归因' : '当前资金代理'} /></CardAction>
                    </CardHeader>
                    <CardContent>
                      {selectedEvent.drivers.length ? <Table><TableHeader><TableRow><TableHead>个股</TableHead><TableHead>行业</TableHead><TableHead className="text-right">窗口涨跌</TableHead><TableHead className="text-right">资金增量/代理</TableHead><TableHead className="text-right">贡献</TableHead></TableRow></TableHeader><TableBody>{selectedEvent.drivers.map((driver) => <TableRow key={driver.code}><TableCell><div className="font-medium">{driver.name}</div><div className="text-xs text-muted-foreground">{driver.code}</div></TableCell><TableCell>{driver.industry || '未知'}</TableCell><TableCell className={`text-right ${selectedEvent.direction === 'up' ? 'market-up' : 'market-down'}`}>{fmtPct(driver.changePct)}</TableCell><TableCell className={`text-right ${selectedEvent.direction === 'up' ? 'market-up' : 'market-down'}`}>{fmtMoney(driver.mainNetInflow)}</TableCell><TableCell className="text-right">{fmtPct(driver.contributionPct ?? null, 1)}</TableCell></TableRow>)}</TableBody></Table> : <EmptyState>成分股资金字段暂时缺失</EmptyState>}
                    </CardContent>
                  </Card>
                )}
              </>
            )}
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
              <CardHeader><CardTitle>涨速榜 · 打板观察</CardTitle><CardDescription>涨速只做触发器；同时展示当前涨幅、概念、板制距离与近20个交易日涨停次数</CardDescription><CardAction><div className="flex items-center gap-1 text-xs text-muted-foreground"><Clock3 className="size-3.5" />5秒刷新</div></CardAction></CardHeader>
              <CardContent>{speed.data?.rows?.length ? <Table><TableHeader><TableRow><TableHead>#</TableHead><TableHead>个股</TableHead><TableHead className="text-right">涨速</TableHead><TableHead className="text-right">涨幅</TableHead><TableHead>核心概念</TableHead><TableHead>近20日涨停</TableHead><TableHead className="text-right">距名义涨停</TableHead><TableHead>状态</TableHead></TableRow></TableHeader><TableBody>{speed.data.rows.map((row, index) => <TableRow key={row.code}><TableCell className="text-muted-foreground">{index + 1}</TableCell><TableCell><div className="font-medium">{row.name}</div><div className="text-xs text-muted-foreground">{row.code} · {row.limitPct}%板</div></TableCell><TableCell className={`text-right font-medium ${(row.speedPct ?? 0) >= 0 ? 'market-up' : 'market-down'}`}>{fmtPct(row.speedPct)}</TableCell><TableCell className={`text-right ${(row.changePct ?? 0) >= 0 ? 'market-up' : 'market-down'}`}>{fmtPct(row.changePct)}</TableCell><TableCell><div className="flex min-w-[210px] flex-wrap gap-1">{row.concepts.length ? row.concepts.map((concept) => <Badge key={concept} variant="secondary">{concept}</Badge>) : <StateBadge state="MISSING" label="概念缺失" />}</div></TableCell><TableCell><span className="font-medium">{row.recentLimitCount ?? '—'}次</span><span className="ml-1 text-xs text-muted-foreground">/{row.recentLimitSessions}日</span></TableCell><TableCell className="text-right">{fmtPct(row.distanceToLimitPct)}</TableCell><TableCell><Badge variant="outline">{row.status}</Badge></TableCell></TableRow>)}</TableBody></Table> : <EmptyState>{speed.loading ? '正在补齐涨速票概念与近期涨停历史…' : speed.data?.reason || speed.error || '当前没有涨速样本'}</EmptyState>}</CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}
