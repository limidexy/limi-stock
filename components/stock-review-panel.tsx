'use client';

import { useEffect, useState } from 'react';
import { LineChart, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  summarizeSeries,
  type MinuteBar,
  type MinuteSeries,
} from '@/lib/minute-series';
import { compactToIso } from '@/lib/ranking-verification';
import {
  resolveStockIdentity,
  type StockIdentityView,
} from '@/lib/stock-identity';
import type { CloseIdentityView } from '@/lib/close-identity';

/** 同一交易日的跟踪归档体积较大，按日期缓存，切换股票时不重复下载。 */
const trackingCache = new Map<string, Promise<unknown>>();

function loadTracking(isoDate: string) {
  const cached = trackingCache.get(isoDate);
  if (cached) return cached;
  const request = fetch(`/api/emotion-tracking?date=${isoDate}&lookback=10`, {
    cache: 'no-store',
  })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  trackingCache.set(isoDate, request);
  return request;
}

const formatPct = (value: number | null) =>
  value == null || !Number.isFinite(value)
    ? '—'
    : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

/** 行情源的分钟成交量单位是股，不是手。 */
const formatVolume = (value: number) =>
  value >= 100_000_000
    ? `${(value / 100_000_000).toFixed(2)}亿股`
    : value >= 10_000
      ? `${(value / 10_000).toFixed(1)}万股`
      : `${Math.round(value)}股`;

const formatMoney = (value: number) =>
  value >= 100_000_000
    ? `${(value / 100_000_000).toFixed(2)}亿`
    : value >= 10_000
      ? `${(value / 10_000).toFixed(0)}万`
      : `${Math.round(value)}`;

function statusClass(status: string) {
  if (status === 'READY') return 'status-ready';
  if (status === 'DEGRADED') return 'status-degraded';
  return 'status-missing';
}

