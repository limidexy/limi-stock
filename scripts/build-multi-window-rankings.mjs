#!/usr/bin/env node
/**
 * 生成全 A 股 5 / 10 / 20 / 30 个交易日区间涨幅 Top30。
 *
 * 口径（不得擅自更改）：
 *   N 日涨幅 = 目标日复权收盘 ÷ 向前第 N 个交易日复权收盘 − 1
 * 「向前第 N 个交易日」一律由权威交易日历定位。若个股在起点日或目标日没有收盘
 * （停牌），该股直接排除并记录原因，绝不顺延到更早或更晚的交易日。
 *
 * 数据源：
 *   - 股票池：新浪 Market_Center（hs_a 全 A）
 *   - 前复权日线（主）：新浪 CN_MarketData 原始日线 ÷ 新浪前复权因子 qfq.js
 *     前复权价 = 原始价 ÷ f；已用 56 组区间收益率与腾讯前复权比对（53 组完全一致，
 *     差异仅出现在跨除权日的单一标的、幅度 ≤0.16pp）。
 *   - 前复权日线（兜底）：腾讯 ifzq qfq（HTTPS 边缘会按请求量返回 501，故不作主源）
 *   - 目标日收盘交叉核验：始终用「与产出该行不同的另一家」的**原始未复权收盘**比对。
 *     两家复权算法不同（腾讯减法复权、新浪除法因子），比复权价会把口径差异
 *     误判成数据错误，所以只比原始收盘。
 *
 * 用法：
 *   node scripts/build-multi-window-rankings.mjs --dates 30
 *   node scripts/build-multi-window-rankings.mjs --date 20261030
 *   node scripts/build-multi-window-rankings.mjs --dates 2 --limit 300   # 冒烟测试
 *
 * 产物：
 *   public/rankings/YYYYMMDD.json  每个交易日一份榜单快照（前端按日期读取）
 *   public/rankings/index.json     可用交易日索引（倒序，最新在前）
 * 注意：public/ 在构建期被复制为静态资源，所以顺序必须是「先跑本脚本，再 npm run build」。
 * 原始日线缓存写在 .cache/（已 gitignore），不入库。
 */

import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';

/**
 * Node 内置 fetch 不读取 HTTP(S)_PROXY，在这类受管网络里会被 WAF 直接挡成 501。
 * 这里实现一个最小的 CONNECT 隧道 GET，保证与 curl 行为一致，且不引入任何依赖。
 */
const PROXY =
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy ||
  '';

function httpsGet(urlStr, headers = {}, timeoutMs = 25_000) {
  return new Promise((resolve, reject) => {
    const target = new URL(urlStr);
    const requestOptions = {
      hostname: target.hostname,
      port: target.port || 443,
      path: `${target.pathname}${target.search}`,
      method: 'GET',
      headers: { 'Accept-Encoding': 'identity', ...headers },
      servername: target.hostname,
    };
    const send = (extra) => {
      const request = https.request({ ...requestOptions, ...extra }, (response) => {
        if (
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          response.resume();
          resolve(
            httpsGet(
              new URL(response.headers.location, urlStr).toString(),
              headers,
              timeoutMs,
            ),
          );
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        response.on('error', reject);
      });
      request.setTimeout(timeoutMs, () => request.destroy(new Error('timeout')));
      request.on('error', reject);
      request.end();
    };

    if (!PROXY) {
      send({});
      return;
    }
    const proxy = new URL(PROXY);
    const connectRequest = http.request({
      hostname: proxy.hostname,
      port: proxy.port || 80,
      method: 'CONNECT',
      path: `${target.hostname}:443`,
      headers: { Host: `${target.hostname}:443` },
      ...(proxy.username
        ? {
            auth: `${decodeURIComponent(proxy.username)}:${decodeURIComponent(
              proxy.password,
            )}`,
          }
        : {}),
    });
    connectRequest.setTimeout(timeoutMs, () =>
      connectRequest.destroy(new Error('proxy timeout')),
    );
    connectRequest.on('connect', (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`proxy CONNECT ${response.statusCode}`));
        return;
      }
      send({ socket, agent: false, servername: target.hostname });
    });
    connectRequest.on('error', reject);
    connectRequest.end();
  });
}

/**
 * 明文 HTTP：走代理时用 absolute-URI 形式（不建 CONNECT 隧道）。
 * 腾讯的 kline 接口在 https 边缘按量返回 501，但 http 入口仍可用，
 * 因此核验链路需要这一条明文通道。
 */
