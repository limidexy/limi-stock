'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarClock, Info, RefreshCw, ShieldAlert, ShieldCheck, Trophy } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import tradingCalendar from '@/lib/trading-calendar.generated.json';
import {
  assertPayload,
  parseSnapshotIndex,
  REMOTE_URL,
  SNAPSHOT_INDEX_URL,
  snapshotUrl,
  type SnapshotIndex,
  type SourceKind,
} from '@/lib/rankings-source';
import {
  formatAge,
  formatDate,
  verifyRankings,
  WINDOW_KEYS,
  type BoardView,
  type DataState,
} from '@/lib/ranking-verification';

/**
 * 本地权威交易日历（腾讯上证指数与深证成指日线日期交集）。
 * 只用于校验目标日与「向前第 N 个交易日」，不参与涨幅计算。
 */
const CALENDAR_DATES: string[] = tradingCalendar.dates;
const CALENDAR_LAST = CALENDAR_DATES[CALENDAR_DATES.length - 1] ?? '';

/** 页面重新可见时，距上次请求超过该毫秒数才重新拉取（仅对外部接口）。 */
const REFETCH_AFTER_MS = 5 * 60 * 1000;

function formatPct(value: number | null | undefined, digits = 2) {
  return value == null || !Number.isFinite(value)
    ? '—'
    : `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

function formatLargeNumber(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 100_000_000) {
    return `${(value / 100_000_000).toFixed(2)}亿`;
  }
  if (Math.abs(value) >= 10_000) {
    return `${(value / 10_000).toFixed(1)}万`;
  }
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}

function statusClass(status: DataState) {
  if (status === 'READY') return 'status-ready';
  if (status === 'DEGRADED') return 'status-degraded';
  return 'status-missing';
}

function StatusBadge({ status }: { status: DataState }) {
  const Icon = status === 'READY' ? ShieldCheck : ShieldAlert;
  return (
    <Badge variant="outline" className={statusClass(status)}>
      <Icon />
      {status}
    </Badge>
  );
}

export function MultiWindowRankingsBoard() {
  const [index, setIndex] = useState<SnapshotIndex | null>(null);
  const [indexReady, setIndexReady] = useState(false);
  const [sourceKind, setSourceKind] = useState<SourceKind | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [view, setView] = useState<BoardView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** 递增即重新拉取当前数据源，避免在 effect 里直接调用加载函数。 */
  const [reloadToken, setReloadToken] = useState(0);
  const lastFetchedAt = useRef(0);
  /** 请求序号：快速切换日期时丢弃过期响应，避免旧日期覆盖新日期。 */
  const requestSeq = useRef(0);

  const loadSnapshot = useCallback(
    async (date: string, historical: boolean) => {
      const token = (requestSeq.current += 1);
      setLoading(true);
      try {
        const response = await fetch(snapshotUrl(date), { cache: 'no-cache' });
        if (response.status === 404) {
          throw new Error(`交易日 ${formatDate(date)} 没有已生成的快照`);
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = assertPayload(await response.json());
        if (payload.tradeDate !== date) {
          // 文件内容与文件名不符：宁可报错，也不把别的交易日当成这一天。
          throw new Error(
            `快照内容为 ${formatDate(payload.tradeDate)}，与所选 ${formatDate(date)} 不符`,
          );
        }
        if (token !== requestSeq.current) return;
        setView(
          verifyRankings(payload, CALENDAR_DATES, new Date(), { historical }),
        );
        setError(null);
        lastFetchedAt.current = Date.now();
      } catch (reason) {
        if (token !== requestSeq.current) return;
        // 失败即清空，避免用别的交易日或旧结果顶替。
        setView(null);
        setError(reason instanceof Error ? reason.message : '快照读取失败');
      } finally {
        if (token === requestSeq.current) setLoading(false);
      }
    },
    [],
  );

  const loadRemote = useCallback(async () => {
    const token = (requestSeq.current += 1);
    setLoading(true);
    try {
      const response = await fetch(REMOTE_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = assertPayload(await response.json());
      if (token !== requestSeq.current) return;
      setView(verifyRankings(payload, CALENDAR_DATES, new Date()));
      setError(null);
      lastFetchedAt.current = Date.now();
    } catch (reason) {
      if (token !== requestSeq.current) return;
      setView(null);
      setError(reason instanceof Error ? reason.message : '排行接口不可用');
    } finally {
      if (token === requestSeq.current) setLoading(false);
    }
  }, []);

  // 一、优先载入本地快照索引；没有快照时才退回外部接口。
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(SNAPSHOT_INDEX_URL, {
            cache: 'no-cache',
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const parsed = parseSnapshotIndex(await response.json());
          if (!parsed) throw new Error('索引为空');
          setIndex(parsed);
          setSourceKind('snapshot');
          setSelectedDate(parsed.latest);
        } catch {
          setIndex(null);
          setSourceKind('remote');
        } finally {
          setIndexReady(true);
        }
      })();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // 二、按所选交易日读取快照。
  useEffect(() => {
    if (sourceKind !== 'snapshot' || !selectedDate || !index) return;
    const historical = selectedDate !== index.latest;
    const timer = window.setTimeout(
      () => void loadSnapshot(selectedDate, historical),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [sourceKind, selectedDate, index, reloadToken, loadSnapshot]);

  // 三、外部接口模式：拉取当前榜，并在页面重新可见时按需刷新。
  useEffect(() => {
    if (sourceKind !== 'remote') return;
    const timer = window.setTimeout(() => void loadRemote(), 0);
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastFetchedAt.current < REFETCH_AFTER_MS) return;
      setReloadToken((value) => value + 1);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [sourceKind, reloadToken, loadRemote]);

  const exactCoverage = (() => {
    if (!view?.coverage?.activeUniverse) return null;
    return (view.coverage.exactLatest / view.coverage.activeUniverse) * 100;
  })();

  const showTables = view != null && view.status !== 'MISSING';
  const busy = loading || !indexReady;

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <header className="flex flex-col gap-4 border-b px-4 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">
              <Trophy />
              跨周期强度
            </Badge>
            <StatusBadge status={view?.status ?? 'MISSING'} />
            {view?.historical ? (
              <Badge variant="outline">
                <CalendarClock />
                历史回看
              </Badge>
            ) : null}
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight">
              5 / 10 / 20 / 30 日区间涨幅 Top30
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
              N 日涨幅 = 目标日复权收盘 ÷ 向前第 N 个交易日复权收盘 − 1。
              起点由权威交易日历定位，目标日必须精确匹配并与独立收盘行情交叉核验；
              窗口长度不符、停牌导致起点偏移、日期陈旧的股票不会进入排行。
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setReloadToken((value) => value + 1)}
          disabled={busy}
          className="self-start"
        >
          <RefreshCw className={busy ? 'animate-spin' : ''} />
          {busy ? '读取中' : '刷新'}
        </Button>
      </header>

      {index ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3 text-xs sm:px-6">
          <label htmlFor="ranking-date" className="text-muted-foreground">
            交易日
          </label>
          <select
            id="ranking-date"
            value={selectedDate ?? ''}
            onChange={(event) => setSelectedDate(event.target.value)}
            disabled={busy}
            className="h-8 rounded-md border bg-background px-2 font-mono text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
          >
            {index.dates.map((date) => (
              <option key={date} value={date}>
                {formatDate(date)}
                {date === index.latest ? '（最新）' : ''}
              </option>
            ))}
          </select>
          <span className="text-muted-foreground">
            共 {index.dates.length} 个交易日快照
            {index.generatedAt
              ? ` · 索引更新于 ${new Date(index.generatedAt).toLocaleString('zh-CN', { hour12: false })}`
              : ''}
          </span>
          <span className="text-muted-foreground">
            历史日期读本地快照，不回退到其他交易日。
          </span>
        </div>
      ) : null}

      {view ? (
        <div className="grid grid-cols-2 border-b sm:grid-cols-4">
          <div className="border-r border-b p-4 sm:border-b-0">
            <p className="text-xs text-muted-foreground">目标交易日</p>
            <p className="mt-1 font-medium">{formatDate(view.tradeDate)}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              日历锚点 {formatDate(CALENDAR_LAST)}
            </p>
          </div>
          <div className="border-b p-4 sm:border-r sm:border-b-0">
            <p className="text-xs text-muted-foreground">活跃股票池</p>
            <p className="mt-1 font-medium">
              {view.coverage.activeUniverse.toLocaleString('zh-CN')} 只
            </p>
          </div>
          <div className="border-r p-4">
            <p className="text-xs text-muted-foreground">精确日期覆盖</p>
            <p className="mt-1 font-medium">
              {view.coverage.exactLatest.toLocaleString('zh-CN')} /{' '}
              {view.coverage.activeUniverse.toLocaleString('zh-CN')}
              {exactCoverage == null ? '' : ` · ${exactCoverage.toFixed(2)}%`}
            </p>
          </div>
          <div className="p-4">
            <p className="text-xs text-muted-foreground">收盘交叉核验</p>
            <p className="mt-1 font-medium">
              {view.crosscheck
                ? `${view.crosscheck.covered}/${view.crosscheck.requested} 行`
                : `${view.coverage.crosschecked.toLocaleString('zh-CN')} 只`}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              生成于 {formatAge(view.ageHours)}
            </p>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="border-b bg-destructive/5 px-4 py-3 text-sm text-destructive sm:px-6">
          <span className="font-medium">MISSING：</span>
          {error}。未使用旧排行、其他交易日或推算结果替代。
        </div>
      ) : null}

      {view && view.reasons.length ? (
        <div className="border-b bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800 sm:px-6 dark:bg-amber-950/30 dark:text-amber-300">
          <p className="flex items-center gap-1.5 font-medium">
            <Info className="size-3.5" />
            降级原因
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {view.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="p-4 sm:p-6">
        {!view && busy ? (
          <div className="flex min-h-52 items-center justify-center text-sm text-muted-foreground">
            正在读取跨周期排行…
          </div>
        ) : !view ? (
          <div className="flex min-h-52 flex-col items-center justify-center gap-1 text-center text-sm text-muted-foreground">
            <p>当前没有可展示的排行。</p>
            <p className="text-xs">
              数据源不可用或数据日期不成立时，不展示旧榜、其他交易日或推算结果。
            </p>
          </div>
        ) : !showTables ? (
          <div className="flex min-h-52 flex-col items-center justify-center gap-1 text-center text-sm text-muted-foreground">
            <p className="font-medium text-destructive">MISSING</p>
            <p>目标交易日数据不成立，本次不展示排行。</p>
            <p className="text-xs">
              未使用旧榜、其他交易日或日线拆分结果顶替，请核对日期或等待数据源更新。
            </p>
          </div>
        ) : (
          <Tabs defaultValue="5" className="gap-4">
            <TabsList className="grid h-auto w-full grid-cols-4 sm:w-fit">
              {WINDOW_KEYS.map((window) => (
                <TabsTrigger key={window} value={window} className="px-4 py-1.5">
                  {window}日
                </TabsTrigger>
              ))}
            </TabsList>
            {WINDOW_KEYS.map((window) => {
              const data = view.windows[window];
              return (
                <TabsContent key={window} value={window}>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={data.status} />
                      <span>
                        Top {data.topAvailable}/{data.topRequested} ·{' '}
                        {data.metadataAvailable
                          ? `元数据 ${data.metadataReady}/${data.topAvailable}`
                          : '元数据 源未提供'}{' '}
                        · 合格池 {data.eligible.toLocaleString('zh-CN')}
                      </span>
                    </div>
                    <span>
                      榜单区间 {formatDate(data.expectedStart)} 至{' '}
                      {formatDate(data.endDate)} · {data.sessions} 个交易日
                    </span>
                  </div>

                  {data.rows.length ? (
                    <Table className="min-w-[1120px]">
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12 text-center">名次</TableHead>
                          <TableHead>股票</TableHead>
                          <TableHead className="text-right">
                            {window}日涨幅
                          </TableHead>
                          <TableHead>起止日期</TableHead>
                          <TableHead>行业 / 题材</TableHead>
                          <TableHead className="text-right">总市值</TableHead>
                          <TableHead className="text-right">成交额</TableHead>
                          <TableHead className="text-right">换手率</TableHead>
                          <TableHead className="text-right">量比</TableHead>
                          <TableHead>板态</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.rows.map((row, rowIndex) => (
                          <TableRow key={row.code}>
                            <TableCell className="text-center font-mono text-muted-foreground">
                              {rowIndex + 1}
                            </TableCell>
                            <TableCell>
                              <div className="font-medium">{row.name}</div>
                              <div className="text-xs text-muted-foreground">
                                {row.code} · {row.marketBoard}
                              </div>
                            </TableCell>
                            <TableCell
                              className={`text-right font-mono text-base font-semibold ${
                                row.gainPct >= 0 ? 'market-up' : 'market-down'
                              }`}
                            >
                              {formatPct(row.gainPct)}
                            </TableCell>
                            <TableCell>
                              <div>{formatDate(row.startDate)}</div>
                              <div className="text-xs text-muted-foreground">
                                至 {formatDate(row.latestDate)}
                              </div>
                            </TableCell>
                            <TableCell className="max-w-72 whitespace-normal">
                              <div>
                                {row.industry ||
                                  (data.metadataAvailable
                                    ? '行业缺失'
                                    : '行业 源未提供')}
                              </div>
                              <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                                {row.themes?.length
                                  ? row.themes.slice(0, 4).join(' · ')
                                  : data.metadataAvailable
                                    ? '题材缺失'
                                    : '题材 源未提供'}
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatLargeNumber(row.totalMarketCap)}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatLargeNumber(row.amount)}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatPct(row.turnoverRate, 1)}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {row.volumeRatio == null
                                ? '—'
                                : row.volumeRatio.toFixed(2)}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={
                                  row.limitState === '涨停'
                                    ? 'status-ready'
                                    : undefined
                                }
                              >
                                {row.limitState}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="flex min-h-32 items-center justify-center text-sm text-muted-foreground">
                      该窗口排除后没有可展示的行。
                    </div>
                  )}

                  {data.excluded.length ? (
                    <details className="mt-3 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
                      <summary className="cursor-pointer font-medium text-amber-700 dark:text-amber-400">
                        已排除 {data.excluded.length} 行，点击查看明细
                      </summary>
                      <ul className="mt-2 space-y-1 leading-5 text-muted-foreground">
                        {data.excluded.map((item) => (
                          <li key={`${item.code}-${item.reason}`}>
                            <span className="font-medium text-foreground">
                              {item.name} {item.code}
                            </span>
                            ：{item.reason}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}

                  {data.reasons.length ? (
                    <p className="mt-3 text-xs leading-5 text-amber-700 dark:text-amber-400">
                      降级原因：{data.reasons.join('；')}
                    </p>
                  ) : null}
                </TabsContent>
              );
            })}
          </Tabs>
        )}
      </div>

      {view ? (
        <footer className="space-y-1 border-t px-4 py-3 text-xs leading-5 text-muted-foreground sm:px-6">
          <p>
            数据源：{view.source} · 复权方式：{view.adjustment} · 生成于{' '}
            {new Date(view.generatedAt).toLocaleString('zh-CN', {
              hour12: false,
            })}
            （{formatAge(view.ageHours)}）
          </p>
          <details>
            <summary className="cursor-pointer">计算口径与校验方式</summary>
            <p className="mt-1">{view.methodology}</p>
            <p className="mt-1">
              交易日锚点来自本地权威日历（{formatDate(CALENDAR_DATES[0])} 至{' '}
              {formatDate(CALENDAR_LAST)}，共 {CALENDAR_DATES.length}{' '}
              个交易日）；本页据此校验目标日与每个窗口的起点，不参与涨幅计算。
            </p>
            <p className="mt-1">
              当前数据源：
              {sourceKind === 'snapshot'
                ? '本地快照（public/rankings），按交易日存档，可回看历史。'
                : '外部接口，只提供最新交易日，不具备历史能力。'}
            </p>
            {view.scoringDisabled ? (
              <p className="mt-1">
                数据源声明未启用评分、选股概率与自动交易；本页不提供任何评分或推荐结论。
              </p>
            ) : null}
          </details>
        </footer>
      ) : null}
    </section>
  );
}
