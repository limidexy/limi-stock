'use client';

import { useEffect, useState } from 'react';
import { Activity, ArrowRight, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CloseDatePicker } from '@/components/emotion-cycle-board';
import type { CloseHistoryDocument } from '@/lib/close-history';
import type { EmotionTracking } from '@/lib/emotion-tracking';

type Payload = EmotionTracking & {
  sourceState: string;
  retrievedAt: string;
  storageReason?: string | null;
  reason?: string;
};
const pct = (n: number | null | undefined) =>
  n == null ? '缺报价' : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
const pathQuote = (
  n: number | null | undefined,
  state?: 'READY' | 'NO_TRADE' | 'MISSING',
  note?: string | null,
) => (state === 'NO_TRADE' ? (note === '停牌' ? '停牌' : '无成交') : pct(n));
const tone = (n: number | null | undefined) =>
  n == null
    ? 'text-muted-foreground'
    : n > 0
      ? 'market-up'
      : n < 0
        ? 'market-down'
        : 'text-muted-foreground';
function Coverage({
  part,
}: {
  part: {
    requested: number;
    available: number;
    status: string;
    reason: string;
  };
}) {
  return (
    <div className="space-y-1 text-sm">
      <p>
        <Badge variant="outline">
          {part.status === 'READY'
            ? '证据齐备'
            : part.status === 'MISSING'
              ? '无可用样本'
              : '部分证据'}{' '}
          · {part.available}/{part.requested}
        </Badge>
      </p>
      <p className="text-muted-foreground">{part.reason}</p>
    </div>
  );
}

