import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { closeDates, closeDirectory } from './close-package.mjs';

// Mechanical extraction only. No fetching, old-date substitutions, or prices inferred from pools.
const root = path.resolve(process.cwd(), '..');
const history = JSON.parse(
  fs.readFileSync('lib/close-history.generated.json', 'utf8'),
).snapshots;
const stocksOf = (day) => day?.ladders.flatMap((ladder) => ladder.stocks) ?? [];
const uniqueCount = (rows) => new Set(rows.map((row) => row.code)).size;
const complete = (day) =>
  Boolean(
    day &&
    day.status === 'READY' &&
    day.cutoff === '15:00' &&
    uniqueCount(stocksOf(day)) === day.limitUp &&
    uniqueCount(day.failedStocks) === day.failed &&
    uniqueCount(day.limitDownStocks) === day.limitDown,
  );

// The API supports at most a 20-session lookback.  Keep only the identities
// that one of those windows can actually request on each evidence date.  The
// old implementation embedded every historical high/failed/limit-down name on
// every date (about 1,400 quotes per day), even though most names could never
// enter that day's old-leader, failed-repair, rebound or lead/lag result.  That
// inflated the Worker bundle enough to cause cold-start memory failures.
const wantedByDate = new Map(history.map((day) => [day.date, new Set()]));
for (let targetIndex = 0; targetIndex < history.length; targetIndex++) {
  const target = history[targetIndex];
  const prior = history
    .slice(0, targetIndex)
    .filter((day) => day.date < target.date)
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-20);
  const leaders = new Map();
  for (const day of prior.filter(complete))
    for (const stock of stocksOf(day).filter(
      (item) => item.height === day.highestBoard && item.height >= 3,
    )) {
      const previous = leaders.get(stock.code);
      if (!previous || stock.height >= previous.height)
        leaders.set(stock.code, { height: stock.height, peakDate: day.date });
    }
  for (const [code, leader] of leaders)
    for (const day of history)
      if (day.date >= leader.peakDate && day.date <= target.date)
        wantedByDate.get(day.date)?.add(code);
  const previous = prior.at(-1);
  if (previous)
    for (const stock of [...stocksOf(previous), ...previous.failedStocks])
      wantedByDate.get(target.date)?.add(stock.code);
}
const wantedFor = (date) => wantedByDate.get(date) ?? new Set();
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const dashed = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
const dailyCachePath = path.join(
  root,
  'data/historical_close_backfill_v251/daily.sqlite3',
);
const dailyCache = fs.existsSync(dailyCachePath)
  ? new DatabaseSync(dailyCachePath, { readOnly: true })
  : null;
const suspensionQuery = dailyCache?.prepare(
  'SELECT trade_status, close, preclose, volume FROM daily WHERE date = ? AND code = ?',
);
const providerCode = (code) =>
  `${code.startsWith('6') ? 'sh' : code.startsWith('0') || code.startsWith('3') ? 'sz' : 'bj'}.${code}`;
const confirmedSuspension = (date, code) => {
  const row = suspensionQuery?.get(date, providerCode(code));
  return Boolean(
    row &&
    Number(row.trade_status) === 0 &&
    Number.isFinite(Number(row.close)) &&
    Number.isFinite(Number(row.preclose)) &&
    Math.abs(Number(row.close) - Number(row.preclose)) < 0.0001 &&
    (row.volume == null || Number(row.volume) === 0),
  );
};
const dates = {},
  audit = [];
