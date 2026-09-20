import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const document = JSON.parse(
  await readFile(
    new URL('../lib/dynamic-mainline.generated.json', import.meta.url),
  ),
);

test('dynamic mainline keeps research and production gates separate', () => {
  assert.equal(document.status, 'READY');
  assert.equal(document.policy.eventDriven, true);
  assert.equal(document.policy.fixedTimeSampling, false);
  assert.equal(document.policy.outcomesUsedForRanking, false);
  assert.equal(
    document.probabilityResearch.calibratedProbabilityAvailable,
    false,
  );
  assert.equal(document.probabilityResearch.scoringEnabled, false);
  assert.equal(document.probabilityResearch.selectionEnabled, false);
  assert.equal(document.probabilityResearch.productionIntegrated, false);
});

test('dynamic accumulation exposes real coverage without inventing probability', () => {
  assert.equal(document.coverage.dates, 12);
  assert.equal(document.probabilityResearch.dynamicDates, 12);
  assert.equal(document.probabilityResearch.dynamicDateTarget, 60);
  assert.equal(document.probabilityResearch.dynamicCandidates, 1113);
  assert.equal(document.probabilityResearch.labeledCandidates, 1077);
  assert.equal(document.probabilityResearch.gates.atLeast60DynamicDates, false);
  assert.equal(
    document.probabilityResearch.gates.atLeast300LabeledCandidates,
    true,
  );
  assert.equal(document.probabilityResearch.gates.separateLabels, true);
  assert.equal(document.probabilityResearch.labelGroups.length, 5);
  assert.equal(document.probabilityResearch.labels.length, 19);
  assert.equal(
    document.probabilityResearch.labels.every(
      (label) =>
        Number.isInteger(label.readyCount) &&
        Number.isInteger(label.positiveCount) &&
        label.positiveCount <= label.readyCount,
    ),
    true,
  );
  assert.equal(document.probabilityResearch.gates.labelCoverageComplete, false);
  assert.equal(
    document.probabilityResearch.gates.rollingHoldoutCompleted,
    false,
  );
  assert.equal(document.probabilityResearch.gates.probabilityCalibrated, false);
});

test('all replay dates and node identities are internally consistent', () => {
  const dates = document.dates.map((day) => day.date);
  assert.deepEqual(dates, [...dates].sort());
  assert.equal(new Set(dates).size, dates.length);
  const ids = [];
  for (const day of document.dates) {
    assert.equal(day.status, 'READY');
    assert.equal(day.nodes.length, day.visibleNodes);
    assert.ok(day.nodes.length <= 8);
    assert.ok(new Set(day.nodes.map((node) => node.sector)).size <= 4);
    assert.ok(day.minuteSnapshots >= 120);
    for (const node of day.nodes) {
      ids.push(node.id);
      assert.match(node.time, /^\d{2}:\d{2}$/);
      assert.ok(node.sector);
      assert.ok(node.eventType);
      assert.equal(
        new Set(node.stocks.map((stock) => stock.code)).size,
        node.stocks.length,
      );
      assert.equal(
        node.stocks.some((stock) => /某某|待确认/.test(stock.name)),
        false,
      );
      assert.equal(
        node.drivers.some((driver) => /某某|待确认|待补/.test(driver.name)),
        false,
      );
      if (node.sourceLayer === 'SECTOR') {
        assert.ok(node.drivers.length >= 3);
        assert.equal(
          node.drivers.every(
            (driver) =>
              driver.code &&
              driver.name &&
              Number.isFinite(driver.returnPct) &&
              Number.isFinite(driver.windowChangePct),
          ),
          true,
        );
      }
    }
  }
  assert.equal(new Set(ids).size, ids.length);
});
