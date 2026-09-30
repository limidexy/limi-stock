import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { REAL_SCENARIOS, loadRealScenario } from './lib/real-tape-corpus.mjs';
import { buildEmotionTracking } from '../lib/emotion-tracking.ts';
import { buildTapeObservation } from '../lib/tape-observation.ts';
import { emotionCoreReading } from '../lib/market-reading.ts';

// Expected facts were frozen BEFORE engine changes in the independent-reading
// document. These are actual raw prices; there are no canned program role labels.
const cache = new Map();
function run(id) {
  if (cache.has(id)) return cache.get(id);
  const scenario = REAL_SCENARIOS.find((s) => s.id === id);
  assert.ok(scenario);
  const input = loadRealScenario(scenario);
  const tracking = buildEmotionTracking(
    input.history,
    { [scenario.date]: input.sourceDay },
    scenario.date,
    20,
    scenario.cutoff,
  );
  const evidence = {
    date: scenario.date,
    cutoff: scenario.cutoff,
    sourceState: 'LIVE',
    availableAt: input.sourceDay.availableAt,
    decisionMode: 'FIXED',
    decisionAt: input.sourceDay.availableAt,
    tracking,
    history: input.history,
  };
  const reading = emotionCoreReading(
    input.facts,
    input.previous,
    input.rows,
    input.stocks,
    evidence,
  );
  const value = { input, reading, tracking, evidence };
  cache.set(id, value);
  return value;
}
const core = (r, c) => r.candidates.find((row) => row.code === c);
const stock = (r, c) => r.tape.rows.find((row) => row.code === c);

test('unseen real 0922 09:45: identity, current repair and transmission are independent', () => {
  const { reading: r, input } = run('0922-0945-space-repair-divergence');
  assert.equal(
    input.sourceHash,
    'dbb145da150d31df9845db5eefd6b1e353398622b5c1626ee6e7fb8fcf7eb784',
  );
  assert.equal(Object.keys(input.sourceDay.trends).length, 76);
  assert.equal(stock(r, '001216').support, 'STABLE_SEAL');
  assert.equal(stock(r, '603230').support, 'RESEALED');
  assert.equal(stock(r, '603230').resealedAt, '09:42');
  assert.equal(stock(r, '601811').support, 'STABLE_SEAL');
  assert.ok(stock(r, '002285').changePct < 1);
  assert.ok(
    stock(r, '002453').changePct < -3,
    'earlier return to red is not lasting repair',
  );
  const tier = r.middle.tiers.find((t) => t.fromHeight === 3);
  assert.deepEqual(
    [tier.promoted, tier.denominator, tier.deepKnown, tier.priceCovered],
    [1, 5, 1, 5],
  );
  assert.ok(r.candidates.every((c) => c.provisional));
  assert.ok(
    !core(r, '603230').interpretation.influence.groups.some((g) =>
      g.members.some((m) => m.code === '601811'),
    ),
  );
  assert.ok(!JSON.stringify(r).includes('华瓷股份带动全市场'));
  assert.ok(input.history.every((d) => d.date < '2026-09-22'));
});

test('real 0918 09:40: stable seal, opened board and re-seal are distinct with no late concepts', () => {
  const { reading: r } = run('0918-0940-peer-divergence');
  assert.equal(core(r, '001216').pricePath.support, 'STABLE_SEAL');
  assert.equal(core(r, '001216').pricePath.stableSince, '09:31');
  assert.equal(core(r, '603248').pricePath.support, 'OPENED');
  assert.equal(core(r, '603248').pricePath.openedAt, '09:32');
  assert.equal(core(r, '003026').pricePath.support, 'RESEALED');
  assert.equal(core(r, '003026').pricePath.resealedAt, '09:40');
  assert.equal(core(r, '001216').dimensions.antiFall.result, 'OBSERVED');
  assert.equal(core(r, '001216').dimensions.initiative.state, 'READY');
  assert.equal(core(r, '001216').dimensions.initiative.result, 'NOT_OBSERVED');
  assert.equal(core(r, '001216').provisional, true);
  assert.equal(r.coverage.conceptReady, 0);
  assert.match(r.summary, /锡华科技/);
  assert.match(r.summary, /澳弘电子/);
});