for (const date of closeDates(root)) {
  const dir = closeDirectory(root, date);
  if (!fs.existsSync(path.join(dir, 'manifest.json'))) continue;
  const manifest = read(path.join(dir, 'manifest.json'));
  if (
    manifest.tradeDate !== date ||
    manifest.sessionKind !== 'CLOSE' ||
    manifest.marketDataCutoff !== '15:00'
  ) {
    audit.push({
      date,
      status: 'EXCLUDED',
      reason: 'Missing exact CLOSE cutoff contract',
    });
    continue;
  }
  for (const a of manifest.artifacts) {
    const bytes = fs.readFileSync(path.resolve(root, a.path));
    if (sha(bytes) !== a.sha256 || bytes.length !== a.bytes)
      throw Error(`Integrity failed ${a.path}`);
  }
  const structure = JSON.parse(
    zlib.gunzipSync(fs.readFileSync(path.join(dir, 'structure.json.gz'))),
  );
  if (
    structure.tradeDate !== date ||
    structure.sessionKind !== 'CLOSE' ||
    structure.marketDataCutoff !== '15:00'
  )
    throw Error(`Structure cutoff mismatch ${date}`);
  const breadth = new Map();
  for (const row of structure.breadth.rows) {
    if (breadth.has(row.symbol))
      throw Error(`Duplicate breadth ${date}:${row.symbol}`);
    breadth.set(row.symbol, row);
  }
  const day = dashed(date),
    source = manifest.baseReady
      ? `已校验基础收盘报价 · ${structure.breadth.summary?.scope ?? '全A有效报价'} · 包声明15:00（非逐股交易所时间戳）`
      : '已校验CLOSE包全市场报价 · 包声明15:00（非逐股交易所时间戳）';
  const quotes = {},
    trends = {},
    noTrade = {};
  const wanted = wantedFor(day);
  for (const row of breadth.values())
    if (wanted.has(row.code) && Number.isFinite(row.changePct))
      quotes[row.code] = {
        changePct: row.changePct,
        quoteTime: `${day}T15:00:00+08:00`,
        source,
      };
  const knownByDate = new Set(
    history
      .filter((x) => x.date <= day)
      .flatMap((x) => [
        ...x.ladders.flatMap((ladder) => ladder.stocks),
        ...x.failedStocks,
        ...x.limitDownStocks,
      ])
      .map((x) => x.code),
  );
  const breadthCodes = new Set([...breadth.values()].map((row) => row.code));
  for (const code of knownByDate) {
    if (!wanted.has(code)) continue;
    if (confirmedSuspension(date, code)) {
      noTrade[code] = '停牌';
    } else if (!manifest.baseReady && !breadthCodes.has(code))
      noTrade[code] = '当日全市场收盘包无成交记录';
  }
  const metadata = new Map(
    structure.selectedSecurityMetadata.map((x) => [x.symbol, x]),
  );
  const minutePath = path.join(dir, 'minute_ohlcv.jsonl.gz');
  const minute = fs.existsSync(minutePath)
    ? zlib
        .gunzipSync(fs.readFileSync(minutePath))
        .toString()
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(JSON.parse)
    : [];
  for (const row of minute) {
    const code = row.symbol.slice(2),
      current = breadth.get(row.symbol);
    if (!wanted.has(code)) continue;
    if (row.tradeDate !== date)
      throw Error(`Minute date mismatch ${row.symbol}`);
    if (trends[code]) throw Error(`Duplicate minute security ${date}:${code}`);
    if (!Number.isFinite(current?.previousClose) || current.previousClose <= 0)
      continue;
    const points = row.rows
      .filter(
        (p) =>
          p.time >= '09:30' &&
          p.time <= '15:00' &&
          Number.isFinite(p.close) &&
          p.close > 0,
      )
      .map((p) => ({ time: p.time, price: p.close }));
    const close = points.find((p) => p.time === '15:00');
    if (
      close &&
      Number.isFinite(current.price) &&
      Math.abs(close.price - current.price) > 0.011
    )
      throw Error(`Minute/close mismatch ${date}:${code}`);
    trends[code] = {
      code,
      name: metadata.get(row.symbol)?.name ?? current.name,
      preClose: current.previousClose,
      points,
    };
  }
  const concepts = Object.fromEntries(
    [...metadata.values()]
      .filter((x) => wanted.has(x.code) && typeof x.concepts === 'string')
      .map((x) => [x.code, x.concepts.split(/[,，]/).filter(Boolean)]),
  );
  dates[day] = {
    date: day,
    previousDate: dashed(structure.previousTradingDate),
    quotes,
    trends,
    source,
    concepts,
    noTrade,
    capturedAt: manifest.retrievedAt,
    artifacts: manifest.artifacts,
  };
  audit.push({
    date: day,
    status: manifest.baseReady ? 'DEGRADED' : 'READY',
    quotes: Object.keys(quotes).length,
    trends: Object.keys(trends).length,
    quoteState: 'READY',
    minuteState: minute.length ? 'DEGRADED' : 'MISSING',
    minuteReason:
      '包内有分钟记录不等于跟踪身份池完整；须独立核验逐股路径与请求覆盖。',
  });
}

