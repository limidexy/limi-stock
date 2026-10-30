'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trophy,
} from 'lucide-react';

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

type DataState = 'READY' | 'DEGRADED' | 'MISSING';
type WindowKey = '5' | '10' | '20' | '30';

type RankingRow = {
  code: string;
  name: string;
  marketBoard: string;
  industry: string | null;
  themes: string[];
  latestClose: number;
  latestDate: string;
  amount: number | null;
  turnoverRate: number | null;
  volumeRatio: number | null;
  totalMarketCap: number | null;
  circulatingMarketCap: number | null;
  limitState: string;
  quoteTime: string | null;
  startDate: string;
  startClose: number;
  gainPct: number;
  metadataStatus: DataState;
};

type RankingWindow = {
  status: DataState;
  tradeSessions: number;
  eligible: number;
  topRequested: number;
  topAvailable: number;
  metadataReady: number;
  startDate: string | null;
  endDate: string;
  reasons: string[];
  rows: RankingRow[];
};

type RankingPayload = {
  status: DataState;
  tradeDate: string;
  generatedAt: string;
  source: string;
  adjustment: string;
  methodology: string;
  coverage: {
    listedUniverse: number;
    activeUniverse: number;
    historyResponses: number;
    exactLatest: number;
    listedSnapshotExactDate: number;
    crosschecked: number;
  };
  reasons: string[];
  windows: Record<WindowKey, RankingWindow>;
};

const DATA_URL =
  'https://bloomideas.xyz/api/research/multi-window-rankings';
const WINDOW_KEYS: WindowKey[] = ['5', '10', '20', '30'];

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const compact = value.replaceAll('-', '');
  if (!/^\d{8}$/.test(compact)) return value;
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6)}`;
}

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
  const [payload, setPayload] = useState<RankingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(DATA_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const next = (await response.json()) as RankingPayload;
      if (
        !next.tradeDate ||
        !next.coverage ||
        !WINDOW_KEYS.every((window) => next.windows?.[window])
      ) {
        throw new Error('返回结构不完整');
      }
      setPayload(next);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '排行接口不可用');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const exactCoverage = useMemo(() => {
    if (!payload?.coverage.activeUniverse) return null;
    return (
      (payload.coverage.exactLatest / payload.coverage.activeUniverse) *
      100
    );
  }, [payload]);

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <header className="flex flex-col gap-4 border-b px-4 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">
              <Trophy />
              跨周期强度
            </Badge>
            <StatusBadge status={payload?.status ?? 'MISSING'} />
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight">
              5 / 10 / 20 / 30 日最大涨幅 Top30
            </h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
              按前复权收盘价计算真实交易日区间；目标日必须精确匹配并与独立收盘行情交叉核验。
              停牌、日期陈旧、历史不足与交叉核验失败的股票不会进入排行。
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refresh()}
          disabled={loading}
          className="self-start"
        >
          <RefreshCw className={loading ? 'animate-spin' : ''} />
          {loading ? '读取中' : '刷新'}
        </Button>
      </header>

      {payload ? (
        <div className="grid grid-cols-2 border-b sm:grid-cols-4">
          <div className="border-r border-b p-4 sm:border-b-0">
            <p className="text-xs text-muted-foreground">交易日</p>
            <p className="mt-1 font-medium">{formatDate(payload.tradeDate)}</p>
          </div>
          <div className="border-b p-4 sm:border-r sm:border-b-0">
            <p className="text-xs text-muted-foreground">活跃股票池</p>
            <p className="mt-1 font-medium">
              {payload.coverage.activeUniverse.toLocaleString('zh-CN')} 只
            </p>
          </div>
          <div className="border-r p-4">
            <p className="text-xs text-muted-foreground">精确日期覆盖</p>
            <p className="mt-1 font-medium">
              {payload.coverage.exactLatest.toLocaleString('zh-CN')} /{' '}
              {payload.coverage.activeUniverse.toLocaleString('zh-CN')}
              {exactCoverage == null ? '' : ` · ${exactCoverage.toFixed(2)}%`}
            </p>
          </div>
          <div className="p-4">
            <p className="text-xs text-muted-foreground">收盘交叉核验</p>
            <p className="mt-1 font-medium">
              {payload.coverage.crosschecked.toLocaleString('zh-CN')} 只
            </p>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="border-b bg-destructive/5 px-4 py-3 text-sm text-destructive sm:px-6">
          <span className="font-medium">MISSING：</span>
          {error}。未使用旧排行或相邻交易日替代。
        </div>
      ) : null}

      <div className="p-4 sm:p-6">
        {!payload && loading ? (
          <div className="flex min-h-52 items-center justify-center text-sm text-muted-foreground">
            正在读取跨周期排行…
          </div>
        ) : payload ? (
          <Tabs defaultValue="5" className="gap-4">
            <TabsList className="grid h-auto w-full grid-cols-4 sm:w-fit">
              {WINDOW_KEYS.map((window) => (
                <TabsTrigger key={window} value={window} className="px-4 py-1.5">
                  {window}日
                </TabsTrigger>
              ))}
            </TabsList>
            {WINDOW_KEYS.map((window) => {
              const data = payload.windows[window];
              return (
                <TabsContent key={window} value={window}>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={data.status} />
                      <span>
                        Top {data.topAvailable}/{data.topRequested} · 元数据{' '}
                        {data.metadataReady}/{data.topAvailable}
                      </span>
                    </div>
                    <span>
                      榜单区间 {formatDate(data.startDate)} 至{' '}
                      {formatDate(data.endDate)}
                    </span>
                  </div>
                  <Table className="min-w-[1120px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12 text-center">名次</TableHead>
                        <TableHead>股票</TableHead>
                        <TableHead className="text-right">{window}日涨幅</TableHead>
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
                      {data.rows.map((row, index) => (
                        <TableRow key={row.code}>
                          <TableCell className="text-center font-mono text-muted-foreground">
                            {index + 1}
                          </TableCell>
                          <TableCell>
                            <div className="font-medium">{row.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {row.code} · {row.marketBoard}
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono text-base font-semibold market-up">
                            {formatPct(row.gainPct)}
                          </TableCell>
                          <TableCell>
                            <div>{formatDate(row.startDate)}</div>
                            <div className="text-xs text-muted-foreground">
                              至 {formatDate(row.latestDate)}
                            </div>
                          </TableCell>
                          <TableCell className="max-w-72 whitespace-normal">
                            <div>{row.industry || '行业缺失'}</div>
                            <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                              {row.themes.length
                                ? row.themes.slice(0, 4).join(' · ')
                                : '题材缺失'}
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
                  {data.reasons.length ? (
                    <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
                      降级原因：{data.reasons.join('；')}
                    </p>
                  ) : null}
                </TabsContent>
              );
            })}
          </Tabs>
        ) : (
          <div className="flex min-h-52 items-center justify-center text-sm text-muted-foreground">
            当前没有可展示的排行。
          </div>
        )}
      </div>

      {payload ? (
        <footer className="border-t px-4 py-3 text-xs leading-5 text-muted-foreground sm:px-6">
          数据源：{payload.source} · 复权方式：{payload.adjustment} · 生成于{' '}
          {new Date(payload.generatedAt).toLocaleString('zh-CN', {
            hour12: false,
          })}
        </footer>
      ) : null}
    </section>
  );
}
