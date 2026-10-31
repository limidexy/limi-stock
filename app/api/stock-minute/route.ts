import calendar from '@/lib/trading-calendar.generated.json';
import {
  marketSymbol,
  parseMinuteBars,
  type MinuteSeries,
} from '@/lib/minute-series';

export const dynamic = 'force-dynamic';

const CALENDAR: string[] = calendar.dates;

/** 新浪 5 分钟线单次最多约 5001 根，折合约 105 个完整交易日。 */
const MAX_SESSIONS = 105;
const SOURCE = 'SINA_CN_MARKETDATA_5MIN';
const HEADERS = {
  accept: 'application/json,text/plain,*/*',
  referer: 'https://finance.sina.com.cn/',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

const missing = (code: string, date: string, reason: string): MinuteSeries => ({
  code,
  date,
  status: 'MISSING',
  bars: [],
  expected: 48,
  source: SOURCE,
  reasons: [reason],
});

async function fetchSina(symbol: string, datalen: number, signal: AbortSignal) {
  const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${symbol}&scale=5&ma=no&datalen=${datalen}`;
  const response = await fetch(url, { headers: HEADERS, cache: 'no-store', signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.text();
  if (!body.trim()) throw new Error('返回空响应');
  return JSON.parse(body) as unknown;
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
        `行情源的 5 分钟线只覆盖最近约 ${MAX_SESSIONS} 个交易日，${date} 早于可回溯范围。`,
      ),
    );
  }

  const symbol = marketSymbol(code, board);
  const datalen = (sessionsAgo + 1) * 48 + 8;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    let raw: unknown;
    try {
      raw = await fetchSina(symbol, datalen, controller.signal);
    } catch (first) {
      // 单次重试：行情源偶发超时，不改变口径。
      raw = await fetchSina(symbol, datalen, controller.signal).catch(() => {
        throw first;
      });
    }
    const series = parseMinuteBars(raw, code, date);
    return Response.json(
      { ...series, symbol, sessionsAgo },
      {
        headers: {
          // 历史交易日的分钟价格不再变化；当日行情短缓存。
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
        `分钟行情源不可用：${error instanceof Error ? error.message : '未知错误'}`,
      ),
    );
  } finally {
    clearTimeout(timer);
  }
}
