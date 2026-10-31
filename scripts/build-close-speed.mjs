/**
 * 生成尾盘涨速归档：lib/close-speed.generated.json
 *
 * 口径：涨速 = 当日 15:00 收盘价 / 14:55 价格 - 1，单位 %。
 * 价格取自腾讯 1 分钟 K 线，每根即该分钟的价格，不做插值、不用收盘后补数、
 * 也不把日线拆成分钟。两端点有一端缺失就记为不可用，不拿相邻分钟顶替。
 *
 * 覆盖范围是当日能取到完整 1 分钟序列的全市场股票；抓不到的计入 unavailable，
 * 写进 coverage 让前端如实展示，而不是静默缩小样本。
 */

import fs from 'node:fs/promises';

import { splitDelisted } from '../lib/stock-universe.ts';

const CONCURRENCY = 24;
const WINDOW_START = '1455';
const WINDOW_END = '1500';
const OUTPUT = new URL('../lib/close-speed.generated.json', import.meta.url);

const headers = {
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
};

async function fetchText(url, referer, attempt = 0) {
  try {
    const response = await fetch(url, {
      headers: { ...headers, referer },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } catch (error) {
    if (attempt >= 2) throw error;
    await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    return fetchText(url, referer, attempt + 1);
  }
}

async function loadUniverse() {
  const rows = new Map();
  for (let page = 1; page <= 80; page += 1) {
    const url =
      'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/' +
      `Market_Center.getHQNodeData?page=${page}&num=100&sort=symbol&asc=1&node=hs_a`;
    const text = await fetchText(url, 'https://vip.stock.finance.sina.com.cn/');
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed) || !parsed.length) break;
    for (const row of parsed) {
      const symbol = String(row.symbol ?? '').trim();
      const code = String(row.code ?? '').trim();
      const name = String(row.name ?? '').trim();
      if (symbol && code && name) rows.set(code, { symbol, code, name });
    }
  }
  return [...rows.values()];
}

async function fetchMinuteDays(symbol) {
  const url = `https://proxy.finance.qq.com/ifzqgtimg/appstock/app/day/query?code=${symbol}&_var=x`;
  const text = await fetchText(url, 'https://gu.qq.com/');
  const start = text.indexOf('=');
  if (start < 0) throw new Error('响应不是赋值格式');
  const payload = JSON.parse(text.slice(start + 1));
  const days = payload?.data?.[symbol]?.data;
  if (!Array.isArray(days)) throw new Error('响应没有分钟序列');
  return days;
}

function barPrice(bars, clock) {
  const bar = bars.find((item) => item.startsWith(`${clock} `));
  if (!bar) return null;
  const price = Number(bar.split(' ')[1]);
  return Number.isFinite(price) && price > 0 ? price : null;
}

function barTail(bars, clock) {
  const bar = bars.find((item) => item.startsWith(`${clock} `));
  if (!bar) return null;
  const fields = bar.split(' ');
  return {
    price: Number(fields[1]),
    volume: Number(fields[2]),
    amount: Number(fields[3]),
  };
}

function summarizeDay(day) {
  const bars = Array.isArray(day?.data) ? day.data : [];
  const close = barTail(bars, WINDOW_END);
  const open = barPrice(bars, WINDOW_START);
  const prec = Number(day?.prec);
  if (!close || !Number.isFinite(close.price) || close.price <= 0) return null;
  if (open === null) return null;
  return {
    date: String(day.date ?? ''),
    bars: bars.length,
    price: close.price,
    refPrice: open,
    speedPct: ((close.price / open - 1) * 100),
    changePct:
      Number.isFinite(prec) && prec > 0 ? (close.price / prec - 1) * 100 : null,
    amount: Number.isFinite(close.amount) ? close.amount : null,
    volume: Number.isFinite(close.volume) ? close.volume : null,
  };
}

async function mapLimit(items, limit, worker) {
  const results = Array.from({ length: items.length });
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index], index);
      }
    }),
  );
  return results;
}

async function main() {
  console.log('读取全市场代码…');
  const listed = await loadUniverse();
  // 退市整理期个股不进池，也不计入覆盖率分母。
  const { kept: universe, excluded } = splitDelisted(listed);
  console.log(`股票池 ${universe.length} 只 · 剔除退市整理期 ${excluded.length} 只`);
  if (excluded.length) {
    console.log(`  已剔除：${excluded.map((row) => row.name).join('、')}`);
  }

  const byDate = new Map();
  let unavailable = 0;
  let done = 0;
  const startedAt = Date.now();

  await mapLimit(universe, CONCURRENCY, async (stock) => {
    let days = null;
    try {
      days = await fetchMinuteDays(stock.symbol);
    } catch {
      unavailable += 1;
    }
    done += 1;
    if (done % 500 === 0) {
      console.log(
        `  ${done}/${universe.length} · 失败 ${unavailable} · ${(
          (Date.now() - startedAt) / 1000
        ).toFixed(0)}s`,
      );
    }
    if (!days) return;
    for (const day of days) {
      const summary = summarizeDay(day);
      if (!summary) continue;
      if (!byDate.has(summary.date)) {
        byDate.set(summary.date, {
          requested: 0,
          available: 0,
          withWindow: 0,
          rows: [],
        });
      }
      const bucket = byDate.get(summary.date);
      bucket.requested += 1;
      bucket.available += 1;
      bucket.withWindow += 1;
      bucket.rows.push({
        code: stock.code,
        name: stock.name,
        price: summary.price,
        refPrice: summary.refPrice,
        speedPct: summary.speedPct,
        changePct: summary.changePct,
        amount: summary.amount,
        volume: summary.volume,
      });
    }
  });

  const dates = {};
  for (const [date, bucket] of [...byDate.entries()].sort((a, b) =>
    a[0] < b[0] ? 1 : -1,
  )) {
    // 存全量而不是只存榜首：连板晋级与梯队竞争要按代码关联，只留前 N 会让
    // 没进榜的个股涨速凭空缺失。排序在写入前完成，读取方直接切片即可。
    const ranked = bucket.rows
      .filter((row) => Number.isFinite(row.speedPct))
      .sort((a, b) => b.speedPct - a.speedPct);
    dates[date] = {
      date,
      windowStart: '14:55',
      windowEnd: '15:00',
      requested: universe.length,
      available: bucket.available,
      withWindow: bucket.withWindow,
      delistedExcluded: excluded.length,
      rows: ranked,
    };
    console.log(
      `${date} 可用 ${bucket.available} 只 · 窗口完整 ${bucket.withWindow} 只 · 榜首 ${
        ranked[0]?.name ?? '—'
      } ${ranked[0]?.speedPct?.toFixed(2) ?? '—'}%`,
    );
  }

  const document = {
    version: 1,
    generatedAt: new Date().toISOString(),
    methodology: {
      speed: '涨速 = 15:00 收盘价 / 14:55 价格 - 1',
      window: '14:55 → 15:00',
      resolution: '1 分钟',
      source: '腾讯 1 分钟 K 线；全市场代码取自新浪沪深京 A 股列表',
      limits:
        '仅覆盖能取到完整 1 分钟序列的股票；缺端点的不参与排序；退市整理期个股（简称带「退」）已剔除',
    },
    unavailable,
    delistedExcluded: excluded.length,
    dates,
  };

  await fs.writeFile(OUTPUT, `${JSON.stringify(document, null, 1)}\n`);
  console.log(`已写入 ${OUTPUT.pathname}`);
  console.log(`不可用 ${unavailable} 只 · 耗时 ${((Date.now() - startedAt) / 1000).toFixed(0)}s`);
}

await main();