// A verified weekly archive can restore an exact-date closing quote even when
// its original daily directory has already been compacted. It does not upgrade
// minute-path coverage: archived critical minutes are a selected subset.
const archivesRoot = path.join(root, 'data/market/archives');
if (fs.existsSync(archivesRoot))
  for (const week of fs.readdirSync(archivesRoot).sort()) {
    const weekDir = path.join(archivesRoot, week);
    if (!fs.statSync(weekDir).isDirectory()) continue;
    for (const name of fs
      .readdirSync(weekDir)
      .filter((x) => /^\d{8}_close_market_evidence.*\.tar\.gz$/.test(x))
      .sort()) {
      const date = name.slice(0, 8),
        day = dashed(date);
      if (dates[day]) continue;
      const archivePath = path.join(weekDir, name);
      const cleanupPath = path.join(
        root,
        'data/market/cleanup_audits',
        `${date}_close_cleanup_v228.json`,
      );
      if (!fs.existsSync(cleanupPath)) continue;
      const cleanup = read(cleanupPath),
        archiveBytes = fs.readFileSync(archivePath);
      if (
        cleanup.tradeDate !== date ||
        cleanup.sessionKind !== 'CLOSE' ||
        sha(archiveBytes) !== cleanup.archiveSha256 ||
        archiveBytes.length !== cleanup.archiveBytes
      )
        throw Error(`Archive integrity failed ${date}`);
      const entry = (file) =>
        execFileSync('tar', ['-xOzf', archivePath, file], {
          maxBuffer: 30 * 1024 * 1024,
        });
      const manifestBytes = entry('manifest.json'),
        manifest = JSON.parse(manifestBytes.toString());
      if (
        manifest.status !== 'READY' ||
        manifest.tradeDate !== date ||
        sha(manifestBytes) !== cleanup.sourceManifestSha256
      )
        throw Error(`Archive manifest contract failed ${date}`);
      const structure = JSON.parse(
        zlib.gunzipSync(entry('structure.json.gz')).toString(),
      );
      if (structure.tradeDate !== date)
        throw Error(`Archive structure date mismatch ${date}`);
      const quotes = {},
        noTrade = {},
        source = '已校验周归档CLOSE报价 · 包声明15:00（不含全量分钟路径）';
      const wanted = wantedFor(day);
      for (const row of structure.breadth?.rows ?? [])
        if (wanted.has(row.code) && Number.isFinite(row.changePct))
          quotes[row.code] = {
            changePct: row.changePct,
            quoteTime: `${day}T15:00:00+08:00`,
            source,
          };
      const present = new Set(
        (structure.breadth?.rows ?? []).map((row) => row.code),
      );
      const knownByDate = new Set(
        history
          .filter((x) => x.date <= day)
          .flatMap((x) => [
            ...x.ladders.flatMap((ladder) => ladder.stocks),
            ...x.failedStocks,
            ...x.limitDownStocks,
          ])
          .map((x) => x.code),
      );
      for (const code of knownByDate) {
        if (!wanted.has(code)) continue;
        if (confirmedSuspension(date, code)) {
          noTrade[code] = '停牌';
        } else if (!present.has(code))
          noTrade[code] = '当日已校验收盘归档无成交记录';
      }
      const metadata = new Map(
        (structure.selectedSecurityMetadata ?? []).map((x) => [x.symbol, x]),
      );
      dates[day] = {
        date: day,
        previousDate: dashed(structure.previousTradingDate),
        quotes,
        trends: {},
        source,
        concepts: Object.fromEntries(
          [...metadata.values()]
            .filter((x) => wanted.has(x.code) && typeof x.concepts === 'string')
            .map((x) => [x.code, x.concepts.split(/[,，]/).filter(Boolean)]),
        ),
        noTrade,
        capturedAt: manifest.retrievedAt,
        artifacts: [
          {
            path: path.relative(root, archivePath),
            sha256: cleanup.archiveSha256,
            bytes: cleanup.archiveBytes,
          },
        ],
      };
      audit.push({
        date: day,
        status: 'READY',
        quotes: Object.keys(quotes).length,
        trends: 0,
        quoteState: 'READY',
        minuteState: 'MISSING',
        source: 'VERIFIED_WEEKLY_ARCHIVE',
      });
    }
  }

