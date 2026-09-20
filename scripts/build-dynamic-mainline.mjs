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
      'outputs/20260909/verification_v248_dynamic_mainline_r5_all/dynamic_mainline_nodes_v248.json',
    ),
);
const dynamicPath = resolve(
  valueAfter('--dynamic') ??
    resolve(
      recapRoot,
      'outputs/20260909/verification_v248_dynamic_relation_events_r3_all/dynamic_relation_events_v248.json',
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
const probabilityManifestPath = resolve(
  valueAfter('--probability-manifest') ??
    resolve(
      recapRoot,
      'outputs/20260920/verification_v250_multidimensional_outcomes_r1/manifest_v250.json',
    ),
);
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

function compactDrivers(value) {
  const rows = Array.isArray(value?.drivers) ? value.drivers : [];
  return [
    ...new Map(
      rows
        .filter((row) => row?.stock_code && row?.stock_name)
        .map((row) => [
          String(row.stock_code).padStart(6, '0'),
          {
            code: String(row.stock_code).padStart(6, '0'),
            name: String(row.stock_name),
            returnPct: finite(row.return_pct),
            windowChangePct: finite(row.change_window_pct),
          },
        ]),
    ).values(),
  ].slice(0, 5);
}

function minuteOf(clock) {
  const [hour, minute] = String(clock).split(':').map(Number);
  return hour * 60 + minute;
}

function normalizeSector(value) {
  const sector = String(value ?? '');
  return (
    {
      房地产开: '房地产开发',
      计算机设: '计算机设备',
      汽车零部: '汽车零部件',
      自动化设: '自动化设备',
      非金属材: '非金属材料',
      农产品加: '农产品加工',
    }[sector] ?? sector
  );
}

function phaseFamily(eventType) {
  if (['SECTOR_STARTUP', 'SECTOR_DIFFUSION'].includes(eventType))
    return 'RISE';
  if (
    ['CORE_BREADTH_DIVERGENCE', 'SECTOR_REALIZATION'].includes(eventType)
  )
    return 'FALL';
  return 'REPAIR';
}

function evidencePasses(node) {
  const e = node.evidence;
  const driverChanges = node.drivers
    .map((driver) => driver.windowChangePct)
    .filter((value) => value !== null);
  const maxDriverChange = driverChanges.length
    ? Math.max(...driverChanges)
    : 0;
  if (node.eventType === 'SECTOR_STARTUP')
    return (
      node.drivers.length >= 3 &&
      maxDriverChange >= 1 &&
      Number(e.median_change_window_pct ?? 0) >= 0.4 &&
      Number(e.breadth_change ?? 0) >= 0.12
    );
  if (node.eventType === 'SECTOR_DIFFUSION')
    return (
      node.drivers.length >= 3 &&
      maxDriverChange >= 0.8 &&
      Number(e.positive_rate ?? 0) >= 0.6 &&
      Number(e.strong_count ?? 0) >= 3
    );
  if (node.eventType === 'CORE_BREADTH_DIVERGENCE')
    return (
      node.drivers.length >= 3 &&
      Number(e.positive_rate_drop_from_peak ?? 0) <= -0.18
    );
  if (node.eventType === 'SECTOR_REALIZATION')
    return (
      node.drivers.length >= 3 &&
      Number(e.median_fade_from_peak_pct ?? 0) <= -0.4 &&
      Number(e.strong_count_drop_from_peak ?? 0) <= -2
    );
  if (
    ['ANTI_NUCLEAR_RECOVERY', 'SECOND_RECOVERY_SUPPORTED'].includes(
      node.eventType,
    )
  )
    return (
      node.stocks.length >= 2 &&
      Number(node.score ?? 0) >= 4.5 &&
      Number(e.sector_positive_rate ?? 0) >= 0.55
    );
  return false;
}

function phasePriority(node) {
  const priorities = {
    SECTOR_DIFFUSION: 6,
    SECTOR_STARTUP: 5,
    SECTOR_REALIZATION: 4,
    CORE_BREADTH_DIVERGENCE: 3,
    SECOND_RECOVERY_SUPPORTED: 2,
    ANTI_NUCLEAR_RECOVERY: 1,
  };
  return priorities[node.eventType] ?? 0;
}

function strictMainline(nodes) {
  const eligible = nodes.filter(evidencePasses);
  const sectorScores = new Map();
  for (const node of eligible) {
    const phases = new Set(
      eligible
        .filter((item) => item.sector === node.sector)
        .map((item) => phaseFamily(item.eventType)),
    );
    const score = Number(node.chain.score ?? node.score ?? 0) + phases.size * 0.4;
    sectorScores.set(
      node.sector,
      Math.max(sectorScores.get(node.sector) ?? 0, score),
    );
  }
  const leadingSectors = new Set(
    [...sectorScores.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
      .slice(0, 4)
      .map(([sector]) => sector),
  );
  const collapsed = [];
  for (const node of eligible
    .filter((item) => leadingSectors.has(item.sector))
    .sort(
      (a, b) =>
        a.time.localeCompare(b.time) ||
        Number(b.score ?? 0) - Number(a.score ?? 0),
    )) {
    const family = phaseFamily(node.eventType);
    const existingIndex = collapsed.findIndex(
      (item) =>
        item.sector === node.sector &&
        phaseFamily(item.eventType) === family &&
        Math.abs(minuteOf(item.time) - minuteOf(node.time)) <= 8,
    );
    if (existingIndex >= 0) {
      const existing = collapsed[existingIndex];
      if (
        phasePriority(node) > phasePriority(existing) ||
        Number(node.score ?? 0) > Number(existing.score ?? 0)
      )
        collapsed[existingIndex] = node;
      continue;
    }
    collapsed.push(node);
  }
  const selected = [];
  for (const node of collapsed.sort(
    (a, b) =>
      a.time.localeCompare(b.time) ||
      Number(b.score ?? 0) - Number(a.score ?? 0),
  )) {
    const simultaneous = selected.filter(
      (item) => Math.abs(minuteOf(item.time) - minuteOf(node.time)) <= 2,
    );
    if (simultaneous.length >= 2) continue;
    selected.push(node);
    if (selected.length >= 8) break;
  }
  return selected.map((node, index) => ({
    ...node,
    importanceRank: index + 1,
  }));
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

const [
  mainlineText,
  dynamicText,
  checkpointText,
  evaluationText,
  probabilityText,
] = await Promise.all([
  readFile(mainlinePath, 'utf8'),
  readFile(dynamicPath, 'utf8'),
  readFile(checkpointManifestPath, 'utf8'),
  readFile(checkpointEvaluationPath, 'utf8'),
  readFile(probabilityManifestPath, 'utf8'),
]);
const mainline = JSON.parse(mainlineText);
const dynamic = JSON.parse(dynamicText);
const checkpoint = JSON.parse(checkpointText);
const evaluation = JSON.parse(evaluationText);
const probability = JSON.parse(probabilityText);

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
      nodes: strictMainline(
        (day.nodes ?? []).map((node) => ({
          id: `${day.target_date}-${node.observed_at}-${node.sector}-${node.event_type}-${node.importance_rank_within_day}`,
          time: String(node.observed_at ?? ''),
          lastConfirmedAt: String(
            node.last_confirmed_at ?? node.observed_at ?? '',
          ),
          sector: normalizeSector(node.sector),
          eventType: String(node.event_type ?? ''),
          sourceLayer: String(node.source_layer ?? ''),
          score: finite(node.score),
          scoreBand: String(node.score_band ?? ''),
          mergedRawEvents: Number(node.merged_raw_events ?? 0),
          importanceRank: Number(node.importance_rank_within_day ?? 0),
          mainlineReason: String(node.mainline_reason ?? ''),
          stocks: uniqueStocks(node.stocks),
          drivers: compactDrivers(node.evidence),
          evidence: compactEvidence(node.evidence),
          chain: {
            score: finite(node.chain?.chain_score),
            phaseCount: Number(node.chain?.phase_count ?? 0),
            stockCount: Number(node.chain?.stock_count ?? 0),
            phases: [...new Set(node.chain?.phases ?? [])],
          },
        })),
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
const labelCoverage = probability?.coverage?.label_coverage ?? {};
const labelGroups = (probability?.label_groups ?? []).map((group) => ({
  key: String(group.key ?? ''),
  label: String(group.label ?? ''),
  description: String(group.description ?? ''),
  labels: (group.labels ?? []).map((label) => ({
    key: String(label.key ?? ''),
    label: String(label.label ?? ''),
    description: String(label.description ?? ''),
    readyCount: Number(labelCoverage[label.key]?.ready ?? 0),
    positiveCount: Number(labelCoverage[label.key]?.positive ?? 0),
    positiveRatePct: finite(labelCoverage[label.key]?.positive_rate_pct),
  })),
}));
const labels = labelGroups.flatMap((group) =>
  group.labels.map((label) => ({
    ...label,
    groupKey: group.key,
    groupLabel: group.label,
  })),
);
for (const day of dates) {
  day.visibleNodes = day.nodes.length;
  day.hiddenNodes = Math.max(0, day.mergedNodes - day.nodes.length);
  day.visibleSectorCount = new Set(day.nodes.map((node) => node.sector)).size;
}

const document = {
  version: 'v2.51-dashboard-strict-mainline-replay',
  status: dates.length ? 'READY' : 'MISSING',
  generatedAt: new Date().toISOString(),
  sourceState: 'ARCHIVED_REPLAY',
  sourceNotice:
    '历史逐分钟回放，非当前实时行情；只显示具备多只具体驱动股、板块宽度变化和全日相对强度的节点。指数分钟证据未接入时，不声称指数共振。',
  coverage: {
    dates: dates.length,
    rawEvents: Number(mainline.coverage?.raw_events ?? 0),
    mergedNodes: Number(mainline.coverage?.merged_nodes ?? 0),
    visibleNodes: dates.reduce((sum, day) => sum + day.nodes.length, 0),
    hiddenNodes: dates.reduce((sum, day) => sum + day.hiddenNodes, 0),
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
    labels,
    labelGroups,
    gates: {
      atLeast60DynamicDates:
        probabilityGates.at_least_60_dynamic_dates === true,
      atLeast300LabeledCandidates:
        probabilityGates.at_least_300_labeled_candidates === true,
      separateLabels:
        probability?.label_contract?.labels_stored_separately_from_features ===
          true &&
        probability?.label_contract?.same_or_future_outcome_used_as_feature ===
          false,
      labelCoverageComplete:
        probabilityGates.all_rows_have_separate_labels === true,
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
    note: '样本命中率只是结果基准，不是预测概率；各标签按各自可验证样本独立训练，在滚动留出和概率校准通过前不生成个股修复概率。',
  },
  dates,
  lineage: {
    mainlineSha256: hash(mainlineText),
    dynamicEventsSha256: hash(dynamicText),
    checkpointManifestSha256: hash(checkpointText),
    checkpointEvaluationSha256: hash(evaluationText),
    probabilityManifestSha256: hash(probabilityText),
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