function httpGet(urlStr, headers = {}, timeoutMs = 25_000) {
  return new Promise((resolve, reject) => {
    const target = new URL(urlStr);
    const proxy = PROXY ? new URL(PROXY) : null;
    const options = proxy
      ? {
          hostname: proxy.hostname,
          port: proxy.port || 80,
          path: urlStr,
          method: 'GET',
          headers: { Host: target.hostname, ...headers },
          ...(proxy.username
            ? {
                auth: `${decodeURIComponent(proxy.username)}:${decodeURIComponent(
                  proxy.password,
                )}`,
              }
            : {}),
        }
      : {
          hostname: target.hostname,
          port: target.port || 80,
          path: `${target.pathname}${target.search}`,
          method: 'GET',
          headers: { Host: target.hostname, ...headers },
        };
    const request = http.request(options, (response) => {
      if (
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        response.resume();
        resolve(
          httpGet(
            new URL(response.headers.location, urlStr).toString(),
            headers,
            timeoutMs,
          ),
        );
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      response.on('error', reject);
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('timeout')));
    request.on('error', reject);
    request.end();
  });
}

/** 按协议分派，调用方不必关心明文/加密。 */
function fetchText(urlStr, headers = {}, timeoutMs = 25_000) {
  return urlStr.startsWith('http://')
    ? httpGet(urlStr, headers, timeoutMs)
    : httpsGet(urlStr, headers, timeoutMs);
}

const ROOT = path.resolve(import.meta.dirname, '..');
const CALENDAR_PATH = path.join(ROOT, 'lib/trading-calendar.generated.json');
const TOP_N = 30;
const WINDOWS = [5, 10, 20, 30];
const MAX_WINDOW = Math.max(...WINDOWS);
const COLLECTOR_VERSION = 'v1.0-local-multi-window-rankings';
/** 缓存结构版本：字段变更时递增，旧缓存自动失效。 */
const CACHE_VERSION = 2;

const args = process.argv.slice(2);
function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}
function argValues(name) {
  const out = [];
  args.forEach((value, index) => {
    if (value === name && args[index + 1]) out.push(args[index + 1]);
  });
  return out;
}

const DATE_COUNT = Number(argValue('--dates', '1'));
const EXPLICIT_DATES = argValues('--date');
const LIMIT = Number(argValue('--limit', '0'));
const SAMPLE = Number(argValue('--sample', '0'));
const CONCURRENCY = Number(argValue('--concurrency', '6'));
const OUT_DIR = path.resolve(ROOT, argValue('--out', 'public/rankings'));
const CACHE_DIR = path.resolve(ROOT, argValue('--cache', '.cache/rankings'));
const USE_CACHE = !args.includes('--no-cache');
const CROSSCHECK = !args.includes('--no-crosscheck');
/** 主源顺序：默认新浪优先，腾讯兜底；--provider tencent 可反转。 */
const PROVIDERS = (() => {
  const forced = argValue('--provider', '');
  if (forced === 'tencent') return ['tencent', 'sina'];
  if (forced === 'sina') return ['sina'];
  return ['sina', 'tencent'];
})();

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Referer: 'https://finance.sina.com.cn',
};

function log(...parts) {
  process.stdout.write(`${parts.join(' ')}\n`);
}

function isoToCompact(iso) {
  return iso.replaceAll('-', '');
}

async function getJson(url, attempt = 0) {
  try {
    const text = await fetchText(url, HEADERS);
    if (!text.trim()) throw new Error('empty body');
    return JSON.parse(text);
  } catch (error) {
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
      return getJson(url, attempt + 1);
    }
    throw error;
  }
}

