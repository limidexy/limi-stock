import calendar from '@/lib/trading-calendar.generated.json';
import {
  parseTencentIntraday,
  type IntradaySeries,
} from '@/lib/intraday-series';
import { marketSymbol } from '@/lib/minute-series';

export const dynamic = 'force-dynamic';

const CALENDAR: string[] = calendar.dates;

/** 腾讯 1 分钟序列固定返回最近 5 个交易日。 */
const MAX_SESSIONS = 5;
const HEADERS = {
  referer: 'https://gu.qq.com/',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

const missing = (code: string, date: string, reason: string): IntradaySeries => ({
  status: 'MISSING',
  code,
  date,
  preClose: null,
  bars: [],
  expected: 242,
  source: '腾讯 1 分钟 K 线',
  reasons: [reason],
  notes: [],
});

async function fetchTencent(symbol: string, signal: AbortSignal) {
  const url = `https://proxy.finance.qq.com/ifzqgtimg/appstock/app/day/query?code=${symbol}&_var=x`;
  const response = await fetch(url, {
    headers: HEADERS,
    cache: 'no-store',
    signal,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.text();
  const start = body.indexOf('=');
  if (start < 0) throw new Error('返回不是赋值格式');
  return JSON.parse(body.slice(start + 1)) as unknown;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = (url.searchParams.get('code') ?? '').trim();
  const date = (url.searchParams.get('date') ?? '').trim();
  const board = url.searchParams.get('board');

  if (!/^\d{6}$/.test(code)) {
    return Response.json({ error: 'code 必须是六位股票代码' }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: 'date 必须是 YYYY-MM-DD' }, { status: 400 });
  }

  const index = CALENDAR.indexOf(date);
  if (index < 0) {
    return Response.json(
      missing(code, date, `${date} 不在本地权威交易日历内，无法确认该日有交易。`),
    );
  }

  const sessionsAgo = CALENDAR.length - 1 - index;
  if (sessionsAgo + 1 > MAX_SESSIONS) {
    return Response.json(
      missing(
        code,
        date,
        `1 分钟分时只保留最近 ${MAX_SESSIONS} 个交易日，${date} 早于可回溯范围；不用 5 分钟线或日线顶替。`,
      ),
    );
  }

  const symbol = marketSymbol(code, board);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    let raw: unknown;
    try {
      raw = await fetchTencent(symbol, controller.signal);
    } catch (first) {
      // 单次重试：行情源偶发超时，不改变口径。
      raw = await fetchTencent(symbol, controller.signal).catch(() => {
        throw first;
      });
    }
    const series = parseTencentIntraday(raw, symbol, code, date);
    return Response.json(
      { ...series, symbol, sessionsAgo },
      {
        headers: {
          // 历史交易日的分时不再变化；当日盘中短缓存。
          'cache-control':
            sessionsAgo > 0
              ? 'public, max-age=86400, immutable'
              : 'public, max-age=60',
        },
      },
    );
  } catch (error) {
    return Response.json(
      missing(
        code,
        date,
        `分时行情源不可用：${error instanceof Error ? error.message : '未知错误'}`,
      ),
    );
  } finally {
    clearTimeout(timer);
  }
}
