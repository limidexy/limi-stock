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
 *   - 股票池与最新快照：新浪 Market_Center（hs_a 全 A）
 *   - 前复权日线：腾讯 ifzq（qfq）
 *   - 目标日收盘交叉核验：新浪 CN_MarketData 日线（独立厂商）
 *     ＊ 前复权只把最新一根对齐真实价，因此只核验目标日收盘，不核验起点收盘。
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

const ROOT = path.resolve(import.meta.dirname, '..');
const CALENDAR_PATH = path.join(ROOT, 'lib/trading-calendar.generated.json');
const TOP_N = 30;
const WINDOWS = [5, 10, 20, 30];
const MAX_WINDOW = Math.max(...WINDOWS);
const COLLECTOR_VERSION = 'v1.0-local-multi-window-rankings';

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
const CONCURRENCY = Number(argValue('--concurrency', '8'));
const OUT_DIR = path.resolve(ROOT, argValue('--out', 'public/rankings'));
const CACHE_DIR = path.resolve(ROOT, argValue('--cache', '.cache/rankings'));
const USE_CACHE = !args.includes('--no-cache');
const CROSSCHECK = !args.includes('--no-crosscheck');

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
    const text = await httpsGet(url, HEADERS);
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
 * 腾讯前复权日线有多套等价入口。web.ifzq 与 ifzq 会被 WAF 限流（501），
 * proxy.finance.qq.com 通常可用，因此按顺序轮换，任一可用即返回。
 */
const KLINE_HOSTS = [
  'https://proxy.finance.qq.com/ifzqgtimg',
  'https://ifzq.gtimg.cn',
];

async function fetchKlineJson(symbol, count) {
  const query = `/appstock/app/fqkline/get?param=${symbol},day,,,${count},qfq`;
  let lastError = null;
  for (const host of KLINE_HOSTS) {
    try {
      const json = await getJson(`${host}${query}`);
      const node = json?.data?.[symbol];
      const raw = node?.qfqday ?? node?.day ?? [];
      if (raw.length) return raw;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return [];
}

async function fetchBars(symbol, count) {
  const cacheFile = path.join(CACHE_DIR, `${symbol}.json`);
  if (USE_CACHE && fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (cached.count >= count && Date.now() - cached.at < 20 * 3_600_000) {
        return cached.bars;
      }
    } catch {
      /* 缓存损坏则重新拉取 */
    }
  }
  const raw = await fetchKlineJson(symbol, count);
  const bars = raw.map((row) => ({
    date: row[0],
    open: Number(row[1]),
    close: Number(row[2]),
    high: Number(row[3]),
    low: Number(row[4]),
    volume: Number(row[5]),
  }));
  if (USE_CACHE && bars.length) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify({ at: Date.now(), count, bars }));
  }
  return bars;
}

async function fetchSinaCloses(symbol, count) {
  const url = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${symbol}&scale=240&ma=no&datalen=${count}`;
  const json = await getJson(url);
  if (!Array.isArray(json)) return new Map();
  return new Map(json.map((row) => [row.day, Number(row.close)]));
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
      const crosscheckStatus =
        verified == null
          ? 'UNAVAILABLE'
          : Math.abs(verified - cell.latestClose) <= 0.011
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
        source: 'TENCENT_QFQ_DAILY+SINA_CLOSE_CROSSCHECK',
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

    if (exclusionCount.NO_HISTORY) {
      window.reasons.push(
        `${exclusionCount.NO_HISTORY} 只股票行情源无前复权历史（主要为北交所），不参与排行；有效覆盖 ${universe.length - exclusionCount.NO_HISTORY}/${universe.length}。`,
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
        `${mismatched} 行目标日收盘与新浪独立收盘不一致，已保留但标记 MISMATCH。`,
      );
    }
    if (unverified) {
      window.reasons.push(
        `${unverified} 行缺少独立收盘源，无法交叉核验目标日收盘。`,
      );
    }
    if (!rows.length) {
      window.status = 'MISSING';
      window.reasons.push('没有满足窗口长度且通过收盘核验的股票。');
    } else if (
      mismatched ||
      unverified ||
      exclusionCount.NO_HISTORY ||
      exclusionCount.NO_START_CLOSE
    ) {
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

  // 交叉核验覆盖按本交易日的入榜行统计：有独立源收盘即算已核验（含不一致）。
  let crosscheckRequested = 0;
  let crosscheckCovered = 0;
  for (const sessions of WINDOWS) {
    for (const row of windows[String(sessions)].rows) {
      crosscheckRequested += 1;
      if (row.crosscheckStatus !== 'UNAVAILABLE') crosscheckCovered += 1;
    }
  }

  return {
    version: 1,
    collectorVersion: COLLECTOR_VERSION,
    status: boardStatus,
    tradeDate,
    tradeDateIso: targetIso,
    generatedAt: new Date().toISOString(),
    source: '腾讯前复权日线 + 新浪全A股票池/独立收盘核验',
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
      source: 'SINA_CN_MARKETDATA_DAILY',
      target: 'TARGET_DATE_CLOSE_ONLY',
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
    const bars = Array.isArray(barsList[index]) ? barsList[index] : [];
    return {
      symbol: item.symbol,
      code: item.code,
      name: item.name,
      universe: item,
      bars,
      cells: {},
    };
  });
  const withBars = computed.filter((entry) => entry.bars.length).length;
  log(`  成功 ${withBars}/${computed.length}，用时 ${((Date.now() - started) / 1000).toFixed(1)}s`);

  for (const entry of computed) {
    entry.cells = computeWindows(entry, calendar, targetIsos);
  }

  const crosscheck = new Map();
  if (CROSSCHECK) {
    log('交叉核验目标日收盘（新浪独立源）…');
    const wanted = new Set();
    for (const targetIso of targetIsos) {
      for (const sessions of WINDOWS) {
        const ranked = computed
          .map((entry) => ({ entry, cell: entry.cells[`${targetIso}|${sessions}`] }))
          .filter((item) => item.cell && !item.cell.excluded)
          .sort((a, b) => b.cell.gainPct - a.cell.gainPct)
          .slice(0, TOP_N);
        for (const item of ranked) wanted.add(item.entry.symbol);
      }
    }
    const symbols = [...wanted];
    const lookback = Math.min(60, maxOffset + 12);
    const results = await pool(symbols, Math.min(CONCURRENCY, 6), (symbol) =>
      fetchSinaCloses(symbol, lookback),
    );
    symbols.forEach((symbol, index) => {
      const closes = results[index];
      if (!(closes instanceof Map)) return;
      for (const targetIso of targetIsos) {
        const close = closes.get(targetIso);
        if (Number.isFinite(close)) crosscheck.set(`${symbol}|${targetIso}`, close);
      }
    });
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