export function EmotionTrackingBoard({
  history,
  selectedDate,
  onDateChange,
}: {
  history: CloseHistoryDocument;
  selectedDate: string;
  onDateChange: (date: string) => void;
}) {
  const [mode, setMode] = useState('history');
  const [lookback, setLookback] = useState('10');
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAllPaths, setShowAllPaths] = useState(false);
  const [requestKey, setRequestKey] = useState('');
  const key = `${mode === 'live' ? 'latest' : selectedDate}:${lookback}`;
  useEffect(() => {
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      try {
        const response = await fetch(
          `/api/emotion-tracking?date=${mode === 'live' ? 'latest' : selectedDate}&lookback=${lookback}`,
          { signal: controller.signal, cache: 'no-store' },
        );
        const result = (await response.json()) as Payload;
        if (!response.ok || !result.oldLeaders)
          throw Error(result.reason ?? '跟踪数据未就绪');
        if (!stopped) {
          setRequestKey(key);
          setData(result);
          setError(null);
        }
      } catch (e) {
        if (!stopped) {
          setRequestKey(key);
          setData(null);
          setError(String(e));
        }
      } finally {
        if (!stopped) {
          setLoading(false);
          timer = setTimeout(poll, 30_000);
        }
      }
    }
    void poll();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [key, mode, selectedDate, lookback, revision]);
  const current = requestKey === key ? data : null;
  const paths =
    current?.rebounds.rows.filter(
      (x) =>
        showAllPaths ||
        ('event' in x && x.event) ||
        ('lowPct' in x && x.lowPct! <= -5),
    ) ?? [];
  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-5 text-amber-500" />
              情绪跟踪 · 强股掉队后，还要继续看
            </CardTitle>
            <p className="mt-2 text-sm text-muted-foreground">
              老高标 → 断板承接 · 炸板 → 次日修复 · 深跌 → 拉回 · 核心 →
              同组响应
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRevision((x) => x + 1)}
          >
            <RefreshCw
              className={loading || requestKey !== key ? 'animate-spin' : ''}
            />
            刷新跟踪
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect
            aria-label="跟踪模式"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            <NativeSelectOption value="history">按日回看</NativeSelectOption>
            <NativeSelectOption value="live">跟随最新行情</NativeSelectOption>
          </NativeSelect>
          {mode === 'history' && (
            <CloseDatePicker
              value={selectedDate}
              onChange={onDateChange}
              history={history}
              compact
            />
          )}
          <NativeSelect
            aria-label="老高标回溯区间"
            value={lookback}
            onChange={(e) => setLookback(e.target.value)}
          >
            {[5, 10, 20].map((n) => (
              <NativeSelectOption key={n} value={String(n)}>
                回溯{n}个已归档交易日
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {current && (
            <span className="text-sm font-medium">
              {current.date} {current.cutoff} ·{' '}
              {current.sourceState === 'LIVE' ? '盘中观察' : '历史回看，非实时'}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div
            role="alert"
            className="rounded-lg border border-amber-400/40 bg-amber-500/10 p-3 text-sm"
          >
            {error}
            {current &&
              `；保留${current.date} ${current.cutoff}上次成功结果，非当前实时。`}
          </div>
        )}
        {!current ? (
          <p className="py-6 text-muted-foreground">
            {loading
              ? '正在对齐前日身份、当日报价与分钟路径…'
              : '目标日期没有完整跟踪资料，未替换成其他日期。'}
          </p>
        ) : (
          <>
            {current.storageReason && (
              <p className="text-sm text-amber-700">{current.storageReason}</p>
            )}
            {current.missingSessions.length > 0 && (
              <p className="text-sm text-amber-700">
                历史存在间隔：{current.missingSessions.join('、')}
                之前缺相邻收盘日；不把间隔两端当连续交易日。
              </p>
            )}
            <Tabs defaultValue="old" className="space-y-4">
              <TabsList className="h-auto w-full flex-wrap justify-start gap-1">
                <TabsTrigger value="old">
                  断板老高标 {current.oldLeaders.rows.length}
                </TabsTrigger>
                <TabsTrigger value="failed">
                  昨日炸板修复 {current.failedRepair.rows.length}
                </TabsTrigger>
                <TabsTrigger value="rebound">盘中反核过程</TabsTrigger>
                <TabsTrigger value="lead">核心与跟随</TabsTrigger>
                <TabsTrigger value="negative">负向先后</TabsTrigger>
              </TabsList>
              <TabsContent value="old" className="space-y-3">
                <Coverage part={current.oldLeaders} />
                {!current.oldLeaders.rows.length && (
                  <p className="text-muted-foreground">
                    该区间没有已确认断板的老高标，或缺少确认断板所需的连续收盘名单。
                  </p>
                )}
                {current.oldLeaders.rows.map((stock) => (
                  <article key={stock.code} className="rounded-lg border p-4">
                    <div className="flex flex-wrap justify-between gap-2">
                      <p className="font-semibold">
                        {stock.name}{' '}
                        <span className="text-sm font-normal text-muted-foreground">
                          {stock.code}
                        </span>
                      </p>
                      <span
                        className={`font-mono font-semibold ${tone(stock.changePct)}`}
                      >
                        {pathQuote(
                          stock.changePct,
                          stock.quoteState,
                          stock.quoteNote,
                        )}
                      </span>
                    </div>
                    <p className="my-2 text-sm text-muted-foreground">
                      {stock.peakDate} 最高{stock.peakHeight}板 ·{' '}
                      {stock.brokenDate}断板 · {stock.industry}
                    </p>
                    <div
                      className="flex gap-2 overflow-x-auto pb-2"
                      aria-label={`${stock.name}断板前后逐日表现`}
                    >
                      {stock.path.map((day) => (
                        <div
                          key={day.date}
                          className={`min-w-24 rounded-md border p-2 text-center text-sm ${day.date === stock.brokenDate ? 'border-amber-400 bg-amber-500/10' : 'bg-muted/30'}`}
                        >
                          <p>{day.date.slice(5)}</p>
                          <p
                            className={`my-1 font-mono font-semibold ${tone(day.changePct)}`}
                          >
                            {pathQuote(
                              day.changePct,
                              day.quoteState,
                              day.quoteNote,
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {day.height
                              ? `${day.height}板封住`
                              : day.date === stock.brokenDate
                                ? '断板'
                                : '未封板'}
                          </p>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </TabsContent>
              <TabsContent value="failed" className="space-y-3">
                <Coverage part={current.failedRepair} />
                <p className="text-sm">
                  固定名单：{current.previousDate ?? '缺前日'}收盘炸板股。上涨
                  {current.failedRepair.positive}只，下跌
                  {current.failedRepair.negative}只，重新涨停
                  {current.failedRepair.resealed}只
                  {current.failedRepair.status !== 'READY'
                    ? '（仅已知样本，不计算整体修复率）'
                    : ''}
                  。
                </p>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {current.failedRepair.rows.map((stock) => (
                    <article
                      key={stock.code}
                      className="rounded-lg border p-3 text-sm"
                    >
                      <div className="flex justify-between gap-2">
                        <span className="font-semibold">{stock.name}</span>
                        <span
                          className={`font-mono font-semibold ${tone(stock.changePct)}`}
                        >
                          {pathQuote(
                            stock.changePct,
                            stock.quoteState,
                            stock.label,
                          )}
                        </span>
                      </div>
                      <p className="my-1 text-xs text-muted-foreground">
                        {stock.code} · {stock.industry} · 昨日
                        {pct(stock.yesterdayChangePct)}
                      </p>
                      <p className={tone(stock.changePct)}>{stock.label}</p>
                    </article>
                  ))}
                </div>
              </TabsContent>
              <TabsContent value="rebound" className="space-y-3">
                <Coverage part={current.rebounds} />
                <p className="text-sm text-muted-foreground">
                  按分钟收盘价识别，不代表分钟内最低成交价；收盘集合竞价14:57—15:00只核验端点，不推断期间路径。
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAllPaths((x) => !x)}
                >
                  {showAllPaths ? '仅看深跌及拉回' : '查看全部监测股与缺口'}
                </Button>
                {!paths.length && (
                  <p className="text-muted-foreground">
                    已取得的路径中没有达到深跌拉回条件的股票；不代表缺失样本没有发生。
                  </p>
                )}
                {paths.map((stock) => (
                  <article
                    key={stock.code}
                    className="rounded-lg border p-4 text-sm"
                  >
                    <div className="flex flex-wrap justify-between gap-2">
                      <p className="font-semibold">
                        {stock.name}{' '}
                        <span className="font-normal text-muted-foreground">
                          {stock.code}
                        </span>
                      </p>
                      <Badge variant="outline">{stock.label}</Badge>
                    </div>
                    {'lowTime' in stock && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-emerald-500/10 p-2">
                          {stock.event?.lowTime ?? stock.lowTime} 低位{' '}
                          {pct(stock.event?.lowPct ?? stock.lowPct)}
                        </span>
                        <ArrowRight className="size-4" />
                        {stock.event && (
                          <>
                            <span className="rounded-md bg-red-500/10 p-2">
                              {stock.event.time} 拉回确认{' '}
                              {pct(stock.event.changePct)} · 较低位+
                              {stock.event.recoveryPp.toFixed(2)}个百分点
                            </span>
                            <ArrowRight className="size-4" />
                          </>
                        )}
                        <span className="rounded-md bg-muted p-2">
                          {stock.lastTime} {pct(stock.lastPct)}
                        </span>
                      </div>
                    )}
                    <p className="mt-2 text-muted-foreground">
                      {stock.status} · {stock.points}个有效分钟点
                      {'reason' in stock && stock.reason
                        ? ` · ${stock.reason}`
                        : ''}
                    </p>
                  </article>
                ))}
              </TabsContent>
              <TabsContent value="lead" className="space-y-3">
                <Coverage part={current.leadLag} />
                <p className="text-sm font-medium">
                  先后关系 ≠
                  带动因果。同涨可能来自共同消息或指数环境；未响应、提前响应的股票也保留。
                </p>
                {!current.leadLag.rows.length && (
                  <p className="text-muted-foreground">
                    前日名单中暂没有具备核心与同组成员的组合，未用今天赢家倒填核心身份。
                  </p>
                )}
                {current.leadLag.rows.map((group) => (
                  <article
                    key={`${group.industry}:${group.core.code}`}
                    className="rounded-lg border p-4"
                  >
                    <div className="flex flex-wrap justify-between gap-2">
                      <h3 className="font-semibold">
                        {group.industry} · {group.core.name}（昨
                        {group.core.height}板）
                      </h3>
                      <Badge variant="outline">
                        路径 {group.available}/{group.requested}
                      </Badge>
                    </div>
                    <p className="my-2 text-sm">
                      {group.onset
                        ? `${group.onset.time} 核心3分钟涨幅增量+${group.onset.gain.toFixed(2)}个百分点`
                        : '核心分钟路径不足或未达到拉升条件'}{' '}
                      · {group.label}
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {group.rows.map((stock) => (
                        <div
                          key={stock.code}
                          className="rounded-md bg-muted/50 p-3 text-sm"
                        >
                          <p className="font-semibold">
                            {stock.name}{' '}
                            <span className={tone(stock.changePct)}>
                              {stock.time ? pct(stock.changePct) : ''}
                            </span>
                          </p>
                          <p className="mt-1 text-muted-foreground">
                            {stock.time ?? '未检出时点'} · {stock.role}
                            {stock.lag != null
                              ? `（${stock.lag > 0 ? '+' : ''}${stock.lag}交易分钟）`
                              : ''}
                          </p>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </TabsContent>
              <TabsContent value="negative" className="space-y-3">
                <Coverage part={current.negativeLeadLag} />
                <p className="text-sm text-muted-foreground">
                  只接受同日连续分钟路径：核心先出现连续3分钟跌幅至少1个百分点，成员在其后1—10个交易分钟负向响应；同现但无先后保持
                  MISSING。
                </p>
                {current.negativeLeadLag.rows.map((group) => (
                  <article
                    key={`${group.industry}:${group.core.code}`}
                    className="rounded-lg border p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-semibold">
                        {group.industry} · {group.core.name}（向下观察）
                      </h3>
                      <Badge variant="outline">
                        {group.status} · {group.available}/{group.requested}
                      </Badge>
                    </div>
                    <p className="my-2 text-sm">
                      {group.onset
                        ? `${group.onset.time} 核心3分钟负向增量${group.onset.gain.toFixed(2)}个百分点`
                        : '核心没有可核验的连续分钟负向起点'}{' '}
                      · {group.label}
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {group.rows.map((stock) => (
                        <div
                          key={stock.code}
                          className="rounded-md bg-muted/50 p-3 text-sm"
                        >
                          <p className="font-semibold">{stock.name}</p>
                          <p className="mt-1 text-muted-foreground">
                            {stock.time ?? '未检出时点'} · {stock.role}
                            {stock.lag != null
                              ? `（+${stock.lag}交易分钟）`
                              : ''}
                          </p>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </TabsContent>
            </Tabs>
            <details className="border-t pt-3 text-sm text-muted-foreground">
              <summary className="cursor-pointer">数据来源与判断边界</summary>
              <p className="mt-2">{current.source}</p>
              <p>{current.boundary}</p>
              <p className="mt-2">
                盘中打开该板块时每30秒检查；收盘后由独立任务校验并保存目标股分钟证据，失败会保留原因并提醒。历史缺口只接入精确日期分钟源，不用日线倒推。涨跌幅以昨收为基准，不等于可实现交易收益。
              </p>
            </details>
          </>
        )}
      </CardContent>
    </Card>
  );
}
