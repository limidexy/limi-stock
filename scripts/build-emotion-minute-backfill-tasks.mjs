import fs from 'node:fs';
import path from 'node:path';
import { buildEmotionTracking } from '../lib/emotion-tracking.ts';

const root = path.resolve(process.cwd(), '..');
const history = JSON.parse(
  fs.readFileSync('lib/close-history.generated.json', 'utf8'),
).snapshots;
const evidenceDocument = JSON.parse(
  fs.readFileSync('lib/emotion-tracking.generated.json', 'utf8'),
);
const evidence = evidenceDocument.dates;
const args = process.argv.slice(2);
const outputFlag = args.indexOf('--output');
const requestedDates = new Set(
  args.filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)),
);
const missingDates = evidenceDocument.audit
  .filter(
    (row) =>
      (requestedDates.size
        ? requestedDates.has(row.date)
        : row.minuteState !== 'READY'),
  )
  .map((row) => row.date)
  .sort();
const days = [];
for (const date of missingDates) {
  const result = buildEmotionTracking(history, evidence, date, 10, '15:00');
  const codes = new Set(result.rebounds.rows.map((row) => row.code));
  for (const group of result.leadLag.rows) {
    codes.add(group.core.code);
    for (const row of group.rows) codes.add(row.code);
  }
  const noTrade = evidence[date]?.noTrade ?? {};
  const active = [...codes]
    .filter((code) => !noTrade[code])
    .sort();
  days.push({
    date: date.replaceAll('-', ''),
    requested: active.length,
    codes: active,
    excludedNoTrade: [...codes]
      .filter((code) => noTrade[code])
      .sort()
      .map((code) => ({ code, reason: noTrade[code] })),
  });
}
const output = path.resolve(
  outputFlag >= 0 && args[outputFlag + 1]
    ? args[outputFlag + 1]
    : path.join(
        root,
        'data/market_minute_supplements_v252/backfill_tasks.json',
      ),
);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(
  output,
  JSON.stringify(
    {
      version: 'emotion-minute-backfill-tasks:v2.52',
      generatedAt: new Date().toISOString(),
      sourceHistory: 'intraday-monitor-site/lib/close-history.generated.json',
      sourceEvidence:
        'intraday-monitor-site/lib/emotion-tracking.generated.json',
      days,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify(
    {
      output,
      dates: days.length,
      tasks: days.reduce((sum, day) => sum + day.requested, 0),
      excludedNoTrade: days.reduce(
        (sum, day) => sum + day.excludedNoTrade.length,
        0,
      ),
    },
    null,
    2,
  ),
);