test('real 0918 10:00: repair separation is not retroactively assigned to the earlier snapshot', () => {
  const before = run('0918-0940-peer-divergence').reading;
  const after = run('0918-1000-repair-separation').reading;
  assert.equal(core(before, '603248').pricePath.support, 'OPENED');
  assert.equal(core(after, '603248').pricePath.support, 'RESEALED');
  assert.equal(core(after, '603248').pricePath.resealedAt, '09:53');
  assert.ok(
    core(after, '603248').pricePath.peerRelations.some(
      (p) => p.code === '003026' && p.relation === 'REPAIR_SEPARATION',
    ),
  );
  assert.equal(core(after, '003026').pricePath.support, 'OPENED');
  assert.equal(core(after, '003026').pricePath.openedAt, '09:48');
  assert.notEqual(
    core(after, '001216').currentRole,
    core(after, '603248').currentRole,
  );
  assert.match(after.summary, /中晶科技/);
  assert.equal(
    core(after, '603248').provisional,
    true,
    'a re-seal is not automatically a market leader',
  );
});

test('real 0924 09:40: surviving space leader cannot hide three deep-water names in the 3-to-4 tier', () => {
  const { reading: r } = run('0924-0940-middle-warning');
  const tier = r.middle.tiers.find((t) => t.fromHeight === 3);
  assert.deepEqual(
    [tier.promoted, tier.denominator, tier.deepKnown, tier.priceCovered],
    [3, 7, 3, 7],
  );
  assert.equal(core(r, '601811').pricePath.support, 'STABLE_SEAL');
  assert.equal(core(r, '000910').pricePath.openedAt, '09:33');
  assert.equal(r.retreatWarning, true);
  assert.equal(r.tone, 'negative');
  assert.match(r.summary, /空间高位仍有强势表现，但中位已出现集中负反馈/);
  for (const name of ['大亚圣象', '南威软件', '华远控股', '华丽家族'])
    assert.ok(
      r.summary.includes(name),
      `risk name ${name} must remain visible`,
    );
});

test('real 0924: observation universe outside yesterday core list recovers attacker and distinguishes later response from prior strength', () => {
  const { reading: r, input } = run('0924-0940-outside-core-attacker');
  assert.equal(Object.keys(input.sourceDay.trends).length, 83);
  assert.ok(
    !input.previous.ladders
      .flatMap((l) => l.stocks)
      .some((s) => s.code === '600641'),
  );
  const lead = stock(r, '600641');
  assert.equal(lead.initiative.state, 'READY');
  assert.equal(lead.initiative.result, 'OBSERVED');
  assert.ok(lead.observedRelations.subsequentCodes.includes('688512'));
  assert.ok(lead.observedRelations.preexistingStrongCodes.includes('002119'));
  assert.ok(!lead.observedRelations.subsequentCodes.includes('002119'));
  assert.ok(r.attackerObservations.some((s) => s.code === '600641'));
  assert.equal(
    core(r, '600641'),
    undefined,
    'a raw price attack does not automatically admit an ordinary stock as a confirmed core',
  );
  assert.equal(stock(r, '688512').initiative.result, 'NOT_OBSERVED');
  assert.ok(
    stock(r, '688512').observedRelations.earlierCodes.includes('600641'),
  );
});

test('real replay excludes current-day final pools, prices after cutoff and retrospectively fetched concepts', () => {
  const { input: x, reading: r } = run('0918-0940-peer-divergence');
  assert.ok(x.history.every((d) => d.date < x.scenario.date));
  assert.ok(
    Object.values(x.sourceDay.trends).every((t) =>
      t.points.every((p) => p.time <= '09:40'),
    ),
  );
  assert.equal(x.sourceDay.concepts, undefined);
  assert.equal(r.tape.cutoff, '09:40');
  assert.equal(core(r, '603248').pricePath.resealedAt, null);
  assert.ok(!JSON.stringify(r).includes('09:53'));
});

