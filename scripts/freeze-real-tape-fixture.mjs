// One-time mechanical extraction from the original committed evidence bundle.
// Never rewrite the baseline to make a test pass after changing observations.
import fs from 'node:fs';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
const output = 'scripts/fixtures/real-tape-source-v1.json.gz';
if (fs.existsSync(output)) throw new Error('Frozen fixture already exists');
const bytes = execFileSync(
  'git',
  [
    'show',
    '307a49450693ce024c9304afcaa47e65bff15d35:lib/emotion-tracking.generated.json',
  ],
  { maxBuffer: 32 * 1024 * 1024 },
);
const sourceHash = crypto.createHash('sha256').update(bytes).digest('hex');
if (
  sourceHash !==
  'dbb145da150d31df9845db5eefd6b1e353398622b5c1626ee6e7fb8fcf7eb784'
)
  throw new Error('Original source hash mismatch');
const source = JSON.parse(bytes);
const dates = Object.fromEntries(
  ['2026-09-18', '2026-09-22', '2026-09-24'].map((date) => [
    date,
    source.dates[date],
  ]),
);
const payload = zlib.gzipSync(JSON.stringify({ sourceHash, dates }));
fs.mkdirSync('scripts/fixtures', { recursive: true });
fs.writeFileSync(output, payload);
console.log(
  JSON.stringify({
    output,
    bytes: payload.length,
    sha256: crypto.createHash('sha256').update(payload).digest('hex'),
  }),
);
