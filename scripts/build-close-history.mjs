import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const projectRoot = process.cwd();
const workspaceRoot = path.resolve(projectRoot, '..');
const outputsRoot = path.join(workspaceRoot, 'outputs');
const marketRoot = path.join(workspaceRoot, 'data', 'market');
const fullMarketMinuteRoot = path.join(
  workspaceRoot,
  'data',
  'full_market_minute_supplements_v253',
);
const ladderCandidateMinuteRoot = path.join(
  workspaceRoot,
  'data',
  'ladder_candidate_minute_v256',
);
const outputPath = path.join(
  projectRoot,
  'lib',
  'close-history.generated.json',
);
const calendarPath = path.join(
  projectRoot,
  'lib',
  'trading-calendar.generated.json',
);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readGzipJson(filePath) {
  return JSON.parse(
    zlib.gunzipSync(fs.readFileSync(filePath)).toString('utf8'),
  );
}

function formatDate(value) {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function normalizeStock(row) {
  return {
    code: String(row.c ?? row.code ?? ''),
    name: String(row.n ?? row.name ?? '').replace(/\s+/g, ''),
    changePct: Number.isFinite(row.zdp)
      ? row.zdp
      : Number.isFinite(row.changePct)
        ? row.changePct
        : null,
    industry: String(row.hybk ?? row.industry ?? '未分类'),
    height: Math.max(1, Number(row.lbc ?? row.height ?? 1)),
    firstTouch: row.fbt == null ? null : String(row.fbt).padStart(6, '0'),
    lastSeal: row.lbt == null ? null : String(row.lbt).padStart(6, '0'),
    breakCount: Number(row.zbc ?? row.breakCount ?? 0),
    sealFund: Number.isFinite(row.fund) ? row.fund : null,
  };
}

function clock(value) {
  if (!value || value.length < 4) return null;
  return `${value.slice(0, 2)}:${value.slice(2, 4)}`;
}

function indexMood(breadth) {
  const available = Math.max(1, breadth.rowsAvailable);
  const upRatio = breadth.up / available;
  if (breadth.medianChangePct >= 0.8 || upRatio >= 0.68) return '强势';
  if (breadth.medianChangePct >= 0.2 || upRatio >= 0.56) return '偏强';
  if (breadth.medianChangePct > -0.25) return '震荡';
  if (breadth.medianChangePct > -0.85) return '偏弱';
  return '弱势';
}

function shortMood({ limitUp, failed, limitDown, sealRate, highestBoard }) {
  if (limitUp >= 80 && sealRate >= 80 && limitDown <= 3) return '高潮';
  if (limitUp >= 65 && sealRate >= 72 && highestBoard >= 5) return '强势';
  if (limitDown >= 12 || (sealRate < 58 && failed >= 28)) return '退潮';
  if (failed >= 25 || sealRate < 68) return '高分歧';
  if (limitUp < 45 && limitDown >= 8) return '弱修复';
  return '轮动';
}

function cycleNode({
  limitUp,
  failed,
  limitDown,
  sealRate,
  highestBoard,
  breadthMood,
}) {
  if (breadthMood === '强势' && limitUp >= 75 && sealRate >= 78)
    return '主升确认';
  if (limitDown >= 12 || (failed >= 30 && sealRate < 60)) return '强分歧';
  if (breadthMood === '弱势' && limitUp < 60) return '退潮释放';
  if ((breadthMood === '强势' || breadthMood === '偏强') && highestBoard >= 4)
    return '弱转强';
  if (failed >= 20 || sealRate < 72) return '分歧轮动';
  return '弱修复';
}

function marketPackagePath(date, file) {
  const closePath = path.join(marketRoot, date, 'CLOSE', file);
  if (fs.existsSync(closePath)) return closePath;
  const legacyPath = path.join(marketRoot, date, file);
  return fs.existsSync(legacyPath) ? legacyPath : null;
}

function readIndexCloses(date) {
  const filePath = marketPackagePath(date, 'minute_ohlcv.jsonl.gz');
  const dailyPath = marketPackagePath(date, 'daily_ohlcv.jsonl.gz');
  if (!filePath && !dailyPath) return {};
  const lines = zlib
    .gunzipSync(fs.readFileSync(filePath ?? dailyPath))
    .toString('utf8')
    .trim()
    .split('\n');
  const wanted = new Set(['sh000001', 'sz399001', 'sz399006']);
  const result = {};
  for (const line of lines) {
    const row = JSON.parse(line);
    if (!wanted.has(row.symbol)) continue;
    if (Array.isArray(row.rows) && row.rows.length) {
      const last =
        [...row.rows].reverse().find((point) => point.time === '15:00') ??
        row.rows.at(-1);
      result[row.symbol] = Number.isFinite(last?.close) ? last.close : null;
    } else {
      result[row.symbol] = Number.isFinite(row.close) ? row.close : null;
    }
  }
  return result;
}

function readMinuteArchiveCloseQuotes(root, date, wantedCodes) {
  const directory = path.join(root, date);
  const manifestPath = path.join(directory, 'manifest.json');
  const artifactPath = path.join(directory, 'minute_paths.jsonl.gz');
  if (!fs.existsSync(manifestPath) || !fs.existsSync(artifactPath)) return {};
  const manifest = readJson(manifestPath);
  if (
    manifest.status !== 'READY' ||
    manifest.tradeDate !== date ||
    !Number.isFinite(manifest.requested) ||
    manifest.requested <= 0 ||
    manifest.available !== manifest.requested ||
    manifest.intervalCounts?.['1'] !== manifest.requested
  )
    return {};
  const lines = zlib
    .gunzipSync(fs.readFileSync(artifactPath))
    .toString('utf8')
    .trim()
    .split('\n');
  const wanted = new Set(wantedCodes);
  const quotes = {};
  let validRows = 0;
  for (const line of lines) {
    const row = JSON.parse(line);
    if (
      row.tradeDate !== date ||
      Number(row.intervalMinutes) !== 1 ||
      !Array.isArray(row.rows) ||
      row.rows.length !== 241 ||
      row.rows.at(-1)?.time !== '15:00' ||
      !Number.isFinite(row.preClose) ||
      row.preClose <= 0 ||
      !Number.isFinite(row.rows.at(-1)?.close)
    )
      continue;
    validRows += 1;
    if (wanted.has(String(row.code))) {
      const last = row.rows.at(-1);
      const speedBase = row.rows.find((point) => point.time === '14:55');
      quotes[String(row.code)] = {
        changePct: (row.rows.at(-1).close / row.preClose - 1) * 100,
        speedPct:
          Number.isFinite(speedBase?.close) && speedBase.close > 0
            ? (last.close / speedBase.close - 1) * 100
            : null,
        quoteTime: `${formatDate(date)}T15:00:00+08:00`,
        source: `${row.provider ?? '精确日期分钟源'} 1分钟全市场归档（241点）`,
      };
    }
  }
  return validRows === manifest.requested ? quotes : {};
}

function readClosePackageQuotes(structure, date, wantedCodes) {
  const wanted = new Set(wantedCodes);
  const quotes = {};
  for (const row of structure?.breadth?.rows ?? []) {
    const code = String(row.code ?? '').padStart(6, '0');
    if (!wanted.has(code)) continue;
    const changePct = Number.isFinite(row.changePct)
      ? Number(row.changePct)
      : Number.isFinite(row.price) &&
          Number.isFinite(row.previousClose) &&
          row.previousClose > 0
        ? (row.price / row.previousClose - 1) * 100
        : null;
    if (!Number.isFinite(changePct)) continue;
    quotes[code] = {
      changePct,
      quoteTime: `${formatDate(date)}T15:00:00+08:00`,
      source: '精确交易日READY CLOSE全市场15:00收盘包',
    };
  }
  return quotes;
}

const dates = new Set();
if (fs.existsSync(outputsRoot)) {
  for (const name of fs.readdirSync(outputsRoot)) {
    if (
      /^2026\d{4}$/.test(name) &&
      fs.existsSync(
        path.join(outputsRoot, name, 'raw', `close_summary_${name}.json`),
      )
    )
      dates.add(name);
  }
}
if (fs.existsSync(marketRoot)) {
  for (const name of fs.readdirSync(marketRoot)) {
    if (
      /^2026\d{4}$/.test(name) &&
      marketPackagePath(name, 'structure.json.gz')
    )
      dates.add(name);
  }
}

const sortedDates = [...dates].sort((a, b) => a.localeCompare(b));
const indexCloseByDate = new Map(
  sortedDates.map((date) => [date, readIndexCloses(date)]),
);
const snapshots = [];

for (const date of sortedDates) {
  const summaryPath = path.join(
    outputsRoot,
    date,
    'raw',
    `close_summary_${date}.json`,
  );
  const structurePath = marketPackagePath(date, 'structure.json.gz');
  const manifestPath = marketPackagePath(date, 'manifest.json');
  const summary = fs.existsSync(summaryPath) ? readJson(summaryPath) : null;
  const structure = structurePath ? readGzipJson(structurePath) : null;
  const manifest = manifestPath ? readJson(manifestPath) : null;
  if (
    manifest &&
    (manifest.status !== 'READY' ||
      manifest.tradeDate !== date ||
      manifest.sessionKind !== 'CLOSE' ||
      manifest.marketDataCutoff !== '15:00')
  )
    continue;
  const exactCutoff =
    summary?.cutoff ??
    structure?.marketDataCutoff ??
    manifest?.marketDataCutoff;
  if (exactCutoff !== '15:00' && structure?.sessionKind !== 'CLOSE') continue;

  const limitUpRows = (
    summary?.limit_up_by_height ??
    structure?.pools?.limit_up?.rows ??
    []
  ).map(normalizeStock);
  const failedRows = (
    summary?.failed_rows ??
    structure?.pools?.failed_board?.rows ??
    []
  ).map(normalizeStock);
  const limitDownRows = (
    summary?.limit_down_rows ??
    structure?.pools?.limit_down?.rows ??
    []
  ).map(normalizeStock);
  const breadthSource = summary?.breadth ?? structure?.breadth?.summary ?? {};
  const breadth = {
    requested: Number(
      breadthSource.universe_requested ?? breadthSource.universeReported ?? 0,
    ),
    rowsAvailable: Number(
      breadthSource.rows_available ?? breadthSource.rowsAvailable ?? 0,
    ),
    up: Number(breadthSource.up ?? 0),
    down: Number(breadthSource.down ?? 0),
    flat: Number(breadthSource.flat ?? 0),
    medianChangePct: Number(
      breadthSource.median_change_pct ?? breadthSource.medianChangePct ?? 0,
    ),
  };
  const limitUp = Number(summary?.limit_up_count ?? limitUpRows.length);
  const failed = Number(summary?.failed_board_count ?? failedRows.length);
  const limitDown = Number(summary?.limit_down_count ?? limitDownRows.length);
  const sealRate = limitUp + failed ? (limitUp / (limitUp + failed)) * 100 : 0;
  const highestBoard = Math.max(0, ...limitUpRows.map((row) => row.height));
  const consecutiveCount = limitUpRows.filter((row) => row.height >= 2).length;
  const industryCounts = new Map();
  for (const stock of limitUpRows)
    industryCounts.set(
      stock.industry,
      (industryCounts.get(stock.industry) ?? 0) + 1,
    );
  const concentratedIndustries = [...industryCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));
  const ladders = [...new Set(limitUpRows.map((row) => row.height))]
    .sort((a, b) => b - a)
    .map((height) => ({
      height,
      stocks: limitUpRows
        .filter((row) => row.height === height)
        .sort(
          (a, b) =>
            (a.firstTouch ?? '999999').localeCompare(
              b.firstTouch ?? '999999',
            ) || b.sealFund - a.sealFund,
        )
        .map((row) => ({
          ...row,
          firstTouch: clock(row.firstTouch),
          lastSeal: clock(row.lastSeal),
        })),
    }));
  const mood = indexMood(breadth);
  const moodInput = {
    limitUp,
    failed,
    limitDown,
    sealRate,
    highestBoard,
    breadthMood: mood,
  };
  const declaredPreviousDate = String(
    structure?.previousTradingDate ?? '',
  ).replace(/\D/g, '');
  const previousDate = /^\d{8}$/.test(declaredPreviousDate)
    ? declaredPreviousDate
    : undefined;
  const previousSnapshot = previousDate
    ? snapshots.find((snapshot) => snapshot.date === formatDate(previousDate))
    : undefined;
  const previousPoolCodes =
    previousSnapshot?.ladders.flatMap((level) =>
      level.stocks.map((stock) => stock.code),
    ) ?? [];
  const currentCloses = indexCloseByDate.get(date) ?? {};
  const previousCloses = previousDate
    ? (indexCloseByDate.get(previousDate) ?? {})
    : {};
  const indices = [
    ['sh000001', '上证'],
    ['sz399001', '深证'],
    ['sz399006', '创业板'],
  ].map(([code, name]) => {
    const close = currentCloses[code];
    const previousClose = previousCloses[code];
    return {
      code,
      name,
      close: Number.isFinite(close) ? close : null,
      changePct:
        Number.isFinite(close) &&
        Number.isFinite(previousClose) &&
        previousClose > 0
          ? (close / previousClose - 1) * 100
          : null,
    };
  });

  snapshots.push({
    date: formatDate(date),
    previousDate: previousDate ? formatDate(previousDate) : undefined,
    cutoff: '15:00',
    status: 'READY',
    source: structure
      ? `CLOSE收盘包 ${structure.version ?? manifest?.version ?? ''}`.trim()
      : '收盘结构摘要',
    closeQuotes: {
      ...readClosePackageQuotes(structure, date, previousPoolCodes),
      ...readMinuteArchiveCloseQuotes(
        fullMarketMinuteRoot,
        date,
        previousPoolCodes,
      ),
      ...readMinuteArchiveCloseQuotes(
        ladderCandidateMinuteRoot,
        date,
        previousPoolCodes,
      ),
    },
    limitUp,
    failed,
    limitDown,
    sealRate,
    highestBoard,
    consecutiveCount,
    turnover: Number(summary?.turnover_sh_sz ?? breadthSource.amountTotal ?? 0),
    breadth,
    indexMood: mood,
    shortMood: shortMood(moodInput),
    cycleNode: cycleNode(moodInput),
    concentratedIndustries,
    leaders: limitUpRows
      .filter((row) => row.height === highestBoard)
      .map((row) => row.name),
    indices,
    ladders,
    failedStocks: failedRows
      .sort((a, b) => a.changePct - b.changePct)
      .map((row) => ({
        ...row,
        firstTouch: clock(row.firstTouch),
        lastSeal: clock(row.lastSeal),
      })),
    limitDownStocks: limitDownRows
      .sort((a, b) => a.changePct - b.changePct)
      .map((row) => ({
        ...row,
        firstTouch: clock(row.firstTouch),
        lastSeal: clock(row.lastSeal),
      })),
    coverage: {
      reported: breadth.requested,
      available: breadth.rowsAvailable,
    },
  });
}

