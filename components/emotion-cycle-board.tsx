'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Flame,
  Info,
  Radio,
  Snowflake,
  Target,
  ThermometerSun,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import type {
  CloseHistoryDocument,
  CloseSnapshot,
  CloseStock,
  IntradayEmotionSnapshot,
} from '@/lib/close-history';
import { cn } from '@/lib/utils';

function dateLabel(value: string, withWeekday = true) {
  return format(parseISO(value), withWeekday ? 'M月d日 EEE' : 'M月d日', {
    locale: zhCN,
  });
}

function fmtPct(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value))
    return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

function fmtTurnover(value: number) {
  return value > 0 ? `${(value / 1_000_000_000_000).toFixed(2)}万亿` : '—';
}

function fmtTradeDate(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits.length === 8
    ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
    : value;
}

function tone(value: string) {
  if (['强势', '偏强', '高潮', '主升确认', '弱转强'].includes(value))
    return 'text-red-400';
  if (['弱势', '偏弱', '退潮', '退潮释放', '强分歧'].includes(value))
    return 'text-emerald-400';
  return 'text-amber-300';
}

export function CloseDatePicker({
  value,
  onChange,
  history,
  compact = false,
}: {
  value: string;
  onChange: (date: string) => void;
  history: CloseHistoryDocument;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const dates = useMemo(
    () => history.snapshots.map((snapshot) => snapshot.date),
    [history.snapshots],
  );
  const available = useMemo(() => new Set(dates), [dates]);
  const selected = value ? parseISO(value) : undefined;
  const firstDate = dates[0] ?? value;
  const lastDate = dates.at(-1) ?? value;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label="选择15点收盘定格日期"
        className={cn(
          buttonVariants({
            variant: 'outline',
            size: compact ? 'sm' : 'default',
          }),
          'font-normal',
        )}
      >
        <CalendarDays />
        <span className={compact ? 'hidden md:inline' : undefined}>
          {value ? dateLabel(value) : '选择日期'}
        </span>
        <Badge
          variant="secondary"
          className={compact ? 'hidden lg:inline-flex' : undefined}
        >
          15:00
        </Badge>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-2">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          startMonth={firstDate ? parseISO(firstDate) : undefined}
          endMonth={lastDate ? parseISO(lastDate) : undefined}
          locale={zhCN}
          disabled={(day) => !available.has(format(day, 'yyyy-MM-dd'))}
          onSelect={(day) => {
            if (!day) return;
            const next = format(day, 'yyyy-MM-dd');
            if (!available.has(next)) return;
            onChange(next);
            setOpen(false);
          }}
        />
        <p className="border-t px-2 pt-2 text-xs text-muted-foreground">
          只有已归档的交易日可选；无收盘包的日期不会用实时数据代替。
        </p>
      </PopoverContent>
    </Popover>
  );
}

