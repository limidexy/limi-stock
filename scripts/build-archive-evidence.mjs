import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const root = path.resolve(process.cwd(), '..');
const marketRoot = path.join(root, 'data/market');
const dates = fs
  .readdirSync(marketRoot)
  .filter(
    (date) =>
      /^\d{8}$/.test(date) &&
      fs.existsSync(path.join(marketRoot, date, 'CLOSE/manifest.json')),
  )
  .sort();
const date = process.argv[2] ?? dates.at(-1);
if (!date || !dates.includes(date))
  throw new Error('No exact CLOSE package for requested date');
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const compressed = (p) =>
  JSON.parse(zlib.gunzipSync(fs.readFileSync(p)).toString());
const dir = path.join(marketRoot, date, 'CLOSE');
const manifest = read(path.join(dir, 'manifest.json'));
if (
  manifest.tradeDate !== date ||
  manifest.sessionKind !== 'CLOSE' ||
  manifest.marketDataCutoff !== '15:00'
)
  throw new Error('Invalid CLOSE date/cutoff');
for (const artifact of manifest.artifacts) {
  const bytes = fs.readFileSync(path.join(root, artifact.path));
  if (
    bytes.length !== artifact.bytes ||
    crypto.createHash('sha256').update(bytes).digest('hex') !== artifact.sha256
  )
    throw new Error(`Artifact integrity failed: ${artifact.path}`);
}
const structure = compressed(path.join(dir, 'structure.json.gz'));
if (structure.tradeDate !== date) throw new Error('Structure date mismatch');
const minuteRows = zlib
  .gunzipSync(fs.readFileSync(path.join(dir, 'minute_ohlcv.jsonl.gz')))
  .toString()
  .trim()
  .split('\n')
  .map(JSON.parse);
const previousFile = path.join(
  marketRoot,
  structure.previousTradingDate,
  'CLOSE/minute_ohlcv.jsonl.gz',
);
const previousRows = fs.existsSync(previousFile)
  ? zlib
      .gunzipSync(fs.readFileSync(previousFile))
      .toString()
      .trim()
      .split('\n')
      .map(JSON.parse)
  : [];
const breadth = new Map(structure.breadth.rows.map((row) => [row.symbol, row]));
const metadata = new Map(
  structure.selectedSecurityMetadata.map((row) => [row.symbol, row]),
);
const records = {};
for (const row of minuteRows) {
  if (row.tradeDate !== date)
    throw new Error(`Minute date mismatch: ${row.symbol}`);
  const current = breadth.get(row.symbol);
  const previous = previousRows
    .find(
      (r) =>
        r.symbol === row.symbol &&
        r.tradeDate === structure.previousTradingDate,
    )
    ?.rows.find((r) => r.time === '15:00');
  const preClose = current?.previousClose ?? previous?.close ?? null;
  records[row.symbol] = {
    code: row.symbol.slice(2),
    name: metadata.get(row.symbol)?.name ?? current?.name ?? row.symbol,
    preClose,
    changePct: current?.changePct ?? null,
    amount: current?.amount ?? null,
    points: row.rows
      .filter(
        (p) => p.time <= '15:00' && Number.isFinite(p.close) && p.close > 0,
      )
      .map((p) => [p.time, p.close]),
  };
}
const document = {
  version: 1,
  tradeDate: date,
  cutoff: '15:00',
  source: '已校验CLOSE包：新浪分钟收盘价与当日前收盘价',
  sourceRetrievedAt: manifest.retrievedAt,
  artifacts: manifest.artifacts,
  records,
};
const output = path.join(process.cwd(), 'lib/archive-evidence.generated.json');
fs.writeFileSync(output, JSON.stringify(document) + '\n');
console.log(
  JSON.stringify({
    tradeDate: date,
    records: Object.keys(records).length,
    bytes: fs.statSync(output).size,
    output,
  }),
);
