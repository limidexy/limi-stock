import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { radarQuoteDate, isThemeBoard } from '../lib/radar-evidence.ts';

const [baseUrl = 'http://localhost:3000', expectedDate] = process.argv.slice(2);
assert.match(
  expectedDate ?? '',
  /^\d{8}$/,
  'Supply the exact target trading date as YYYYMMDD',
);
const response = await fetch(`${baseUrl}/api/radar`, {
  signal: AbortSignal.timeout(45000),
  cache: 'no-store',
});
assert.equal(response.status, 200);
const raw = await response.text();
const data = JSON.parse(raw);
assert.equal(data.tradeDate, expectedDate);
assert.equal(data.dataVersion, 2);
assert.equal(data.status, 'READY', data.reason);
assert.equal(data.coverage.queryReady, data.coverage.queryRequested);
assert.ok(data.coverage.available <= data.coverage.rankedCandidates);
assert.ok(data.coverage.available <= data.coverage.reported);
assert.equal(
  new Set(data.events.map((event) => event.code)).size,
  data.events.length,
);
const shared = new Map();
const events = data.events.map((event) => {
  assert.ok(isThemeBoard(event.name));
  assert.equal(radarQuoteDate(event.quoteTime), expectedDate);
  assert.equal(event.driverState, 'READY');
  assert.equal(event.memberQueriesReady, event.memberQueriesRequested);
  assert.equal(
    new Set(event.members.map((row) => row.code)).size,
    event.members.length,
  );
  assert.equal(
    new Set(event.drivers.map((row) => row.code)).size,
    event.drivers.length,
  );
  assert.ok(event.members.length <= event.memberCount);
  assert.ok(event.drivers.length > 0);
  if (data.sessionState === 'CLOSED')
    assert.equal(event.selectionBasis, 'DAY_CHANGE');
  for (const member of event.members)
    assert.equal(radarQuoteDate(member.quoteTime), expectedDate);
  const field =
    event.selectionBasis === 'DAY_CHANGE' ? 'changePct' : 'speedPct';
  assert.ok(event.direction === 'up' ? event[field] > 0 : event[field] < 0);
  for (const driver of event.drivers) {
    assert.equal(radarQuoteDate(driver.quoteTime), expectedDate);
    assert.ok(event.members.some((member) => member.code === driver.code));
    assert.ok(event.direction === 'up' ? driver[field] > 0 : driver[field] < 0);
    shared.set(driver.code, [...(shared.get(driver.code) ?? []), event.name]);
  }
  return {
    code: event.code,
    name: event.name,
    direction: event.direction,
    selectionBasis: event.selectionBasis,
    changePct: event.changePct,
    speedPct: event.speedPct,
    quoteTime: event.quoteTime,
    membersAvailable: event.members.length,
    membersReported: event.memberCount,
    drivers: event.drivers.map((row) => ({
      code: row.code,
      name: row.name,
      changePct: row.changePct,
      speedPct: row.speedPct,
      mainNetInflow: row.mainNetInflow,
      quoteTime: row.quoteTime,
    })),
  };
});
const relatedModules = [];
for (const moduleName of [
  'ladder',
  'timeline',
  'intraday-emotion',
  'speed',
  'flow',
]) {
  const result = await fetch(`${baseUrl}/api/${moduleName}`, {
    signal: AbortSignal.timeout(45000),
    cache: 'no-store',
  });
  const value = await result.json();
  assert.equal(result.status, 200, moduleName);
  assert.equal(value.tradeDate, expectedDate, moduleName);
  relatedModules.push({
    module: moduleName,
    http: result.status,
    tradeDate: value.tradeDate,
    state: value.status,
    sourceState: value.sourceState,
    retrievedAt: value.retrievedAt,
  });
}
console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      baseUrl,
      verification: 'CONTRACT_PASS',
      marketJudgmentAccuracy: 'NOT_VALIDATED',
      tradeDate: data.tradeDate,
      sourceState: data.sourceState,
      dataState: data.status,
      payloadSHA256: createHash('sha256').update(raw).digest('hex'),
      coverage: data.coverage,
      events,
      crossThemeStocks: [...shared]
        .filter(([, sectors]) => sectors.length > 1)
        .map(([code, sectors]) => ({ code, sectors })),
      relatedModules,
    },
    null,
    2,
  ),
);
