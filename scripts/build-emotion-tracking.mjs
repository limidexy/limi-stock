import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

// Mechanical extraction only. No fetching, old-date substitutions, or prices inferred from pools.
const root = path.resolve(process.cwd(), '..');
const history = JSON.parse(
  fs.readFileSync('lib/close-history.generated.json', 'utf8'),
).snapshots;
const wanted = new Set(
  history.flatMap((d) =>
    [
      ...d.ladders.flatMap((l) => l.stocks),
      ...d.failedStocks,
      ...d.limitDownStocks,
    ].map((x) => x.code),
  ),
);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const dashed = (d) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
const dates = {},
  audit = [];
for (const date of fs
  .readdirSync(path.join(root, 'data/market'))
  .filter((x) => /^\d{8}$/.test(x))
  .sort()) {
  const dir = path.join(root, 'data/market', date, 'CLOSE');
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
    source = '已校验CLOSE包全市场报价 · 包声明15:00（非逐股交易所时间戳）';
  const quotes = {},
    trends = {},
    noTrade = {};
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
  for (const code of knownByDate)
    if (wanted.has(code) && !breadthCodes.has(code))
      noTrade[code] = '当日全市场收盘包无成交记录';
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
    status: 'READY',
    quotes: Object.keys(quotes).length,
    trends: Object.keys(trends).length,
    quoteState: 'READY',
    minuteState: minute.length ? 'READY' : 'MISSING',
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
        source =
          '已校验周归档CLOSE报价 · 包声明15:00（不含全量分钟路径）';
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
      for (const code of knownByDate)
        if (wanted.has(code) && !present.has(code))
          noTrade[code] = '当日已校验收盘归档无成交记录';
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
audit.sort((a, b) => a.date.localeCompare(b.date));
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
