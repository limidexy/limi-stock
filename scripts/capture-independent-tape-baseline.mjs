import fs from 'node:fs';
import { REAL_SCENARIOS, loadRealScenario } from './lib/real-tape-corpus.mjs';
import { buildEmotionTracking } from '../lib/emotion-tracking.ts';
import { emotionCoreReading } from '../lib/market-reading.ts';
const result = [];
for (const scenario of REAL_SCENARIOS) {
  const x = loadRealScenario(scenario);
  const tracking = buildEmotionTracking(
    x.history,
    { [scenario.date]: x.sourceDay },
    scenario.date,
    20,
    scenario.cutoff,
  );
  const evidence = {
    date: scenario.date,
    cutoff: scenario.cutoff,
    availableAt: x.sourceDay.availableAt,
    sourceState: 'LIVE',
    tracking,
    history: x.history,
  };
  const actual = emotionCoreReading(
    x.facts,
    x.previous,
    x.rows,
    x.stocks,
    evidence,
  );
  result.push({
    scenario,
    sourceHash: x.sourceHash,
    scope: Object.keys(x.sourceDay.trends).length,
    expectedSource: 'docs/2026-09-28-independent-reading-baseline.md',
    actual: {
      summary: actual.summary,
      activeCodes: actual.activeCandidates?.map((candidate) => candidate.code),
      historyCodes: actual.historicalCandidates?.map(
        (candidate) => candidate.code,
      ),
      attackers: actual.attackerObservations,
      coverage: actual.coverage,
      middle: actual.middle,
      focus: scenario.focus.map(
        (code) =>
          actual.candidates.find((c) => c.code === code) ?? {
            code,
            notRecalled: true,
          },
      ),
    },
  });
}
const output = process.argv[2] ?? 'work/independent-tape-before.json';
fs.writeFileSync(
  output,
  JSON.stringify({ capturedAt: new Date().toISOString(), result }, null, 2) +
    '\n',
);
for (const r of result)
  console.log(
    r.scenario.id,
    JSON.stringify(
      r.actual.focus.map((c) => ({
        code: c.code,
        role: c.currentRole,
        state: c.state,
        initiative: c.dimensions?.initiative,
        notRecalled: c.notRecalled,
      })),
    ),
  );