const archivedDates = new Set(snapshots.map((snapshot) => snapshot.date));
const firstDate = snapshots[0]?.date;
const lastDate = snapshots.at(-1)?.date;
const verifiedSessions = fs.existsSync(calendarPath)
  ? (readJson(calendarPath).dates ?? [])
  : [];
const knownEvidenceDates = fs.existsSync(marketRoot)
  ? fs
      .readdirSync(marketRoot)
      .filter((name) => /^2026\d{4}$/.test(name))
      .map(formatDate)
  : [];
const knownMissingDates = [
  ...new Set([...verifiedSessions, ...knownEvidenceDates]),
]
  .filter(
    (date) =>
      (!firstDate || date >= firstDate) && (!lastDate || date <= lastDate),
  )
  .filter((date) => !archivedDates.has(date))
  .sort();

const document = {
  version: 1,
  generatedAt: new Date().toISOString(),
  methodology: {
    facts: '涨停、炸板、跌停、市场宽度、连板高度和个股均来自当日15:00收盘包。',
    labels:
      '指数情绪、短线情绪与周期节点由固定阈值规则判定，属于解释标签，不是原始行情字段。',
  },
  knownMissingDates,
  snapshots,
};

fs.writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`);
console.log(`Wrote ${snapshots.length} exact close snapshots to ${outputPath}`);