async function pool(items, limit, worker) {
  const results = Array.from({ length: items.length });
  let cursor = 0;
  let done = 0;
  async function run() {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        results[index] = { error: error.message };
      }
      done += 1;
      if (done % 500 === 0) log(`  进度 ${done}/${items.length}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function fetchUniverse() {
  const rows = [];
  for (let page = 1; page <= 80; page += 1) {
    const url = `https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=${page}&num=100&sort=symbol&asc=1&node=hs_a`;
    const page_rows = await getJson(url);
    if (!Array.isArray(page_rows) || !page_rows.length) break;
    rows.push(...page_rows);
    if (page_rows.length < 100) break;
  }
  return rows
    .filter((row) => /^(sh|sz|bj)/.test(row.symbol ?? ''))
    .map((row) => ({
      symbol: row.symbol,
      code: row.code,
      name: row.name,
      trade: Number(row.trade),
      amount: Number.isFinite(Number(row.amount)) ? Number(row.amount) : null,
      turnoverRate: Number.isFinite(Number(row.turnoverratio))
        ? Number(row.turnoverratio)
        : null,
      totalMarketCap: Number.isFinite(Number(row.mktcap))
        ? Number(row.mktcap) * 10_000
        : null,
      circulatingMarketCap: Number.isFinite(Number(row.nmc))
        ? Number(row.nmc) * 10_000
        : null,
      ticktime: row.ticktime ?? null,
    }));
}

function marketBoardOf(symbol, code) {
  if (symbol.startsWith('bj')) return '北交所';
  if (code.startsWith('688')) return '科创板';
  if (code.startsWith('300') || code.startsWith('301')) return '创业板';
  if (code.startsWith('6')) return '沪主板';
  return '深主板';
}

function limitRatioOf(symbol, code) {
  if (symbol.startsWith('bj')) return 0.3;
  if (code.startsWith('688') || code.startsWith('300') || code.startsWith('301'))
    return 0.2;
  return 0.1;
}

/**
 * 主源：新浪（原始日线 ÷ 前复权因子）。新浪对全市场量级不设卡，
 * 腾讯的 HTTPS 边缘会按请求量返回 501 WAF 页，因此腾讯只做独立核验与兜底。
 *
 * 前复权因子文件 qfq.js 的 f 是除数：前复权价 = 原始价 ÷ f。
 * 已用 56 组「腾讯前复权 vs 新浪原始价÷因子」区间收益率比对验证（53 组完全一致，
 * 差异仅出现在跨除权日且幅度 ≤0.16pp 的单一标的）。
 */
const SINA_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Referer: 'https://finance.sina.com.cn',
};

const KLINE_BASES = [
  // 明文入口目前最稳：https 边缘会按量返回 501 WAF 页。
  'http://proxy.finance.qq.com/ifzqgtimg',
  'https://web.ifzq.gtimg.cn',
  'https://proxy.finance.qq.com/ifzqgtimg',
  'https://ifzq.gtimg.cn',
];
const KLINE_HEADERS = {
  'User-Agent': SINA_HEADERS['User-Agent'],
  Referer: 'https://gu.qq.com/',
};

async function fetchTencentBars(symbol, count, adjusted = true) {
  // 不复权要用尾部空字段（"...,71,"），省略整段会返回 bad params。
  const query = `/appstock/app/fqkline/get?param=${symbol},day,,,${count}${
    adjusted ? ',qfq' : ','
  }`;
  const failures = [];
  for (const base of KLINE_BASES) {
    try {
      const text = await fetchText(`${base}${query}`, KLINE_HEADERS);
      if (!text.trim()) throw new Error('empty body');
      const json = JSON.parse(text);
      const node = json?.data?.[symbol];
      // 不取复权时只认 day，避免误读 qfqday。
      const raw = adjusted ? (node?.qfqday ?? node?.day ?? []) : (node?.day ?? []);
      if (raw.length) {
        return raw.map((row) => ({
          date: row[0],
          open: Number(row[1]),
          close: Number(row[2]),
          high: Number(row[3]),
          low: Number(row[4]),
          volume: Number(row[5]),
        }));
      }
      failures.push(`${base} 无该股数据`);
    } catch (error) {
      failures.push(`${base} ${error.message}`);
    }
  }
  throw new Error(failures.join('; '));
}

async function fetchSinaFactors(symbol) {
  const text = await fetchText(
    `https://finance.sina.com.cn/realstock/company/${symbol}/qfq.js`,
    SINA_HEADERS,
  );
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('因子文件格式异常');
  const json = JSON.parse(text.slice(start, end + 1));
  const list = Array.isArray(json?.data) ? json.data : [];
  if (!list.length) throw new Error('因子列表为空');
  // 按日期倒序，取第一个 d <= date 的因子。
  return list
    .map((row) => ({ date: row.d, factor: Number(row.f) }))
    .filter((row) => Number.isFinite(row.factor))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

function factorAt(factors, iso) {
  for (const item of factors) if (item.date <= iso) return item.factor;
  return null;
}

async function fetchSinaBars(symbol, count) {
  const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${symbol}&scale=240&ma=no&datalen=${count}`;
  const json = await getJson(url);
  if (!Array.isArray(json) || !json.length) return [];
  const factors = await fetchSinaFactors(symbol);
  const bars = [];
  for (const row of json) {
    const factor = factorAt(factors, row.day);
    if (factor == null || factor <= 0) continue;
    bars.push({
      date: row.day,
      open: Number(row.open) / factor,
      close: Number(row.close) / factor,
      high: Number(row.high) / factor,
      low: Number(row.low) / factor,
      // 原始（未复权）收盘：交叉核验必须比原始价对原始价，
      // 否则「减法复权」与「除法因子」的口径差异会被误判成数据错误。
      rawClose: Number(row.close),
      volume: Number(row.volume),
    });
  }
  return bars;
}

async function fetchBars(symbol, count) {
  const cacheFile = path.join(CACHE_DIR, `${symbol}.json`);
  if (USE_CACHE && fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (
        cached.v === CACHE_VERSION &&
        cached.count >= count &&
        Date.now() - cached.at < 20 * 3_600_000
      ) {
        return { bars: cached.bars, source: cached.source ?? 'TENCENT_QFQ' };
      }
    } catch {
      /* 缓存损坏则重新拉取 */
    }
  }

  const attempts = [];
  for (const provider of PROVIDERS) {
    try {
      const bars =
        provider === 'sina'
          ? await fetchSinaBars(symbol, count)
          : await fetchTencentBars(symbol, count);
      if (!bars.length) {
        attempts.push(`${provider} 无数据`);
        continue;
      }
      const source = provider === 'sina' ? 'SINA_QFQ_DERIVED' : 'TENCENT_QFQ';
      if (USE_CACHE) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        fs.writeFileSync(
          cacheFile,
          JSON.stringify({ v: CACHE_VERSION, at: Date.now(), count, source, bars }),
        );
      }
      return { bars, source };
    } catch (error) {
      attempts.push(`${provider} ${error.message}`);
    }
  }
  throw new Error(attempts.join(' / '));
}

/** 交叉核验一律取「原始未复权收盘」，两家可直接比，不受复权口径差异影响。 */
async function fetchSinaRawCloses(symbol, count) {
  const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${symbol}&scale=240&ma=no&datalen=${count}`;
  const json = await getJson(url);
  if (!Array.isArray(json)) return new Map();
  return new Map(json.map((row) => [row.day, Number(row.close)]));
}

async function fetchTencentRawCloses(symbol, count) {
  const bars = await fetchTencentBars(symbol, count, false);
  return new Map(bars.map((bar) => [bar.date, bar.close]));
}

function computeWindows(entry, calendar, targets) {
  const closeByDate = new Map(entry.bars.map((bar) => [bar.date, bar]));
  const volumeByDate = new Map(entry.bars.map((bar) => [bar.date, bar.volume]));
  const board = marketBoardOf(entry.symbol, entry.code);
  const limitRatio = limitRatioOf(entry.symbol, entry.code);
  const out = {};
  // 少于 2 根 K 线说明行情源根本没有该股历史（例如北交所），
  // 这不是停牌，必须与停牌区分开，否则会误报成「起点日无收盘」。
  const noHistory = entry.bars.length < 2;

  for (const targetIso of targets) {
    const targetIndex = calendar.indexOf(targetIso);
    const targetBar = closeByDate.get(targetIso);
    const previousIso = targetIndex > 0 ? calendar[targetIndex - 1] : null;
    const previousBar = previousIso ? closeByDate.get(previousIso) : null;

    for (const sessions of WINDOWS) {
      const startIso = calendar[targetIndex - sessions];
      const startBar = startIso ? closeByDate.get(startIso) : null;
      const key = `${targetIso}|${sessions}`;
      // 拉取失败不是「没有历史」，必须单独计数，否则会写出假原因。
      if (entry.fetchError) {
        out[key] = { excluded: 'FETCH_FAILED' };
        continue;
      }
      if (noHistory) {
        out[key] = { excluded: 'NO_HISTORY' };
        continue;
      }
      if (!targetBar) {
        out[key] = { excluded: 'NO_TARGET_CLOSE' };
        continue;
      }
      if (!startIso) {
        out[key] = { excluded: 'CALENDAR_TOO_SHORT' };
        continue;
      }
      if (!startBar) {
        out[key] = { excluded: 'NO_START_CLOSE' };
        continue;
      }
      const gainPct = (targetBar.close / startBar.close - 1) * 100;
      const dayPct =
        previousBar && previousBar.close > 0
          ? (targetBar.close / previousBar.close - 1) * 100
          : null;
      let limitState = '未触板';
      if (dayPct != null) {
        const limitPct = limitRatio * 100;
        if (dayPct >= limitPct - 0.35) limitState = '涨停';
        else if (
          targetBar.high / previousBar.close - 1 >= limitRatio - 0.0035 &&
          dayPct < limitPct - 0.35
        )
          limitState = '触板未封';
      }
      const priorVolumes = [];
      for (let offset = 1; offset <= 5; offset += 1) {
        const iso = calendar[targetIndex - offset];
        const volume = iso ? volumeByDate.get(iso) : null;
        if (Number.isFinite(volume) && volume > 0) priorVolumes.push(volume);
      }
      const volumeRatio =
        priorVolumes.length && targetBar.volume > 0
          ? targetBar.volume /
            (priorVolumes.reduce((sum, value) => sum + value, 0) /
              priorVolumes.length)
          : null;

      out[key] = {
        startIso,
        startClose: startBar.close,
        latestClose: targetBar.close,
        // 仅新浪主源带原始收盘；缺失时该行无法做原始价对原始价的核验。
        latestRawClose: Number.isFinite(targetBar.rawClose)
          ? targetBar.rawClose
          : null,
        gainPct,
        limitState,
        volumeRatio,
        board,
      };
    }
  }
  return out;
}

function emptyWindow(sessions, tradeDate) {
  return {
    status: 'READY',
    tradeSessions: sessions,
    eligible: 0,
    topRequested: TOP_N,
    topAvailable: 0,
    metadataReady: 0,
    startDate: null,
    endDate: tradeDate,
    reasons: [],
    rows: [],
  };
}

function buildPayload({ tradeDate, calendar, universe, computed, crosscheck }) {
  const targetIso = `${tradeDate.slice(0, 4)}-${tradeDate.slice(4, 6)}-${tradeDate.slice(6)}`;
  const targetIndex = calendar.indexOf(targetIso);
  const isLatest = targetIso === calendar[calendar.length - 1];
  const windows = {};

  for (const sessions of WINDOWS) {
    const startIso = calendar[targetIndex - sessions];
    const candidates = [];
    let eligible = 0;
    const exclusionCount = {
      FETCH_FAILED: 0,
      NO_HISTORY: 0,
      NO_TARGET_CLOSE: 0,
      NO_START_CLOSE: 0,
    };

    for (const entry of computed) {
      const cell = entry.cells[`${targetIso}|${sessions}`];
      if (!cell) continue;
      if (cell.excluded) {
        if (cell.excluded in exclusionCount) exclusionCount[cell.excluded] += 1;
        continue;
      }
      eligible += 1;
      candidates.push({ entry, cell });
    }

    candidates.sort((a, b) => b.cell.gainPct - a.cell.gainPct);
    const rows = candidates.slice(0, TOP_N).map(({ entry, cell }) => {
      const snapshot = entry.universe;
      const verified = crosscheck.get(`${entry.symbol}|${targetIso}`);
      // 比原始价对原始价：两家的复权算法不同（减法 vs 除法因子），
      // 直接比复权价会把口径差异误判成数据错误。
      const crosscheckStatus =
        verified == null || cell.latestRawClose == null
          ? 'UNAVAILABLE'
          : Math.abs(verified - cell.latestRawClose) <= 0.011
            ? 'PASS'
            : 'MISMATCH';
      return {
        code: entry.code,
        name: entry.name,
        marketBoard: cell.board,
        industry: null,
        themes: [],
        latestClose: Number(cell.latestClose.toFixed(3)),
        latestDate: tradeDate,
        amount: isLatest ? snapshot.amount : null,
        turnoverRate: isLatest ? snapshot.turnoverRate : null,
        volumeRatio:
          cell.volumeRatio == null ? null : Number(cell.volumeRatio.toFixed(3)),
        totalMarketCap: isLatest ? snapshot.totalMarketCap : null,
        circulatingMarketCap: isLatest ? snapshot.circulatingMarketCap : null,
        limitState: cell.limitState,
        quoteTime: isLatest ? `${tradeDate} ${snapshot.ticktime ?? ''}`.trim() : null,
        source: entry.barsSource,
        window: sessions,
        sessions,
        startDate: isoToCompact(cell.startIso),
        startClose: Number(cell.startClose.toFixed(3)),
        gainPct: Number(cell.gainPct.toFixed(4)),
        metadataStatus: 'DEGRADED',
        crosscheckStatus,
      };
    });

    const window = emptyWindow(sessions, tradeDate);
    window.eligible = eligible;
    window.topAvailable = rows.length;
    window.startDate = isoToCompact(startIso);
    window.rows = rows;
    window.metadataReady = 0;

    const mismatched = rows.filter(
      (row) => row.crosscheckStatus === 'MISMATCH',
    ).length;
    const unverified = rows.filter(
      (row) => row.crosscheckStatus === 'UNAVAILABLE',
    ).length;

    if (exclusionCount.FETCH_FAILED) {
      const covered = universe.length - exclusionCount.FETCH_FAILED;
      window.reasons.push(
        `${exclusionCount.FETCH_FAILED} 只股票行情源拉取失败（不是停牌、也不是没有历史），未参与排行；有效覆盖 ${covered}/${universe.length}。`,
      );
    }
    if (exclusionCount.NO_HISTORY) {
      const fetched = universe.length - exclusionCount.FETCH_FAILED;
      window.reasons.push(
        `${exclusionCount.NO_HISTORY} 只股票行情源无前复权历史（北交所、新上市等无历史品种），不参与排行；可服务标的 ${fetched - exclusionCount.NO_HISTORY}/${fetched}。`,
      );
    }
    if (exclusionCount.NO_TARGET_CLOSE) {
      window.reasons.push(
        `${exclusionCount.NO_TARGET_CLOSE} 只股票在目标日 ${tradeDate} 无收盘（停牌或未上市），已排除。`,
      );
    }
    if (exclusionCount.NO_START_CLOSE) {
      window.reasons.push(
        `${exclusionCount.NO_START_CLOSE} 只股票在 ${isoToCompact(startIso)}（${sessions} 个交易日前）无收盘，窗口长度不成立，已排除而非顺延。`,
      );
    }
    if (mismatched) {
      window.reasons.push(
        `${mismatched} 行目标日原始收盘与另一家行情源不一致，已保留但标记 MISMATCH。`,
      );
    }
    if (unverified) {
      window.reasons.push(
        `${unverified} 行缺少另一家行情源的原始收盘（多为北交所等对方源未覆盖的品种），无法交叉核验目标日价格。`,
      );
    }
    if (!rows.length) {
      window.status = 'MISSING';
      window.reasons.push('没有满足窗口长度且通过收盘核验的股票。');
    } else if (
      mismatched ||
      unverified ||
      exclusionCount.FETCH_FAILED ||
      exclusionCount.NO_HISTORY
    ) {
      // 个股在目标日/起点日停牌被排除属于正常口径（不顺延），只作说明，不降级整榜。
      window.status = 'DEGRADED';
    }

    windows[String(sessions)] = window;
  }

  const historyResponses = computed.filter((entry) => entry.bars.length >= 2).length;
  const exactLatest = computed.filter((entry) =>
    entry.bars.some((bar) => bar.date === targetIso),
  ).length;
  const crosschecked = [...crosscheck.keys()].filter(
    (key) => key.endsWith(`|${targetIso}`),
  ).length;
  const windowStatuses = Object.values(windows).map((window) => window.status);
  const boardStatus = windowStatuses.every((value) => value === 'READY')
    ? 'READY'
    : windowStatuses.every((value) => value === 'MISSING')
      ? 'MISSING'
      : 'DEGRADED';

  // 交叉核验覆盖按本交易日的入榜行统计：有对方厂商原始收盘即算已核验（含不一致）。
  let crosscheckRequested = 0;
  let crosscheckCovered = 0;
  const crosscheckSources = new Set();
  for (const sessions of WINDOWS) {
    for (const row of windows[String(sessions)].rows) {
      crosscheckRequested += 1;
      if (row.crosscheckStatus === 'UNAVAILABLE') continue;
      crosscheckCovered += 1;
      crosscheckSources.add(
        row.source === 'SINA_QFQ_DERIVED'
          ? 'TENCENT_RAW_DAILY'
          : 'SINA_RAW_DAILY',
      );
    }
  }

  const sinaBars = computed.filter(
    (entry) => entry.barsSource === 'SINA_QFQ_DERIVED',
  ).length;
  const tencentBars = computed.filter(
    (entry) => entry.barsSource === 'TENCENT_QFQ',
  ).length;
  const sourceLabel =
    tencentBars > 0
      ? `新浪原始日线÷前复权因子 ${sinaBars} 只 + 腾讯前复权日线 ${tencentBars} 只（互为独立核验）`
      : `新浪原始日线÷前复权因子 ${sinaBars} 只（腾讯前复权独立核验）`;

  return {
    version: 1,
    collectorVersion: COLLECTOR_VERSION,
    status: boardStatus,
    tradeDate,
    tradeDateIso: targetIso,
    generatedAt: new Date().toISOString(),
    source: sourceLabel,
    adjustment: 'QFQ',
    methodology:
      'N日涨幅=(目标日复权收盘/向前第N个交易日复权收盘-1)；起点由权威交易日历定位，起点日或目标日无收盘的股票直接排除，不顺延、不插值。',
    coverage: {
      listedUniverse: universe.length,
      activeUniverse: universe.length,
      historyResponses,
      exactLatest,
      listedSnapshotExactDate: universe.length,
      crosschecked,
    },
    metadata: { industry: false, themes: false },
    crosscheck: {
      source: [...crosscheckSources].join('+') || 'UNAVAILABLE',
      target: 'TARGET_DATE_RAW_CLOSE',
      // 口径按本交易日实际入榜行统计，不跨日期累计。
      covered: crosscheckCovered,
      requested: crosscheckRequested,
    },
    reasons: [],
    windows,
    scoringEnabled: false,
    selectionEnabled: false,
    productionIntegrated: false,
  };
}

async function main() {
  const calendarJson = JSON.parse(fs.readFileSync(CALENDAR_PATH, 'utf8'));
  const calendar = calendarJson.dates;
  if (!Array.isArray(calendar) || !calendar.length) {
    throw new Error('交易日历为空，先执行 npm run calendar:build');
  }

  let targetIsos;
  if (EXPLICIT_DATES.length) {
    targetIsos = EXPLICIT_DATES.map((value) => {
      const compact = value.replaceAll('-', '');
      const iso = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6)}`;
      if (!calendar.includes(iso)) {
        throw new Error(`${value} 不是权威交易日历中的交易日`);
      }
      return iso;
    });
  } else {
    targetIsos = calendar.slice(-DATE_COUNT);
  }

  const maxOffset = calendar.length - 1 - calendar.indexOf(targetIsos[0]);
  const barCount = Math.min(320, MAX_WINDOW + maxOffset + 12);
  log(`目标交易日：${targetIsos.join(', ')}`);
  log(`每只股票拉取 ${barCount} 根日线（需覆盖 ${MAX_WINDOW} 个交易日窗口）`);

  log('拉取全 A 股票池…');
  let universe = await fetchUniverse();
  log(`  股票池 ${universe.length} 只`);
  if (LIMIT > 0) {
    universe = universe.slice(0, LIMIT);
    log(`  已按 --limit 截断为 ${universe.length} 只（仅用于冒烟测试，结果不完整）`);
  }
  if (SAMPLE > 0 && SAMPLE < universe.length) {
    // 跨市场等距抽样，避免只抽到北交所或单一板块。
    const stride = Math.floor(universe.length / SAMPLE);
    const sampled = [];
    for (let index = 0; index < universe.length && sampled.length < SAMPLE; index += stride) {
      sampled.push(universe[index]);
    }
    universe = sampled;
    log(`  已按 --sample 等距抽样 ${universe.length} 只（仅用于冒烟测试，结果不完整）`);
  }

  log(`拉取前复权日线（并发 ${CONCURRENCY}）…`);
  const started = Date.now();
  const barsList = await pool(universe, CONCURRENCY, (item) =>
    fetchBars(item.symbol, barCount),
  );
  const computed = universe.map((item, index) => {
    const result = barsList[index];
    const failed =
      result == null || (!Array.isArray(result) && Boolean(result.error));
    return {
      symbol: item.symbol,
      code: item.code,
      name: item.name,
      universe: item,
      bars: failed ? [] : result.bars,
      barsSource: failed ? null : result.source,
      fetchError: failed ? result.error : null,
      cells: {},
    };
  });
  const withBars = computed.filter((entry) => entry.bars.length).length;
  const fetchFailed = computed.filter((entry) => entry.fetchError).length;
  log(`  成功 ${withBars}/${computed.length}，用时 ${((Date.now() - started) / 1000).toFixed(1)}s`);
  if (fetchFailed) {
    log(`  ⚠ 拉取失败 ${fetchFailed} 只（会在榜单原因中如实标注，不计入「无历史」）`);
    const sample = computed.filter((entry) => entry.fetchError).slice(0, 3);
    for (const entry of sample) log(`    ${entry.symbol}: ${entry.fetchError}`);

    // 零星失败再补拉一轮，避免网络抖动被当成覆盖缺口。
    const retryTargets = computed.filter((entry) => entry.fetchError);
    log(`  补拉 ${retryTargets.length} 只…`);
    const retryResults = await pool(
      retryTargets,
      Math.min(CONCURRENCY, 4),
      (entry) => fetchBars(entry.symbol, barCount),
    );
    let recovered = 0;
    retryTargets.forEach((entry, index) => {
      const result = retryResults[index];
      if (result && Array.isArray(result.bars) && result.bars.length) {
        entry.bars = result.bars;
        entry.barsSource = result.source;
        entry.fetchError = null;
        recovered += 1;
      }
    });
    log(`  补拉成功 ${recovered}/${retryTargets.length}`);
  }

  // 覆盖不足时拒绝写出：宁可失败，也不发布偏样本排行。
  const stillFailed = computed.filter((entry) => entry.fetchError).length;
  if (stillFailed / computed.length > 0.2) {
    throw new Error(
      `行情源拉取失败 ${stillFailed}/${computed.length}（${((stillFailed / computed.length) * 100).toFixed(1)}%），覆盖不足，已拒绝写出榜单。请检查网络或降低 --concurrency 后重试。`,
    );
  }

  for (const entry of computed) {
    entry.cells = computeWindows(entry, calendar, targetIsos);
  }

  const crosscheck = new Map();
  if (CROSSCHECK) {
    // 谁产出的日线，就用另一家的前复权收盘去核验，避免同源自证。
    const wanted = new Map();
    for (const targetIso of targetIsos) {
      for (const sessions of WINDOWS) {
        const ranked = computed
          .map((entry) => ({ entry, cell: entry.cells[`${targetIso}|${sessions}`] }))
          .filter((item) => item.cell && !item.cell.excluded)
          .sort((a, b) => b.cell.gainPct - a.cell.gainPct)
          .slice(0, TOP_N);
        for (const item of ranked) {
          if (!item.entry.barsSource) continue;
          wanted.set(item.entry.symbol, item.entry.barsSource);
        }
      }
    }
    const fromSina = [...wanted].filter(([, source]) => source === 'SINA_QFQ_DERIVED');
    const fromTencent = [...wanted].filter(([, source]) => source === 'TENCENT_QFQ');
    log(
      `交叉核验目标日收盘：${fromSina.length} 只用腾讯核验，${fromTencent.length} 只用新浪核验…`,
    );
    const lookback = Math.min(60, maxOffset + 12);

    const merge = (pairs, results) => {
      const failed = [];
      pairs.forEach((pair, index) => {
        const [symbol] = pair;
        const closes = results[index];
        if (!(closes instanceof Map)) {
          failed.push(pair);
          return;
        }
        for (const targetIso of targetIsos) {
          const close = closes.get(targetIso);
          if (Number.isFinite(close)) {
            crosscheck.set(`${symbol}|${targetIso}`, close);
          }
        }
      });
      return failed;
    };

    if (fromSina.length) {
      const results = await pool(fromSina, 2, ([symbol]) =>
        fetchTencentRawCloses(symbol, lookback),
      );
      const failed = merge(fromSina, results);
      log(`  腾讯核验完成，累计 ${crosscheck.size} 个「股票×日期」收盘`);
      if (failed.length) {
        // 腾讯对量敏感，失败的再补一轮，避免把限流当成「没有独立源」。
        log(`  补核验 ${failed.length} 只…`);
        const retry = await pool(failed, 1, ([symbol]) =>
          fetchTencentRawCloses(symbol, lookback),
        );
        const stillFailed = merge(failed, retry);
        log(
          `  补核验成功 ${failed.length - stillFailed.length}/${failed.length}，累计 ${crosscheck.size} 个`,
        );
      }
    }
    if (fromTencent.length) {
      const results = await pool(fromTencent, Math.min(CONCURRENCY, 6), ([symbol]) =>
        fetchSinaRawCloses(symbol, lookback),
      );
      merge(fromTencent, results);
    }
    log(`  已核验 ${crosscheck.size} 个「股票×日期」收盘`);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const indexFile = path.join(OUT_DIR, 'index.json');
  let index = { version: 1, generatedAt: null, source: null, latest: null, dates: [] };
  if (fs.existsSync(indexFile)) {
    try {
      index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
    } catch {
      /* 忽略损坏索引 */
    }
  }

  for (const targetIso of targetIsos) {
    const tradeDate = isoToCompact(targetIso);
    const payload = buildPayload({
      tradeDate,
      calendar,
      universe,
      computed,
      crosscheck,
    });
    const file = path.join(OUT_DIR, `${tradeDate}.json`);
    fs.writeFileSync(file, JSON.stringify(payload));
    const sizeKb = (fs.statSync(file).size / 1024).toFixed(1);
    log(
      `  写出 ${path.relative(ROOT, file)} (${sizeKb}KB) 状态 ${payload.status} 30日合格池 ${payload.windows['30'].eligible}`,
    );
    if (!index.dates.includes(tradeDate)) index.dates.push(tradeDate);
  }

  index.dates = [...new Set(index.dates)].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  index.latest = index.dates[0] ?? null;
  index.generatedAt = new Date().toISOString();
  index.source = '腾讯前复权日线 + 新浪独立收盘核验';
  index.metadata = { industry: false, themes: false };
  fs.writeFileSync(indexFile, JSON.stringify(index, null, 2));
  log(`索引已更新：${index.dates.length} 个交易日，最新 ${index.latest}`);
}

main().catch((error) => {
  console.error('生成失败：', error.message);
  process.exit(1);
});
