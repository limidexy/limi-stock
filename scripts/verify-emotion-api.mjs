import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { shortEmotionReading, compactDate } from '../lib/market-reading.ts';

const [base = 'http://localhost:3000', targetDate] = process.argv.slice(2);
assert.match(
  targetDate ?? '',
  /^\d{8}$/,
  'Supply the exact expected trading date',
);
const endpoints = ['intraday-emotion', 'ladder', 'close-history'];
const hashes = {};
const values = await Promise.all(
  endpoints.map(async (endpoint) => {
    const response = await fetch(`${base}/api/${endpoint}`, {
      signal: AbortSignal.timeout(30_000),
      cache: 'no-store',
    });
    assert.equal(response.status, 200, endpoint);
    const raw = await response.text();
    hashes[endpoint] = createHash('sha256').update(raw).digest('hex');
    return JSON.parse(raw);
  }),
);
const [snapshot, ladder, history] = values;
assert.equal(snapshot.tradeDate, targetDate);
assert.equal(ladder.tradeDate, targetDate);
assert.equal(snapshot.status, 'READY');
assert.equal(snapshot.sourceState, 'ARCHIVED');
assert.equal(snapshot.sessionState, 'CLOSED');
assert.equal(snapshot.cutoff, '15:00');
assert.equal(snapshot.coverage.poolsReady, snapshot.coverage.poolsRequested);
assert.equal(snapshot.coverage.poolsReady, 3);
const index = history.snapshots.findIndex(
  (row) => compactDate(row.date) === targetDate,
);
assert.ok(index >= 0);
assert.equal(
  new Set(history.snapshots.map((row) => row.date)).size,
  history.snapshots.length,
);
const facts = (row) => ({
  ...row,
  date: row.date ?? row.tradeDate,
  poolsReady: true,
  breadthReady: true,
});
const selected = history.snapshots[index];
const previous = history.snapshots[index - 1];
const result = shortEmotionReading(
  facts(selected),
  previous ? facts(previous) : null,
  ladder,
);
assert.equal(result.status, 'READY', result.missing.join('; '));
assert.equal(result.cohort.all.priceReady, result.cohort.all.count);
assert.ok(Number.isFinite(result.median));
assert.equal(
  result.cohort.rows.length,
  new Set(result.cohort.rows.map((row) => row.code)).size,
);
assert.equal(
  new Set([...result.positive, ...result.negative].map((row) => row.code)).size,
  result.positive.length + result.negative.length,
);
assert.ok(result.positive.every((row) => row.changePct > 0));
assert.ok(result.negative.every((row) => row.changePct < 0));
assert.equal(
  snapshot.ladders.flatMap((row) => row.stocks).length,
  snapshot.limitUp,
);
assert.equal(snapshot.limitDownStocks.length, snapshot.limitDown);
const matrix = history.snapshots.map((row, position) => {
  const reading = shortEmotionReading(
    facts(row),
    position ? facts(history.snapshots[position - 1]) : null,
    ladder,
  );
  if (compactDate(row.date) !== targetDate)
    assert.notEqual(reading.cohortSource, '同日完整昨日涨停跟踪');
  return {
    date: row.date,
    label: reading.label,
    status: reading.status,
    transition: reading.transition,
    priceAvailable: reading.cohort.all.priceReady,
    priceRequested: reading.cohort.all.count,
  };
});
console.log(
  JSON.stringify(
    {
      verifiedAt: new Date().toISOString(),
      base,
      targetDate,
      hashes,
      evidence: {
        label: result.label,
        status: result.status,
        median: result.median,
        priceAvailable: result.cohort.all.priceReady,
        priceRequested: result.cohort.all.count,
        consecutive: result.cohort.consecutive,
        first: result.cohort.first,
        families: result.families,
        positive: result.positive.map((row) => ({
          code: row.code,
          name: row.name,
          changePct: row.changePct,
        })),
        negative: result.negative.map((row) => ({
          code: row.code,
          name: row.name,
          changePct: row.changePct,
        })),
        transition: result.transition,
      },
      matrix,
      conclusion:
        '结构门通过；当前为准确交易日收盘观察，不证明盘中预测或交易有效性',
    },
    null,
    2,
  ),
);
