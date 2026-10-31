import { getMarketDateContext } from '@/lib/market';
import {
  checkSectorSnapshot,
  parseSinaLeadQuote,
  parseSinaSectorPayload,
  type SectorBoard,
  type SectorRow,
} from '@/lib/sector-movement';

export const dynamic = 'force-dynamic';

const INDUSTRY_URL =
  'https://money.finance.sina.com.cn/q/view/newFLJK.php?param=industry';
const CONCEPT_URL =
  'https://money.finance.sina.com.cn/q/view/newFLJK.php?param=class';
const SINA_HEADERS = {
  referer: 'https://finance.sina.com.cn/',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
};

const cache = new Map<string, { expiresAt: number; value: SectorBoard }>();

/**
 * 新浪板块接口是 GBK。运行时如果没有 GBK 解码能力，宁可报缺失，
 * 也不能把乱码当成板块名展示出去。
 */
function decodeGbk(buffer: ArrayBuffer): string | null {
  try {
    const text = new TextDecoder('gbk').decode(buffer);
    return text.includes('\ufffd') ? null : text;
  } catch {
    return null;
  }
}

async function fetchSinaText(url: string): Promise<string> {
  let lastError: unknown = new Error('未发起请求');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, { headers: SINA_HEADERS });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = decodeGbk(await response.arrayBuffer());
      if (text === null) throw new Error('GBK 解码失败');
      return text;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });

export async function GET() {
  const context = await getMarketDateContext().catch(() => null);
  if (!context)
    return json(
      {
        status: 'MISSING',
        tradeDate: null,
        rows: [],
        reasons: ['无法确认目标交易日，未使用其他日期行情。'],
      },
      503,
    );

  const cached = cache.get(context.tradeDate);
  if (cached && cached.expiresAt > Date.now()) return json(cached.value);

  const [industryText, conceptText] = await Promise.all([
    fetchSinaText(INDUSTRY_URL).catch(() => null),
    fetchSinaText(CONCEPT_URL).catch(() => null),
  ]);
  if (!industryText && !conceptText)
    return json(
      {
        status: 'MISSING',
        tradeDate: null,
        requestedDate: context.tradeDate,
        rows: [],
        reasons: [
          '板块行情接口不可用（行业与概念均未取到），未回退其他日期或口径。',
        ],
      },
      503,
    );

  const industry = industryText
    ? parseSinaSectorPayload(industryText, 'industry')
    : { rows: [], rejected: 0 };
  const concept = conceptText
    ? parseSinaSectorPayload(conceptText, 'concept')
    : { rows: [], rejected: 0 };
  const rows: SectorRow[] = [...industry.rows, ...concept.rows].sort(
    (a, b) => (b.changePct ?? 0) - (a.changePct ?? 0),
  );
  if (!rows.length)
    return json(
      {
        status: 'MISSING',
        tradeDate: null,
        requestedDate: context.tradeDate,
        rows: [],
        reasons: ['板块接口有响应但没有可用板块行，未用缓存或旧日期顶替。'],
      },
      503,
    );

  // 板块快照不带时间戳，用最强板块的领涨股反查日期与价格。
  const probe = rows.find((row) => row.lead?.price != null) ?? null;
  const quoteText = probe?.lead
    ? await fetchSinaText(`https://hq.sinajs.cn/list=${probe.lead.code}`).catch(
        () => null,
      )
    : null;
  const check = probe
    ? checkSectorSnapshot(
        probe,
        quoteText ? parseSinaLeadQuote(quoteText) : null,
        context.tradeDate,
      )
    : null;

  const reasons: string[] = [];
  if (!industryText) reasons.push('行业板块未取到，仅展示概念板块。');
  if (!conceptText) reasons.push('概念板块未取到，仅展示行业板块。');
  if (industry.rejected + concept.rejected)
    reasons.push(
      `${industry.rejected + concept.rejected} 行字段不完整已剔除（缺代码、名称或涨跌幅）。`,
    );
  if (check?.reasons.length) reasons.push(...check.reasons);

  const board: SectorBoard = {
    status: check?.status === 'READY' ? 'READY' : 'DEGRADED',
    tradeDate: context.tradeDate,
    requestedDate: context.tradeDate,
    retrievedAt: new Date().toISOString(),
    source: '新浪财经 板块行情（行业 + 概念）',
    reasons,
    coverage: {
      industries: industry.rows.length,
      concepts: concept.rows.length,
      usable: rows.length,
      rejected: industry.rejected + concept.rejected,
    },
    check,
    rows,
  };
  cache.set(context.tradeDate, {
    expiresAt: Date.now() + 60_000,
    value: board,
  });
  return json(board);
}