test('retained historical identity stays accessible without diluting the current feedback denominator', () => {
  const { input: x, evidence } = run('0918-0940-peer-divergence');
  const phantomHistory = {
    ...x.previous,
    date: '2026-08-03',
    previousDate: '2026-07-31',
    limitUp: 1,
    ladders: [
      {
        height: 8,
        stocks: [
          {
            code: '600999',
            name: 'history fixture',
            height: 8,
            changePct: 10,
            industry: 'test',
          },
        ],
      },
    ],
    highestBoard: 8,
  };
  const r = emotionCoreReading(x.facts, x.previous, x.rows, x.stocks, {
    ...evidence,
    history: [phantomHistory, ...x.history],
  });
  const base = run('0918-0940-peer-divergence').reading;
  assert.ok(r.historicalCandidates.some((c) => c.code === '600999'));
  assert.equal(r.highFeedback.denominator, base.highFeedback.denominator);
  assert.equal(r.highFeedback.covered, base.highFeedback.covered);
  assert.notEqual(core(r, '600999').state, '影响衰减退出');
});

test('complete local response remains usable despite an unrelated early gap; no claim of complete-session first movement', () => {
  const { input: x } = run('0924-0940-outside-core-attacker');
  const trends = structuredClone(x.sourceDay.trends);
  trends['600641'].points = trends['600641'].points.filter(
    (p) => p.time !== '09:30',
  );
  const tape = buildTapeObservation({
    date: x.scenario.date,
    cutoff: '09:40',
    trends,
    previous: x.previous.ladders.flatMap((l) => l.stocks),
    metadata: x.universe,
    source: 'actual-price local-gap regression',
  });
  const row = tape.rows.find((r) => r.code === '600641');
  assert.equal(row.initiative.state, 'READY');
  assert.equal(row.initiative.result, 'OBSERVED');
  assert.match(row.initiative.label, /局部|可见窗口/);
});

test('data absence is not changed into a known negative observation', () => {
  const tape = buildTapeObservation({
    date: '2026-09-24',
    cutoff: '09:40',
    trends: {
      600001: { code: '600001', name: 'missing', preClose: 10, points: [] },
    },
    previous: [{ code: '600001', name: 'missing', height: 3 }],
    source: 'no-path fixture',
  });
  assert.equal(tape.rows[0].initiative.state, 'MISSING');
  assert.equal(tape.rows[0].initiative.result, 'UNRESOLVED');
});

test('a malformed future repair field is rejected per stock without clearing other valid minute rows', () => {
  const { input: x, evidence } = run('0918-0940-peer-divergence');
  const changed = structuredClone(evidence);
  const future = changed.tracking.tape.rows.find(
    (row) => row.code === '603248',
  );
  future.support = 'RESEALED';
  future.resealedAt = '09:53';
  const result = emotionCoreReading(
    x.facts,
    x.previous,
    x.rows,
    x.stocks,
    changed,
  );
  assert.equal(core(result, '603248').pricePath, undefined);
  assert.equal(core(result, '001216').pricePath.support, 'STABLE_SEAL');
  assert.ok(result.tape.rows.length > 0);
});

test('the frozen before-repair output actually lacked the new observed roles and outside-list attacker', () => {
  const file = new URL(
    './fixtures/independent-tape-before.json',
    import.meta.url,
  );
  const before = JSON.parse(fs.readFileSync(file, 'utf8'));
  const scenario = before.result.find(
    (r) => r.scenario.id === '0924-0940-outside-core-attacker',
  );
  assert.equal(
    scenario.sourceHash,
    run('0924-0940-outside-core-attacker').input.sourceHash,
  );
  assert.equal(
    scenario.actual.focus.find((r) => r.code === '600641').notRecalled,
    true,
  );
  const stable = before.result[0].actual.focus.find((r) => r.code === '001216');
  assert.equal(stable.dimensions.initiative.state, 'MISSING');
});