function SnapshotCell({
  selected,
  children,
  className,
}: {
  selected: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'min-w-0 border-r border-b border-slate-800 px-2 py-2 text-center text-xs',
        selected &&
          'bg-sky-500/10 shadow-[inset_2px_0_0_rgb(56_189_248),inset_-2px_0_0_rgb(56_189_248)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

function MatrixRow({
  label,
  snapshots,
  selectedDate,
  render,
  className,
}: {
  label: string;
  snapshots: CloseSnapshot[];
  selectedDate: string;
  render: (snapshot: CloseSnapshot) => React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className="grid min-w-max"
      style={{
        gridTemplateColumns: `112px repeat(${snapshots.length}, 164px)`,
      }}
    >
      <div
        className={cn(
          'sticky left-0 z-10 flex items-center border-r border-b border-slate-700 bg-slate-950 px-3 py-2 text-xs font-medium text-slate-400',
          className,
        )}
      >
        {label}
      </div>
      {snapshots.map((snapshot) => (
        <SnapshotCell
          key={snapshot.date}
          selected={snapshot.date === selectedDate}
          className={className}
        >
          {render(snapshot)}
        </SnapshotCell>
      ))}
    </div>
  );
}

function StockList({
  stocks,
  empty = '—',
}: {
  stocks: CloseStock[];
  empty?: string;
}) {
  if (!stocks.length)
    return <span className="text-muted-foreground">{empty}</span>;
  return (
    <div className="grid gap-1.5">
      {stocks.map((stock) => (
        <div
          key={stock.code}
          className="flex items-center justify-between gap-3 rounded-md bg-muted/60 px-2.5 py-2 text-xs"
        >
          <span className="min-w-0">
            <span className="font-medium">{stock.name}</span>
            <span className="ml-1 text-muted-foreground">{stock.industry}</span>
          </span>
          <span
            className={cn(
              'shrink-0 font-mono font-medium',
              (stock.changePct ?? 0) >= 0 ? 'market-up' : 'market-down',
            )}
          >
            {fmtPct(stock.changePct)}
          </span>
        </div>
      ))}
    </div>
  );
}

function ChangeHint({
  value,
  digits = 0,
  inverse = false,
}: {
  value: number | null;
  digits?: number;
  inverse?: boolean;
}) {
  if (value === null)
    return (
      <span className="text-[10px] text-muted-foreground">等待下次刷新</span>
    );
  if (Math.abs(value) < 10 ** -digits / 2)
    return (
      <span className="text-[10px] text-muted-foreground">较上次持平</span>
    );
  const favorable = inverse ? value < 0 : value > 0;
  return (
    <span
      className={cn(
        'text-[10px] font-medium',
        favorable ? 'market-up' : 'market-down',
      )}
    >
      较上次 {value > 0 ? '+' : ''}
      {value.toFixed(digits)}
    </span>
  );
}

export function IntradayEmotionBoard({
  snapshot,
  loading,
  error,
}: {
  snapshot: IntradayEmotionSnapshot | null;
  loading: boolean;
  error: string | null;
}) {
  const previousRef = useRef<IntradayEmotionSnapshot | null>(null);
  const [previous, setPrevious] = useState<IntradayEmotionSnapshot | null>(
    null,
  );

  useEffect(() => {
    if (!snapshot) return;
    const before = previousRef.current;
    if (
      before &&
      before.tradeDate === snapshot.tradeDate &&
      before.cutoff !== snapshot.cutoff
    )
      setPrevious(before);
    previousRef.current = snapshot;
  }, [snapshot]);

  if (!snapshot)
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          {loading ? '正在读取盘中情绪…' : error || '盘中情绪暂无数据'}
        </CardContent>
      </Card>
    );

  const isLive = snapshot.sessionState === 'LIVE';
  const diff = (key: 'limitUp' | 'failed' | 'limitDown') =>
    previous ? snapshot[key] - previous[key] : null;
  const sealDiff = previous ? snapshot.sealRate - previous.sealRate : null;
  const medianDiff =
    previous &&
    snapshot.breadth.medianChangePct !== null &&
    previous.breadth.medianChangePct !== null
      ? snapshot.breadth.medianChangePct - previous.breadth.medianChangePct
      : null;

  return (
    <Card className="border-rose-500/25 bg-gradient-to-br from-rose-500/[0.045] via-card to-amber-500/[0.035]">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Radio
                className={cn(
                  'size-5 text-rose-500',
                  isLive && 'animate-pulse',
                )}
              />
              盘中动态情绪
            </CardTitle>
            <CardDescription className="mt-1">
              交易时间30秒检查一次；收盘后定格在最近交易日15:00，不会冒充实时数据。
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={
                snapshot.status === 'READY'
                  ? 'status-ready'
                  : snapshot.status === 'DEGRADED'
                    ? 'status-degraded'
                    : undefined
              }
            >
              {isLive ? '盘中实时' : '休市定格'}
            </Badge>
            <Badge variant="secondary" className="gap-1 font-mono">
              <Clock3 className="size-3" />
              {fmtTradeDate(snapshot.tradeDate)} {snapshot.cutoff}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <div className="rounded-lg border bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">涨停 / 跌停</p>
            <p className="mt-1 text-lg font-semibold">
              <span className="market-up">{snapshot.limitUp}</span>
              <span className="mx-1 text-muted-foreground">/</span>
              <span className="market-down">{snapshot.limitDown}</span>
            </p>
            <ChangeHint value={diff('limitUp')} />
          </div>
          <div className="rounded-lg border bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">炸板 / 封板率</p>
            <p className="mt-1 text-lg font-semibold">
              {snapshot.failed} / {snapshot.sealRate.toFixed(1)}%
            </p>
            <ChangeHint value={sealDiff} digits={1} />
          </div>
          <div className="rounded-lg border bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">最高板 / 连板家数</p>
            <p className="mt-1 text-lg font-semibold">
              {snapshot.highestBoard}板 / {snapshot.consecutiveCount}家
            </p>
            <p className="truncate text-[10px] text-amber-600 dark:text-amber-300">
              {snapshot.leaders.join(' · ') || '暂无高标'}
            </p>
          </div>
          <div className="rounded-lg border bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">上涨 / 下跌家数</p>
            <p className="mt-1 text-lg font-semibold">
              <span className="market-up">{snapshot.breadth.up}</span>
              <span className="mx-1 text-muted-foreground">/</span>
              <span className="market-down">{snapshot.breadth.down}</span>
            </p>
            <p className="text-[10px] text-muted-foreground">
              覆盖 {snapshot.breadth.rowsAvailable}只
            </p>
          </div>
          <div className="rounded-lg border bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">全A中位数</p>
            <p
              className={cn(
                'mt-1 text-lg font-semibold',
                (snapshot.breadth.medianChangePct ?? 0) >= 0
                  ? 'market-up'
                  : 'market-down',
              )}
            >
              {fmtPct(snapshot.breadth.medianChangePct)}
            </p>
            <ChangeHint value={medianDiff} digits={2} />
          </div>
          <div className="rounded-lg border bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">指数 / 短线情绪</p>
            <p className="mt-1 text-sm font-semibold">
              <span className={tone(snapshot.indexMood)}>
                {snapshot.indexMood}
              </span>
              <span className="mx-1 text-muted-foreground">/</span>
              <span className={tone(snapshot.shortMood)}>
                {snapshot.shortMood}
              </span>
            </p>
            <p className="text-[10px] text-muted-foreground">
              规则计算，非主观填写
            </p>
          </div>
          <div className="rounded-lg border bg-background/70 p-3">
            <p className="text-xs text-muted-foreground">当前周期节点</p>
            <p
              className={cn(
                'mt-1 text-lg font-semibold',
                tone(snapshot.cycleNode),
              )}
            >
              {snapshot.cycleNode}
            </p>
            <p className="truncate text-[10px] text-sky-600 dark:text-sky-300">
              {snapshot.concentratedIndustries
                .slice(0, 2)
                .map((item) => `${item.name}${item.count}`)
                .join(' · ') || '涨停集中度暂不可用'}
            </p>
          </div>
        </div>
        {(snapshot.reason || error) && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/[0.08] px-3 py-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
            {snapshot.reason || error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function EmotionCycleBoard({
  selectedDate,
  onDateChange,
  history,
}: {
  selectedDate: string;
  onDateChange: (date: string) => void;
  history: CloseHistoryDocument;
}) {
  const snapshots = history.snapshots;
  const requestedIndex = snapshots.findIndex(
    (snapshot) => snapshot.date === selectedDate,
  );
  const selectedIndex =
    requestedIndex >= 0 ? requestedIndex : Math.max(0, snapshots.length - 1);
  const selected = snapshots[selectedIndex] ?? snapshots.at(-1);
  const matrixScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scroller = matrixScrollRef.current;
    if (!scroller || !snapshots.length) return;
    const selectedCenter = 112 + selectedIndex * 164 + 82;
    const target = Math.max(0, selectedCenter - scroller.clientWidth / 2);
    const frame = window.requestAnimationFrame(() => {
      scroller.scrollTo({ left: target, behavior: 'smooth' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedIndex, snapshots.length]);

  if (!selected) return null;
  const maxHeight = Math.max(
    ...snapshots.map((snapshot) => snapshot.highestBoard),
  );
  const heights = Array.from(
    { length: maxHeight },
    (_, index) => maxHeight - index,
  );
  const previous = snapshots[selectedIndex - 1];
  const next = snapshots[selectedIndex + 1];
  const selectedRatio =
    selected.breadth.rowsAvailable > 0
      ? (selected.breadth.up / selected.breadth.rowsAvailable) * 100
      : 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ThermometerSun className="size-5 text-amber-500" />
                情绪周期 · 15:00收盘定格
              </CardTitle>
              <CardDescription className="mt-1">
                按交易日对比情绪、炸板率、高度与个股梯队；新交易日收盘后自动追加，不再随部署写死。
              </CardDescription>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                disabled={!previous}
                onClick={() => previous && onDateChange(previous.date)}
                aria-label="上一个有收盘快照的交易日"
              >
                <ChevronLeft />
              </Button>
              <CloseDatePicker
                value={selected.date}
                onChange={onDateChange}
                history={history}
              />
              <Button
                variant="outline"
                size="icon"
                disabled={!next}
                onClick={() => next && onDateChange(next.date)}
                aria-label="下一个有收盘快照的交易日"
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">收盘快照</p>
              <p className="mt-1 font-semibold">
                {dateLabel(selected.date)} 15:00
              </p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">涨停 / 跌停</p>
              <p className="mt-1 font-semibold">
                <span className="market-up">{selected.limitUp}</span> /{' '}
                <span className="market-down">{selected.limitDown}</span>
              </p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">炸板 / 封板率</p>
              <p className="mt-1 font-semibold">
                {selected.failed} / {selected.sealRate.toFixed(1)}%
              </p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">最高板 / 连板家数</p>
              <p className="mt-1 font-semibold">
                {selected.highestBoard}板 / {selected.consecutiveCount}家
              </p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">上涨家数 / 占比</p>
              <p className="mt-1 font-semibold market-up">
                {selected.breadth.up} / {selectedRatio.toFixed(1)}%
              </p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">全A中位数</p>
              <p
                className={cn(
                  'mt-1 font-semibold',
                  selected.breadth.medianChangePct >= 0
                    ? 'market-up'
                    : 'market-down',
                )}
              >
                {fmtPct(selected.breadth.medianChangePct)}
              </p>
            </div>
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">两市成交额</p>
              <p className="mt-1 font-semibold">
                {fmtTurnover(selected.turnover)}
              </p>
            </div>
          </div>

          <div
            className="rounded-xl border border-slate-700 bg-slate-950 text-slate-100"
            aria-label="近期收盘情绪周期矩阵"
          >
            <div ref={matrixScrollRef} className="overflow-x-auto">
              <div
                className="grid min-w-max"
                style={{
                  gridTemplateColumns: `112px repeat(${snapshots.length}, 164px)`,
                }}
              >
                <div className="sticky left-0 z-20 flex items-center border-r border-b border-slate-700 bg-slate-950 px-3 py-3 text-xs font-semibold text-slate-300">
                  日期
                </div>
                {snapshots.map((snapshot) => (
                  <button
                    type="button"
                    key={snapshot.date}
                    onClick={() => onDateChange(snapshot.date)}
                    aria-pressed={snapshot.date === selected.date}
                    className={cn(
                      'border-r border-b border-slate-800 px-2 py-2 text-center transition-colors hover:bg-slate-800',
                      snapshot.date === selected.date &&
                        'bg-sky-500/15 text-sky-200 shadow-[inset_2px_0_0_rgb(56_189_248),inset_-2px_0_0_rgb(56_189_248)]',
                    )}
                  >
                    <span className="block font-semibold">
                      {dateLabel(snapshot.date, false)}
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {format(parseISO(snapshot.date), 'EEE', { locale: zhCN })}{' '}
                      · 15:00
                    </span>
                  </button>
                ))}
              </div>
              <MatrixRow
                label="指数情绪"
                snapshots={snapshots}
                selectedDate={selected.date}
                render={(snapshot) => (
                  <span
                    className={cn('font-semibold', tone(snapshot.indexMood))}
                  >
                    {snapshot.indexMood}
                  </span>
                )}
              />
              <MatrixRow
                label="短线情绪"
                snapshots={snapshots}
                selectedDate={selected.date}
                render={(snapshot) => (
                  <span
                    className={cn('font-semibold', tone(snapshot.shortMood))}
                  >
                    {snapshot.shortMood}
                  </span>
                )}
              />
              <MatrixRow
                label="规则节点"
                snapshots={snapshots}
                selectedDate={selected.date}
                render={(snapshot) => (
                  <span
                    className={cn('font-semibold', tone(snapshot.cycleNode))}
                  >
                    {snapshot.cycleNode}
                  </span>
                )}
              />
              <MatrixRow
                label="涨停 / 跌停"
                snapshots={snapshots}
                selectedDate={selected.date}
                render={(snapshot) => (
                  <>
                    <span className="font-mono font-semibold text-red-400">
                      {snapshot.limitUp}
                    </span>
                    <span className="text-slate-600"> / </span>
                    <span className="font-mono font-semibold text-emerald-400">
                      {snapshot.limitDown}
                    </span>
                  </>
                )}
              />
              <MatrixRow
                label="炸板"
                snapshots={snapshots}
                selectedDate={selected.date}
                render={(snapshot) => (
                  <span className="font-mono font-semibold text-amber-300">
                    {snapshot.failed}
                  </span>
                )}
              />
              <MatrixRow
                label="封板率"
                snapshots={snapshots}
                selectedDate={selected.date}
                render={(snapshot) => (
                  <span
                    className={cn(
                      'font-mono font-semibold',
                      snapshot.sealRate >= 75
                        ? 'text-red-400'
                        : snapshot.sealRate < 60
                          ? 'text-emerald-400'
                          : 'text-amber-300',
                    )}
                  >
                    {snapshot.sealRate.toFixed(1)}%
                  </span>
                )}
              />
              <MatrixRow
                label="最高板"
                snapshots={snapshots}
                selectedDate={selected.date}
                render={(snapshot) => (
                  <span className="font-mono font-semibold text-amber-300">
                    {snapshot.highestBoard}板
                  </span>
                )}
              />
              <MatrixRow
                label="连板家数"
                snapshots={snapshots}
                selectedDate={selected.date}
                render={(snapshot) => (
                  <span className="font-mono font-semibold">
                    {snapshot.consecutiveCount}
                  </span>
                )}
              />
              <MatrixRow
                label="高标核心"
                snapshots={snapshots}
                selectedDate={selected.date}
                render={(snapshot) => (
                  <span className="font-medium text-amber-200">
                    {snapshot.leaders.join(' · ') || '—'}
                  </span>
                )}
              />
              <MatrixRow
                label="涨停集中行业"
                snapshots={snapshots}
                selectedDate={selected.date}
                render={(snapshot) => (
                  <span className="text-sky-300">
                    {snapshot.concentratedIndustries
                      .slice(0, 2)
                      .map((item) => `${item.name}${item.count}`)
                      .join(' · ') || '—'}
                  </span>
                )}
              />
              {heights.map((height) => (
                <MatrixRow
                  key={height}
                  label={`${height}板`}
                  snapshots={snapshots}
                  selectedDate={selected.date}
                  className={height >= 2 ? 'min-h-14' : 'min-h-20'}
                  render={(snapshot) => {
                    const stocks =
                      snapshot.ladders.find((row) => row.height === height)
                        ?.stocks ?? [];
                    const visible = stocks.slice(0, height === 1 ? 4 : 7);
                    return stocks.length ? (
                      <div className="space-y-1 text-left leading-4 text-rose-300">
                        {visible.map((stock) => (
                          <div
                            key={stock.code}
                            className="truncate"
                            title={`${stock.name} ${stock.industry} ${fmtPct(stock.changePct)}`}
                          >
                            {stock.name}
                          </div>
                        ))}
                        {stocks.length > visible.length ? (
                          <div className="text-[10px] text-slate-500">
                            +还有{stocks.length - visible.length}
                            只，点日期看全部
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-slate-700">—</span>
                    );
                  }}
                />
              ))}
            </div>
            <div className="flex items-start gap-2 px-3 py-2 text-[11px] leading-5 text-slate-400">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              矩阵只做跨日缩略对比；1板数量较多时会折叠，下方的当日详情会展示全部股票。
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-500/25 bg-sky-500/[0.06] px-3 py-2 text-xs text-muted-foreground">
            <Info className="size-4 shrink-0 text-sky-600" />
            <Badge
              variant="outline"
              className={
                history.archive?.state === 'DEGRADED'
                  ? 'status-degraded'
                  : 'status-ready'
              }
            >
              {history.archive?.mode === 'DYNAMIC' ? '自动归档' : '本地历史'}
            </Badge>
            <span>
              {history.archive?.message}。{history.methodology.facts}{' '}
              {history.methodology.labels}
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="size-5 text-rose-500" />
              {dateLabel(selected.date)} · 完整高度梯队
            </CardTitle>
            <CardDescription>
              共{selected.limitUp}
              只收盘涨停，一板也不省略；时间为首次触板，涨幅为15:00收盘值。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {selected.ladders.map((ladder) => (
              <div
                key={ladder.height}
                className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[90px_minmax(0,1fr)]"
              >
                <div>
                  <Badge
                    variant="outline"
                    className={
                      ladder.height === selected.highestBoard
                        ? 'border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                        : undefined
                    }
                  >
                    {ladder.height}板 · {ladder.stocks.length}只
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  {ladder.stocks.map((stock) => (
                    <div
                      key={stock.code}
                      className="rounded-md bg-muted/60 px-2.5 py-1.5 text-xs"
                      title={`${stock.code} · ${stock.industry} · 开板${stock.breakCount}次`}
                    >
                      <span className="font-medium">{stock.name}</span>
                      <span className="ml-1.5 font-mono market-up">
                        {fmtPct(stock.changePct)}
                      </span>
                      {stock.firstTouch ? (
                        <span className="ml-1.5 text-muted-foreground">
                          {stock.firstTouch}
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Flame className="size-5 text-red-500" />
                当日盘面摘要
              </CardTitle>
              <CardDescription>
                {selected.source} · 覆盖{selected.coverage.available}/
                {selected.coverage.reported}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">指数情绪</span>
                <span className={cn('font-semibold', tone(selected.indexMood))}>
                  {selected.indexMood}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">短线情绪</span>
                <span className={cn('font-semibold', tone(selected.shortMood))}>
                  {selected.shortMood}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">规则周期节点</span>
                <span className={cn('font-semibold', tone(selected.cycleNode))}>
                  {selected.cycleNode}
                </span>
              </div>
              <div className="border-t pt-3">
                <p className="mb-2 text-xs text-muted-foreground">
                  主要涨停集中行业
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {selected.concentratedIndustries.map((item) => (
                    <Badge key={item.name} variant="secondary">
                      {item.name} · {item.count}只
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="border-t pt-3">
                <p className="mb-2 text-xs text-muted-foreground">
                  三大指数15:00
                </p>
                <div className="grid gap-1.5">
                  {selected.indices.map((index) => (
                    <div
                      key={index.code}
                      className="flex items-center justify-between"
                    >
                      <span>
                        {index.name}
                        <span className="ml-1 text-xs text-muted-foreground">
                          {index.close?.toFixed(2) ?? '未入档'}
                        </span>
                      </span>
                      <span
                        className={cn(
                          'font-mono',
                          index.changePct === null
                            ? 'text-muted-foreground'
                            : index.changePct >= 0
                              ? 'market-up'
                              : 'market-down',
                        )}
                      >
                        {fmtPct(index.changePct)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Snowflake className="size-5 text-emerald-500" />
                炸板与跌停
              </CardTitle>
              <CardDescription>
                强势梯队之外的负反馈也同步保留。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="mb-2 text-xs font-medium">
                  炸板 {selected.failedStocks.length}只
                </p>
                <div className="max-h-72 overflow-y-auto pr-1">
                  <StockList stocks={selected.failedStocks} empty="当无炸板" />
                </div>
              </div>
              <div className="border-t pt-3">
                <p className="mb-2 text-xs font-medium">
                  跌停 {selected.limitDownStocks.length}只
                </p>
                <div className="max-h-72 overflow-y-auto pr-1">
                  <StockList
                    stocks={selected.limitDownStocks}
                    empty="当无跌停"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
