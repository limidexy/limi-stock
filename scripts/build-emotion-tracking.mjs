import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

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
    trends = {};
  for (const row of breadth.values())
    if (wanted.has(row.code) && Number.isFinite(row.changePct))
      quotes[row.code] = {
        changePct: row.changePct,
        quoteTime: `${day}T15:00:00+08:00`,
        source,
      };
  const metadata = new Map(
    structure.selectedSecurityMetadata.map((x) => [x.symbol, x]),
  );
  const minute = zlib
    .gunzipSync(fs.readFileSync(path.join(dir, 'minute_ohlcv.jsonl.gz')))
    .toString()
    .trim()
    .split('\n')
    .map(JSON.parse);
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
    capturedAt: manifest.retrievedAt,
    artifacts: manifest.artifacts,
  };
  audit.push({
    date: day,
    status: 'READY',
    quotes: Object.keys(quotes).length,
    trends: Object.keys(trends).length,
  });
}
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