/** 5 分钟收盘曲线。纵轴按当日实际区间缩放，虚线为当日首根收盘。 */
function MinuteChart({ bars }: { bars: MinuteBar[] }) {
  if (bars.length < 2) return null;
  const closes = bars.map((bar) => bar.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || Math.max(max * 0.01, 0.01);
  const lo = min - span * 0.08;
  const hi = max + span * 0.08;
  const x = (index: number) => (index / (bars.length - 1)) * 300;
  const y = (value: number) => 90 - ((value - lo) / (hi - lo)) * 90;
  const points = bars
    .map((bar, index) => `${x(index).toFixed(2)},${y(bar.close).toFixed(2)}`)
    .join(' ');
  const first = bars[0].close;
  const last = bars[bars.length - 1].close;
  const positive = last >= first;

  return (
    <div className={positive ? 'market-up' : 'market-down'}>
      <svg
        viewBox="0 0 300 90"
        preserveAspectRatio="none"
        className="h-24 w-full"
        aria-hidden="true"
        focusable="false"
      >
        <line
          x1="0"
          y1={y(first)}
          x2="300"
          y2={y(first)}
          stroke="currentColor"
          strokeOpacity="0.35"
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
        {bars.length === 48 ? (
          <line
            x1={x(23.5)}
            y1="0"
            x2={x(23.5)}
            y2="90"
            stroke="currentColor"
            strokeOpacity="0.2"
            strokeDasharray="2 2"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
        <span>{bars[0].time}</span>
        <span>
          纵轴 {min.toFixed(2)}–{max.toFixed(2)}（区间{' '}
          {(((max - min) / (min || 1)) * 100).toFixed(2)}%）
        </span>
        <span>{bars[bars.length - 1].time}</span>
      </div>
    </div>
  );
}

export function StockReviewPanel({
  code,
  name,
  marketBoard,
  date,
  windows,
  onClose,
}: {
  code: string;
  name: string;
  marketBoard: string;
  date: string;
  windows: Array<{ key: string; gainPct: number | null }>;
  onClose: () => void;
}) {
  const isoDate = compactToIso(date) ?? date;
  const [series, setSeries] = useState<MinuteSeries | null>(null);
  const [identity, setIdentity] = useState<StockIdentityView | null>(null);
  const [closeIdentity, setCloseIdentity] =
    useState<CloseIdentityView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        setLoading(true);
        try {
          const query = new URLSearchParams({
            code,
            date: isoDate,
            board: marketBoard,
          });
          const response = await fetch(`/api/stock-minute?${query}`);
          const payload = response.ok
            ? ((await response.json()) as MinuteSeries)
            : null;
          if (cancelled) return;
          setSeries(payload);
          setError(payload ? null : `分钟接口返回 HTTP ${response.status}`);
        } catch (reason) {
          if (cancelled) return;
          setSeries(null);
          setError(reason instanceof Error ? reason.message : '分钟数据读取失败');
        } finally {
          if (!cancelled) setLoading(false);
        }

        const [closePayload, tracking] = await Promise.all([
          fetch(`/api/stock-close?code=${code}&date=${isoDate}`)
            .then((response) =>
              response.ok
                ? (response.json() as Promise<CloseIdentityView>)
                : null,
            )
            .catch(() => null),
          loadTracking(isoDate),
        ]);
        if (cancelled) return;
        setCloseIdentity(closePayload);
        setIdentity(resolveStockIdentity(tracking, code));
      })();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [code, isoDate, marketBoard]);

  const summary = series ? summarizeSeries(series) : null;
  const changePct =
    summary && summary.first > 0
      ? ((summary.last / summary.first - 1) * 100).toFixed(2)
      : null;

  return (
    <div className="max-w-[calc(100vw-2rem)] border-t bg-muted/20 px-4 py-4 lg:max-w-none">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold">
            {name}{' '}
            <span className="text-sm font-normal text-muted-foreground">
              {code} · {marketBoard} · {isoDate}
            </span>
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">该日区间涨幅：</span>
            {windows.map((item) => (
              <span
                key={item.key}
                className={`rounded border px-1.5 py-0.5 font-mono ${
                  (item.gainPct ?? 0) >= 0 ? 'market-up' : 'market-down'
                }`}
              >
                {item.key}日 {formatPct(item.gainPct)}
              </span>
            ))}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X />
          收起
        </Button>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border bg-card p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <LineChart className="size-4" />
              当日 5 分钟分时
            </p>
            <Badge
              variant="outline"
              className={statusClass(series?.status ?? 'MISSING')}
            >
              {series?.status ?? (loading ? '读取中' : 'MISSING')}
            </Badge>
          </div>

          {loading ? (
            <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
              正在读取分钟价格…
            </div>
          ) : series && series.bars.length ? (
            <>
              <MinuteChart bars={series.bars} />
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">开</dt>
                  <dd className="font-mono">{summary?.first.toFixed(2)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">高</dt>
                  <dd className="font-mono">{summary?.high.toFixed(2)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">低</dt>
                  <dd className="font-mono">{summary?.low.toFixed(2)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">收</dt>
                  <dd className="font-mono">{summary?.last.toFixed(2)}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-muted-foreground">日内振幅（首根→末根）</dt>
                  <dd
                    className={`font-mono ${(Number(changePct) || 0) >= 0 ? 'market-up' : 'market-down'}`}
                  >
                    {changePct ? `${Number(changePct) >= 0 ? '+' : ''}${changePct}%` : '—'}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-muted-foreground">分钟累计成交量</dt>
                  <dd className="font-mono">
                    {summary ? formatVolume(summary.volume) : '—'}
                  </dd>
                </div>
              </dl>
            </>
          ) : (
            <div className="flex h-24 flex-col items-center justify-center gap-1 text-center text-sm text-muted-foreground">
              <p>该交易日没有可用的分钟价格。</p>
              <p className="text-xs">
                {error ??
                  series?.reasons[0] ??
                  '不用日线拆分或相邻交易日数据顶替。'}
              </p>
            </div>
          )}

          {series?.reasons.length && series.status !== 'MISSING' ? (
            <ul className="mt-2 space-y-0.5 text-xs text-amber-700 dark:text-amber-400">
              {series.reasons.map((reason) => (
                <li key={reason}>· {reason}</li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="rounded-lg border bg-card p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">身份与辨识度 · 项目自带识别</p>
            <Badge
              variant="outline"
              className={statusClass(identity?.status ?? 'MISSING')}
            >
              {identity?.status ?? '读取中'}
            </Badge>
          </div>

          {closeIdentity ? (
            <div className="rounded-md border bg-muted/30 p-2">
              <p className="text-xs font-medium text-muted-foreground">
                当日收盘归档
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {closeIdentity.height ? (
                  <Badge variant="secondary">{closeIdentity.height} 板</Badge>
                ) : (
                  <Badge variant="outline">未在涨停梯队</Badge>
                )}
                {closeIdentity.isHighest ? (
                  <Badge variant="outline">当日最高板</Badge>
                ) : null}
                {closeIdentity.highestBoard ? (
                  <span className="text-xs text-muted-foreground">
                    全市场最高 {closeIdentity.highestBoard} 板 · 涨停{' '}
                    {closeIdentity.limitUpTotal ?? '—'} 家
                  </span>
                ) : null}
              </div>
              {closeIdentity.height ? (
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
                  <div>
                    <dt className="text-muted-foreground">首封</dt>
                    <dd className="font-mono">
                      {closeIdentity.firstTouch ?? '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">末封</dt>
                    <dd className="font-mono">{closeIdentity.lastSeal ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">炸板次数</dt>
                    <dd className="font-mono">{closeIdentity.breakCount ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">封单</dt>
                    <dd className="font-mono">
                      {closeIdentity.sealFund == null
                        ? '—'
                        : formatMoney(closeIdentity.sealFund)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">行业</dt>
                    <dd>{closeIdentity.industry ?? '归档未提供'}</dd>
                  </div>
                </dl>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  {closeIdentity.reasons[0] ?? '当日未涨停。'}
                </p>
              )}
            </div>
          ) : null}

          <p className="mt-2 text-xs font-medium text-muted-foreground">
            跟踪归档
          </p>
          {!identity ? (
            <div className="flex h-16 items-center justify-center text-sm text-muted-foreground">
              正在读取该交易日的身份归档…
            </div>
          ) : (
            <>
              {identity.roles.length ? (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {identity.roles.map((role) => (
                    <Badge key={role} variant="secondary">
                      {role}
                    </Badge>
                  ))}
                  {identity.recognition ? (
                    <Badge variant="outline">{identity.recognition}</Badge>
                  ) : (
                    <Badge variant="outline">无空间记忆证据</Badge>
                  )}
                </div>
              ) : null}

              {identity.facts.length ? (
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  {identity.facts.map((fact) => (
                    <div key={`${fact.label}:${fact.value}`}>
                      <dt className="text-muted-foreground">{fact.label}</dt>
                      <dd className="font-mono">{fact.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}

              {identity.reasons.length ? (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                  {identity.reasons.join('；')}
                </p>
              ) : null}

              <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                {identity.notes.map((note) => (
                  <li key={note}>· {note}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        分时只来自行情源的 5 分钟价格，不补点、不插值、不用日线拆分；板高与封板细节取自该交易日的收盘归档，
        身份与辨识度取自该交易日的情绪跟踪归档。二者都不是龙头认证，也不代表当日强弱或后续走势。
      </p>
    </div>
  );
}
