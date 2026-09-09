import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const recapRoot = resolve(siteRoot, '..');

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const mainlinePath = resolve(
  valueAfter('--mainline') ??
    resolve(
      recapRoot,
      'outputs/20260909/verification_v248_dynamic_mainline_r3/dynamic_mainline_nodes_v248.json',
    ),
);
const dynamicPath = resolve(
  valueAfter('--dynamic') ??
    resolve(
      recapRoot,
      'outputs/20260909/verification_v248_dynamic_relation_events_r2/dynamic_relation_events_v248.json',
    ),
);
const checkpointManifestPath = resolve(
  valueAfter('--checkpoint-manifest') ??
    resolve(
      recapRoot,
      'outputs/20260909/verification_v247_repair_relations_theme_r2/dataset_manifest_v247.json',
    ),
);
const checkpointEvaluationPath = resolve(
  valueAfter('--checkpoint-evaluation') ??
    resolve(
      recapRoot,
      'outputs/20260909/verification_v247_repair_relations_theme_r2/evaluation_v247_r2.json',
    ),
);
const probabilityManifestArg = valueAfter('--probability-manifest');
const outputPath = resolve(
  valueAfter('--output') ??
    resolve(siteRoot, 'lib/dynamic-mainline.generated.json'),
);

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function hash(text) {
  return createHash('sha256').update(text).digest('hex');
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function compactEvidence(value) {
  if (!value || typeof value !== 'object') return {};
  const kept = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'drivers') continue;
    if (
      typeof item === 'boolean' ||
      typeof item === 'string' ||
      (typeof item === 'number' && Number.isFinite(item))
    )
      kept[key] = item;
  }
  return kept;
}

function uniqueStocks(rows) {
  return [
    ...new Map(
      (rows ?? [])
        .filter((row) => row?.stock_code)
        .map((row) => [
          String(row.stock_code).padStart(6, '0'),
          {
            code: String(row.stock_code).padStart(6, '0'),
            name: String(row.stock_name ?? ''),
            identities: [...new Set(row.identity_state ?? [])],
            priorCoreCode: row.prior_core_code
              ? String(row.prior_core_code).padStart(6, '0')
              : null,
            priorCoreName: row.prior_core_name
              ? String(row.prior_core_name)
              : null,
          },
        ]),
    ).values(),
  ];
}

const [mainlineText, dynamicText, checkpointText, evaluationText] =
  await Promise.all([
    readFile(mainlinePath, 'utf8'),
    readFile(dynamicPath, 'utf8'),
    readFile(checkpointManifestPath, 'utf8'),
    readFile(checkpointEvaluationPath, 'utf8'),
  ]);
const mainline = JSON.parse(mainlineText);
const dynamic = JSON.parse(dynamicText);
const checkpoint = JSON.parse(checkpointText);
const evaluation = JSON.parse(evaluationText);
const probability = probabilityManifestArg
  ? await readJson(resolve(probabilityManifestArg))
  : null;

const dynamicByDate = new Map(
  (dynamic.days ?? []).map((day) => [Number(day.target_date), day]),
);
const dates = (mainline.days ?? [])
  .filter((day) => day.status === 'READY')
  .map((day) => {
    const relationDay = dynamicByDate.get(Number(day.target_date));
    return {
      date: String(day.target_date),
      priorDate: relationDay?.prior_date
        ? String(relationDay.prior_date)
        : null,
      status: 'READY',
      resolution: relationDay?.resolution ?? null,
      minuteSnapshots: Number(relationDay?.minute_snapshots ?? 0),
      candidateCount: Number(relationDay?.candidate_count ?? 0),
      candidateWithObservations: Number(
        relationDay?.candidate_with_observations ?? 0,
      ),
      rawEvents: Number(day.raw_events ?? 0),
      mergedNodes: Number(day.merged_nodes ?? 0),
      visibleNodes: Number(day.default_visible_nodes ?? 0),
      hiddenNodes: Number(day.hidden_expandable_nodes ?? 0),
      visibleSectorCount: Number(day.visible_sector_count ?? 0),
      dynamicChainCutoff: finite(day.dynamic_chain_cutoff),
      nodes: (day.nodes ?? [])
        .map((node) => ({
          id: `${day.target_date}-${node.observed_at}-${node.sector}-${node.event_type}-${node.importance_rank_within_day}`,
          time: String(node.observed_at ?? ''),
          lastConfirmedAt: String(
            node.last_confirmed_at ?? node.observed_at ?? '',
          ),
          sector: String(node.sector ?? ''),
          eventType: String(node.event_type ?? ''),
          sourceLayer: String(node.source_layer ?? ''),
          score: finite(node.score),
          scoreBand: String(node.score_band ?? ''),
          mergedRawEvents: Number(node.merged_raw_events ?? 0),
          importanceRank: Number(node.importance_rank_within_day ?? 0),
          mainlineReason: String(node.mainline_reason ?? ''),
          stocks: uniqueStocks(node.stocks),
          evidence: compactEvidence(node.evidence),
          chain: {
            score: finite(node.chain?.chain_score),
            phaseCount: Number(node.chain?.phase_count ?? 0),
            stockCount: Number(node.chain?.stock_count ?? 0),
            phases: [...new Set(node.chain?.phases ?? [])],
          },
        }))
        .sort(
          (a, b) =>
            a.time.localeCompare(b.time) ||
            a.importanceRank - b.importanceRank ||
            a.sector.localeCompare(b.sector, 'zh-CN'),
        ),
    };
  })
  .sort((a, b) => a.date.localeCompare(b.date));

