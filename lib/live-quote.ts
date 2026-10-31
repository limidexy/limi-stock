/**
 * 腾讯实时快照报价（qt.gtimg.cn）。
 *
 * 只做一件事：把 `v_sh600838="..."` 解析成「价格 + 涨跌幅 + 报价时刻」。
 * 使用边界：
 *   - 报价自带日期；只有报价日期 == 目标日时才允许当作该日价格，
 *     否则一律不用，避免把今天的快照回填到历史交易日；
 *   - 15:00 之后的时间戳是收盘后快照，标「收盘」而不是「实时」；
 *   - 取不到就是 null，不拿日线收盘冒充实时价。
 */

const HEADERS = {
  referer: 'https://gu.qq.com/',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

export type LiveQuote = {
  code: string;
  price: number;
  changePct: number | null;
  /** YYYY-MM-DD */
  date: string | null;
  /** HH:MM */
  time: string | null;
  /** 原始时间戳 yyyyMMddHHmmss */
  stamp: string | null;
  source: string;
};

function marketPrefix(code: string) {
  if (code.startsWith('6')) return 'sh';
  if (code.startsWith('8') || code.startsWith('4')) return 'bj';
  return 'sz';
}

export function parseTencentQuotes(raw: string): Map<string, LiveQuote> {
  const out = new Map<string, LiveQuote>();
  for (const line of raw.split(';')) {
    const match = /v_([a-z]{2}\d{6})="([^"]*)"/.exec(line.trim());
    if (!match) continue;
    const symbol = match[1];
    const parts = match[2].split('~');
    if (parts.length < 33) continue;
    const code = parts[2] || symbol.slice(2);
    const price = Number(parts[3]);
    const stamp = parts[30] ?? null;
    if (!Number.isFinite(price) || price <= 0) continue;
    const changePct = Number(parts[32]);
    const date =
      stamp && /^\d{8}/.test(stamp)
        ? `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`
        : null;
    const time =
      stamp && /^\d{12}/.test(stamp)
        ? `${stamp.slice(8, 10)}:${stamp.slice(10, 12)}`
        : null;
    out.set(code, {
      code,
      price,
      changePct: Number.isFinite(changePct) ? changePct : null,
      date,
      time,
      stamp,
      source: '腾讯实时快照',
    });
  }
  return out;
}

/** 批量取实时快照；一次请求最多 60 只，失败返回空表而不是抛错。 */
export async function fetchLiveQuotes(
  codes: string[],
): Promise<Map<string, LiveQuote>> {
  const unique = [...new Set(codes)].filter((code) => /^\d{6}$/.test(code));
  if (!unique.length) return new Map();
  const out = new Map<string, LiveQuote>();
  for (let i = 0; i < unique.length; i += 60) {
    const batch = unique.slice(i, i + 60);
    const query = batch.map((code) => `${marketPrefix(code)}${code}`).join(',');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(`https://qt.gtimg.cn/q=${query}`, {
        headers: HEADERS,
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) continue;
      // 腾讯返回 GBK；价格、代码、时间戳都是 ASCII，按 latin1 读即可取出数值。
      const text = new TextDecoder('latin1').decode(
        await response.arrayBuffer(),
      );
      for (const [code, quote] of parseTencentQuotes(text)) out.set(code, quote);
    } catch {
      // 报价是可选的补充信息，失败不阻塞页面
    } finally {
      clearTimeout(timer);
    }
  }
  return out;
}

/**
 * 报价能不能当作「目标日的价格」：
 * 只有报价日期与目标日一致才可用。否则返回 null，由调用方退回日线收盘。
 */
export function quoteForDate(
  quote: LiveQuote | undefined,
  targetDate: string,
): { price: number; changePct: number | null; label: string; asOf: string } | null {
  if (!quote || quote.date !== targetDate) return null;
  const closed = (quote.time ?? '') >= '15:00';
  return {
    price: quote.price,
    changePct: quote.changePct,
    label: closed ? '收盘' : '实时',
    asOf: `${quote.date} ${quote.time ?? ''}`.trim(),
  };
}