// Independently stored exact-date minute supplements. Daily bars are never
// expanded into synthetic intraday paths. A 5m supplement is useful evidence,
// but remains DEGRADED for rules that require consecutive 1m observations.
const supplementsRoot = path.join(root, 'data/market_minute_supplements_v252');
if (fs.existsSync(supplementsRoot))
  for (const date of fs
    .readdirSync(supplementsRoot)
    .filter((value) => /^\d{8}$/.test(value))
    .sort()) {
    const dir = path.join(supplementsRoot, date),
      manifestPath = path.join(dir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = read(manifestPath),
      day = dashed(date);
    if (
      manifest.version !== 'emotion-minute-supplement:v2.52' ||
      manifest.tradeDate !== date ||
      !['READY', 'DEGRADED'].includes(manifest.status) ||
      !dates[day]
    )
      continue;
    const artifactPath = path.resolve(root, manifest.artifact.path),
      bytes = fs.readFileSync(artifactPath);
    if (
      bytes.length !== manifest.artifact.bytes ||
      sha(bytes) !== manifest.artifact.sha256
    )
      throw Error(`Minute supplement integrity failed ${date}`);
    const rows = zlib
      .gunzipSync(bytes)
      .toString()
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(JSON.parse);
    if (rows.length !== manifest.artifact.rows)
      throw Error(`Minute supplement row count mismatch ${date}`);
    let oneMinute = 0,
      fiveMinute = 0;
    const wanted = wantedFor(day);
    for (const row of rows) {
      if (
        row.tradeDate !== date ||
        !/^\d{6}$/.test(row.code) ||
        ![1, 5].includes(row.intervalMinutes) ||
        !Array.isArray(row.rows) ||
        !row.rows.length
      )
        throw Error(`Minute supplement contract failed ${date}:${row.code}`);
      const points = row.rows.map((point) => ({
        time: point.time,
        price: point.close,
      }));
      const close = points.find((point) => point.time === '15:00');
      if (!close || Math.abs(close.price - row.dailyClose) > 0.011)
        throw Error(`Minute supplement close mismatch ${date}:${row.code}`);
      if (row.intervalMinutes === 1) oneMinute += 1;
      else fiveMinute += 1;
      // The immutable recovery pool can contain more identities than this
      // view's lookback. Validate them, but do not reject an otherwise valid day.
      if (!wanted.has(row.code)) continue;
      const existing = dates[day].trends[row.code];
      const existingInterval = existing?.intervalMinutes ?? 1;
      if (
        !existing ||
        row.intervalMinutes < existingInterval ||
        (row.intervalMinutes === existingInterval &&
          points.length > (existing.points?.length ?? 0))
      )
        dates[day].trends[row.code] = {
          code: row.code,
          name: row.name,
          preClose: row.preClose,
          points,
          intervalMinutes: row.intervalMinutes,
          source:
            row.provider === 'pytdx_history_minute_dual_server'
              ? '通达信公共协议精确日期1分钟分时（双服务器一致）'
              : row.provider === 'pytdx_history_minute_five_server_majority'
                ? '通达信公共协议精确日期1分钟分时（五服务器逐分钟多数确认）'
                : row.intervalMinutes === 1
                  ? '腾讯精确日期1分钟行情'
                  : '精确日期5分钟行情',
        };
    }
    dates[day].source +=
      ` · 历史分钟补充${rows.length}只（1分钟${oneMinute}，5分钟${fiveMinute}）`;
    dates[day].artifacts = [
      ...(dates[day].artifacts ?? []),
      {
        path: manifest.artifact.path,
        sha256: manifest.artifact.sha256,
        bytes: manifest.artifact.bytes,
      },
    ];
    const item = audit.find((row) => row.date === day);
    if (item) {
      item.trends = Object.keys(dates[day].trends).length;
      item.minuteState =
        manifest.status === 'READY' &&
        manifest.available === manifest.requested &&
        fiveMinute === 0
          ? 'READY'
          : 'DEGRADED';
      item.minuteCoverage = {
        requested: manifest.requested,
        available: manifest.available,
        oneMinute,
        fiveMinute,
      };
      item.minuteReason =
        item.minuteState === 'READY'
          ? '独立跟踪身份池的精确1分钟路径已核验；不代表全市场分钟完整。'
          : '跟踪身份池仍有缺失或低精度路径，不能按完整1分钟使用。';
      item.minuteSource = 'EXACT_DATE_SUPPLEMENT_V252';
    }
  }
audit.sort((a, b) => a.date.localeCompare(b.date));
dailyCache?.close();
const output = 'lib/emotion-tracking.generated.json';
fs.writeFileSync(
  output,
  JSON.stringify({
    version: 1,
    generatedAt: new Date().toISOString(),
    dates,
    audit,
  }) + '\n',
);
console.log(
  JSON.stringify({ output, bytes: fs.statSync(output).size, audit }, null, 2),
);
