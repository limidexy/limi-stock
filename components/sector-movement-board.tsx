'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';

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
import type { SectorBoard, SectorKind, SectorRow } from '@/lib/sector-movement';

const ROW_LIMIT = 8;
const REFRESH_MS = 60_000;

function formatPct(value: number | null) {
  return value == null || !Number.isFinite(value)
    ? '—'
    : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatAmount(value: number | null) {
  if (value == null || !Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`;
  return `${(value / 10_000).toFixed(0)}万`;
}

function formatDate(value: string | null) {
  if (!value || value.length !== 8) return '—';
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`;
}

function StatusBadge({ status }: { status: SectorBoard['status'] }) {
  const className =
    status === 'READY'
      ? 'status-ready'
      : status === 'DEGRADED'
        ? 'status-degraded'
        : 'status-missing';
  return (
    <Badge variant="outline" className={className}>
      {status === 'READY' ? '可用' : status === 'DEGRADED' ? '降级' : '缺失'}
    </Badge>
  );
}

function SectorRows({
  rows,
  empty,
}: {
  rows: SectorRow[];
  empty: string;
}) {
  if (!rows.length)
    return (
      <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
        {empty}
      </p>
    );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>板块</TableHead>
          <TableHead className="text-right">涨跌幅</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={`${row.kind}:${row.code}`}>
            <TableCell className="align-top">
              <div className="font-medium">{row.name}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {row.count == null ? '家数未知' : `${row.count}家`}
                {' · 成交额 '}
                {formatAmount(row.amount)}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {row.lead
                  ? `领涨 ${row.lead.name} ${formatPct(row.lead.changePct)}`
                  : '领涨股未提供'}
              </div>
            </TableCell>
            <TableCell
              className={`text-right align-top font-medium ${
                (row.changePct ?? 0) >= 0 ? 'market-up' : 'market-down'
              }`}
            >
              {formatPct(row.changePct)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function SectorMovementBoard() {
  const [data, setData] = useState<SectorBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<SectorKind>('industry');
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    const load = () => {
      setLoading(true);
      fetch('/api/sector-movement', {
        signal: controller.signal,
        cache: 'no-store',
      })
        .then(async (response) => {
          const payload = (await response.json()) as SectorBoard;
          if (cancelled) return;
          setData(payload);
          setError(null);
        })
        .catch((cause: unknown) => {
          if (cancelled) return;
          if (cause instanceof Error && cause.name === 'AbortError') return;
          setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [nonce]);

  const scoped = (data?.rows ?? []).filter((row) => row.kind === kind);
  const up = scoped.slice(0, ROW_LIMIT);
  const down = [...scoped].slice(-ROW_LIMIT).reverse();

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  const check = data?.check ?? null;
  const scopeLabel = kind === 'industry' ? '行业' : '概念';
  const otherCount =
    kind === 'industry'
      ? (data?.coverage.concepts ?? 0)
      : (data?.coverage.industries ?? 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="size-4" />
            板块异动 · {formatDate(data?.tradeDate ?? null)}
          </CardTitle>
          <CardDescription>
            {data?.source ?? '正在读取板块收盘快照…'}
            <span className="mt-1 block">
              行业 {data?.coverage.industries ?? '—'} 个 · 概念{' '}
              {data?.coverage.concepts ?? '—'} 个 · 剔除{' '}
              {data?.coverage.rejected ?? '—'} 行
            </span>
            {check ? (
              <span className="mt-1 block">
                日期校验：
                {check.status === 'READY'
                  ? `领涨股 ${check.name} 收盘 ${check.close} 与板块领涨价一致，报价日期 ${check.quoteDate}`
                  : '未能确认这份快照属于目标交易日'}
              </span>
            ) : null}
          </CardDescription>
          <CardAction>
            <div className="flex items-center gap-2">
              <StatusBadge status={data?.status ?? 'MISSING'} />
              <Button
                variant="ghost"
                size="sm"
                onClick={reload}
                disabled={loading}
              >
                <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} />
                刷新
              </Button>
            </div>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-3">
          {data?.reasons?.length ? (
            <ul className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/[0.08] px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              {data.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
          {!data?.rows?.length ? (
            <p className="rounded-lg border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
              {loading
                ? '正在读取板块收盘快照…'
                : (data?.reasons?.[0] ?? error ?? '当前没有可用的板块数据')}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {(['industry', 'concept'] as const).map((value) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={kind === value ? 'default' : 'outline'}
                    onClick={() => setKind(value)}
                  >
                    {value === 'industry' ? '行业' : '概念'}
                    <span className="ml-1 text-xs opacity-70">
                      {value === 'industry'
                        ? (data?.coverage.industries ?? 0)
                        : (data?.coverage.concepts ?? 0)}
                    </span>
                  </Button>
                ))}
                <span className="text-xs text-muted-foreground">
                  切换口径不改变数据，只切换展示的板块集合
                </span>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-lg border">
                  <div className="border-b px-3 py-2 text-sm font-medium market-up">
                    {scopeLabel}领涨 · 前 {up.length}
                  </div>
                  <div className="p-2">
                    <SectorRows rows={up} empty="该口径下没有上涨板块" />
                  </div>
                </div>
                <div className="rounded-lg border">
                  <div className="border-b px-3 py-2 text-sm font-medium market-down">
                    {scopeLabel}领跌 · 前 {down.length}
                  </div>
                  <div className="p-2">
                    <SectorRows rows={down} empty="该口径下没有下跌板块" />
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                板块涨跌幅由上游按成分股当日收盘计算；这里没有主力资金流字段，
                所以不展示、也不推算资金净额。另有 {otherCount} 个
                {kind === 'industry' ? '概念' : '行业'}板块，切换口径可查看。
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
