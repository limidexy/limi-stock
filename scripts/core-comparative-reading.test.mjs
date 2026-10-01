import test from 'node:test';
import assert from 'node:assert/strict';
import { REAL_SCENARIOS, loadRealScenario } from './lib/real-tape-corpus.mjs';
import { buildEmotionTracking } from '../lib/emotion-tracking.ts';
import { emotionCoreReading } from '../lib/market-reading.ts';
import { buildTapeObservation } from '../lib/tape-observation.ts';
import { buildCoreComparativeReading } from '../lib/core-comparative-reading.ts';

// Existing research dates, NOT an unseen holdout. Expected facts come from
// manually inspected raw prefixes, never the same-day standard recap.
function run(id, changeEvidence = (e) => e) {
  const scenario =
    typeof id === 'string' ? REAL_SCENARIOS.find((s) => s.id === id) : id;
  const input = loadRealScenario(scenario);
  const tracking = buildEmotionTracking(
    input.history,
    { [scenario.date]: input.sourceDay },
    scenario.date,
    20,
    scenario.cutoff,
  );
  const evidence = changeEvidence({
    date: scenario.date,
    cutoff: scenario.cutoff,
    sourceState: 'LIVE',
    availableAt: input.sourceDay.availableAt,
    decisionMode: 'FIXED',
    decisionAt: input.sourceDay.availableAt,
    tracking,
    history: input.history,
  });
  return emotionCoreReading(
    input.facts,
    input.previous,
    input.rows,
    input.stocks,
    evidence,
  );
}

test('comparison retains stable, repaired and failed peers in one named question, not isolated winner cards', () => {
  const r = run('0918-0940-peer-divergence').comparativeReading;
  assert.ok(r, 'missing group-based interpretation');
  const c = r.cases.find(
    (x) => x.kind === 'TIER' && x.codes.includes('603248'),
  );
  assert.ok(c.codes.includes('001216'));
  assert.ok(c.codes.includes('003026'));
  assert.equal(c.verdict, 'SPLIT');
  assert.match(c.reading, /华瓷股份/);
  assert.match(c.reading, /锡华科技/);
  assert.match(c.reading, /中晶科技/);
  assert.match(c.boundary, /同身位.*不.*同.*题材/);
});

test('a repair and later reversal change the pressure chain, not earlier snapshots', () => {
  const before = run('0918-0940-peer-divergence').comparativeReading;
  const after = run('0918-1000-repair-separation').comparativeReading;
  assert.ok(before && after);
  assert.match(before.stocks['603248'].action, /09:32.*打开/);
  assert.doesNotMatch(before.stocks['603248'].action, /09:53/);
  assert.match(after.stocks['603248'].action, /09:53.*回/);
  assert.match(after.stocks['003026'].action, /09:48.*打开/);
  assert.notEqual(
    before.stocks['603248'].reading,
    after.stocks['603248'].reading,
  );
});

test('an already strong peer is a parallel support, never attributed to the later repair', () => {
  const r = run('0922-0945-space-repair-divergence').comparativeReading;
  assert.ok(r);
  const repaired = r.stocks['603230'];
  assert.match(repaired.action, /09:42/);
  assert.match(repaired.boundary, /带动|因果/);
  assert.doesNotMatch(repaired.reading, /带动新华文轩/);
  assert.equal(repaired.expectationAvailable, false);
});

test('failed strong side survives the sealed list and is named in group reasoning', () => {
  const r = run('0924-0940-middle-warning').comparativeReading;
  assert.ok(r);
  const c = r.cases.find((x) => x.kind === 'FAILURE');
  assert.ok(c.codes.includes('000910'));
  assert.match(c.reading, /大亚圣象/);
  assert.equal(c.verdict, 'PRESSURE_REMAINS');
});

test('absent or late minute evidence cannot become a completed comparison', () => {
  const r = run('0918-0940-peer-divergence', (e) => ({
    ...e,
    tracking: { ...e.tracking, availableAt: '2026-09-18T10:01:00+08:00' },
  })).comparativeReading;
  assert.ok(r);
  assert.equal(r.cases.length, 0);
  assert.equal(r.state, 'MISSING');
  assert.ok(
    Object.values(r.stocks).every((s) => s.comparisonCodes.length === 0),
  );
});

test('a relative bounce against even weaker peers cannot outrank still-sealed competitors', () => {
  const r = run('0924-0940-middle-warning');
  for (const stock of r.candidates.filter((c) =>
    c.pricePath?.peerRelations.some((p) => p.relation === 'WEAKER_SUPPORT'),
  )) {
    assert.notEqual(stock.currentRole, '主动分离候选');
    assert.notEqual(stock.state, '分离/卡位');
  }
});