const dynamicDates = probability?.coverage?.dynamic_dates ?? dates.length;
const dynamicCandidates =
  probability?.coverage?.candidate_rows ??
  (dynamic.days ?? []).reduce(
    (sum, day) => sum + Number(day.candidate_count ?? 0),
    0,
  );
const candidateEvents =
  probability?.coverage?.candidate_events ??
  (dynamic.days ?? []).reduce(
    (sum, day) =>
      sum +
      Object.entries(day.event_counts ?? {})
        .filter(([event]) => !String(event).startsWith('SECTOR_'))
        .reduce((inner, [, count]) => inner + Number(count ?? 0), 0),
    0,
  );
const checkpointCoverage = checkpoint.coverage ?? {};
const probabilityGates = probability?.gates ?? {};
const document = {
  version: 'v2.49-dashboard-dynamic-mainline-preview',
  status: dates.length ? 'READY' : 'MISSING',
  generatedAt: new Date().toISOString(),
  sourceState: 'ARCHIVED_REPLAY',
  sourceNotice:
    '历史逐分钟回放，非当前实时行情；节点由状态转折触发，不是固定时间报时。',
  coverage: {
    dates: dates.length,
    rawEvents: Number(mainline.coverage?.raw_events ?? 0),
    mergedNodes: Number(mainline.coverage?.merged_nodes ?? 0),
    visibleNodes: Number(mainline.coverage?.default_visible_nodes ?? 0),
    hiddenNodes: Number(mainline.coverage?.hidden_expandable_nodes ?? 0),
  },
  policy: {
    eventDriven: mainline.policy?.event_driven === true,
    fixedTimeSampling: mainline.policy?.fixed_time_sampling === true,
    outcomesUsedForRanking: mainline.policy?.outcomes_used_for_ranking === true,
    productionIntegrated: false,
  },
  probabilityResearch: {
    status: 'ACCUMULATING',
    checkpointDates: Number(checkpointCoverage.prior_trading_dates ?? 0),
    checkpointEvents: Number(checkpointCoverage.events_total ?? 0),
    checkpointPathSamples: Number(
      checkpointCoverage.expanded_intraday_sample ?? 0,
    ),
    checkpointRelationReady: Math.min(
      Number(checkpointCoverage.open_0935_relation_ready ?? 0),
      Number(checkpointCoverage.open_1000_relation_ready ?? 0),
    ),
    dynamicDates: Number(dynamicDates),
    dynamicDateTarget: 60,
    dynamicCandidates: Number(dynamicCandidates),
    dynamicCandidateEvents: Number(candidateEvents),
    labeledCandidates: Number(probability?.coverage?.label_ready_rows ?? 0),
    labels: [
      { key: 'positive_close', label: '收红' },
      { key: 'strict_reversal', label: '严格反包' },
      { key: 'resealed_limit_up', label: '重新涨停' },
    ],
    gates: {
      atLeast60DynamicDates:
        probabilityGates.at_least_60_dynamic_dates === true,
      atLeast300LabeledCandidates:
        probabilityGates.at_least_300_labeled_candidates === true,
      separateLabels: probabilityGates.all_rows_have_separate_labels === true,
      rollingHoldoutCompleted:
        probabilityGates.rolling_holdout_completed === true,
      probabilityCalibrated: probabilityGates.probability_calibrated === true,
    },
    checkpointStatisticalGatePassed:
      evaluation.statistical_release_gate_passed === true,
    calibratedProbabilityAvailable: false,
    scoringEnabled: false,
    selectionEnabled: false,
    productionIntegrated: false,
    note: '看板只展示样本覆盖和动态盘面节点；在滚动留出和概率校准通过前，不生成个股修复概率。',
  },
  dates,
  lineage: {
    mainlineSha256: hash(mainlineText),
    dynamicEventsSha256: hash(dynamicText),
    checkpointManifestSha256: hash(checkpointText),
    checkpointEvaluationSha256: hash(evaluationText),
    probabilityManifestSha256: probabilityManifestArg
      ? hash(await readFile(resolve(probabilityManifestArg), 'utf8'))
      : null,
  },
};

await writeFile(outputPath, `${JSON.stringify(document)}\n`, 'utf8');
console.log(
  JSON.stringify({
    output: outputPath,
    bytes: (await readFile(outputPath)).byteLength,
    dates: document.coverage.dates,
    visibleNodes: document.coverage.visibleNodes,
    dynamicCandidates: document.probabilityResearch.dynamicCandidates,
    labeledCandidates: document.probabilityResearch.labeledCandidates,
  }),
);