test('a second opening invalidates the prior reseal; a gap cannot locate a new repair', () => {
  const tape = buildTapeObservation({
    date: '2026-09-24',
    cutoff: '09:40',
    source: 'synthetic chronology regression',
    previous: [{ code: '600001', name: '路径测试股', height: 3 }],
    trends: {
      600001: {
        code: '600001',
        name: '路径测试股',
        preClose: 10,
        points: [
          ['09:30', 11],
          ['09:31', 10.9],
          ['09:32', 11],
          ['09:33', 10.8],
          ['09:37', 11],
          ['09:38', 11],
          ['09:39', 11],
          ['09:40', 11],
        ].map(([time, price]) => ({ time, price })),
      },
    },
  });
  const row = tape.rows[0];
  assert.equal(row.openedAt, '09:33');
  assert.equal(row.resealedAt, null);
  assert.notEqual(row.support, 'RESEALED');
  assert.match(row.supportLabel, /时点.*未确认|过程.*缺口/);
  assert.doesNotMatch(row.supportLabel, /09:33打开后，09:32/);
  const reading = buildCoreComparativeReading({
    candidates: [],
    tape,
    observedAt: '2026-09-24T09:40:00+08:00',
    previousDate: '2026-09-23',
  });
  assert.ok(reading.cases.every((c) => !c.reading.includes('09:32回到')));
});

test('close archive accepts a verified later receipt but never a late intraday receipt or next-day packet', () => {
  const scenario = {
    ...REAL_SCENARIOS.find((s) => s.date === '2026-09-18'),
    cutoff: '15:00',
  };
  const archived = (availableAt) => (e) => ({
    ...e,
    sourceState: 'ARCHIVED',
    availableAt,
    tracking: {
      ...e.tracking,
      availableAt,
      tape: { ...e.tracking.tape, sourceAvailableAt: availableAt },
    },
  });
  const received = run(scenario, archived('2026-09-18T15:05:00+08:00'));
  assert.ok(received.comparativeReading.cases.length > 0);
  assert.ok(received.tape.rows.every((r) => r.lastTime <= '15:00'));
  assert.equal(
    run(scenario, archived('2026-09-18T16:01:00+08:00')).comparativeReading
      .cases.length,
    0,
  );
  assert.equal(
    run(scenario, archived('2026-09-19T15:05:00+08:00')).comparativeReading
      .cases.length,
    0,
  );
  assert.equal(
    run('0918-0940-peer-divergence', archived('2026-09-18T09:45:00+08:00'))
      .comparativeReading.cases.length,
    0,
  );
});

test('a gap before a new loss also invalidates old repair, without calling an unknown path weak', () => {
  const tape = buildTapeObservation({
    date: '2026-09-24',
    cutoff: '09:40',
    source: 'synthetic gap-boundary regression',
    previous: ['600001', '600002'].map((code) => ({
      code,
      name: code,
      height: 3,
    })),
    trends: {
      600001: {
        code: '600001',
        name: '缺口样本',
        preClose: 10,
        points: [
          ['09:30', 11],
          ['09:31', 10.9],
          ['09:32', 11],
          ['09:34', 10.8],
          ['09:35', 10.8],
          ['09:37', 11],
          ['09:38', 11],
          ['09:39', 11],
          ['09:40', 11],
        ].map(([time, price]) => ({ time, price })),
      },
      600002: {
        code: '600002',
        name: '连续样本',
        preClose: 10,
        points: Array.from({ length: 11 }, (_, i) => ({
          time: `09:${30 + i}`,
          price: 11,
        })),
      },
    },
  });
  const row = tape.rows.find((r) => r.code === '600001');
  assert.equal(row.resealedAt, null);
  assert.equal(row.openedAt, '09:34');
  assert.equal(row.openingGap, true);
  assert.notEqual(row.support, 'RESEALED');
  const r = buildCoreComparativeReading({
    candidates: [],
    tape,
    observedAt: '2026-09-24T09:40:00+08:00',
    previousDate: '2026-09-23',
  });
  const c = r.cases.find((c) => c.kind === 'TIER');
  assert.equal(c.verdict, 'PARTIAL');
  assert.equal(c.state, 'DEGRADED');
  assert.doesNotMatch(
    c.reading,
    /本组出现承接分层|没有修复所有同身位|09:32回到/,
  );
  assert.doesNotMatch(c.nextCheck, /能否止跌或重新封住/);
  assert.match(c.reading, /过程未知/);
});
