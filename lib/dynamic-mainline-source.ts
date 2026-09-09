import document from './dynamic-mainline.generated.json';

export type DynamicMainlineStock = {
  code: string;
  name: string;
  identities: string[];
  priorCoreCode: string | null;
  priorCoreName: string | null;
};

export type DynamicMainlineNode = {
  id: string;
  time: string;
  lastConfirmedAt: string;
  sector: string;
  eventType: string;
  sourceLayer: string;
  score: number | null;
  scoreBand: string;
  mergedRawEvents: number;
  importanceRank: number;
  mainlineReason: string;
  stocks: DynamicMainlineStock[];
  evidence: Record<string, string | number | boolean>;
  chain: {
    score: number | null;
    phaseCount: number;
    stockCount: number;
    phases: string[];
  };
};

export type DynamicMainlineDay = {
  date: string;
  priorDate: string | null;
  status: 'READY';
  resolution: string | null;
  minuteSnapshots: number;
  candidateCount: number;
  candidateWithObservations: number;
  rawEvents: number;
  mergedNodes: number;
  visibleNodes: number;
  hiddenNodes: number;
  visibleSectorCount: number;
  dynamicChainCutoff: number | null;
  nodes: DynamicMainlineNode[];
};

export type DynamicMainlineDocument = {
  version: string;
  status: 'READY' | 'MISSING';
  generatedAt: string;
  sourceState: 'ARCHIVED_REPLAY';
  sourceNotice: string;
  coverage: {
    dates: number;
    rawEvents: number;
    mergedNodes: number;
    visibleNodes: number;
    hiddenNodes: number;
  };
  policy: {
    eventDriven: boolean;
    fixedTimeSampling: boolean;
    outcomesUsedForRanking: boolean;
    productionIntegrated: boolean;
  };
  probabilityResearch: {
    status: 'ACCUMULATING';
    checkpointDates: number;
    checkpointEvents: number;
    checkpointPathSamples: number;
    checkpointRelationReady: number;
    dynamicDates: number;
    dynamicDateTarget: number;
    dynamicCandidates: number;
    dynamicCandidateEvents: number;
    labeledCandidates: number;
    labels: Array<{ key: string; label: string }>;
    gates: {
      atLeast60DynamicDates: boolean;
      atLeast300LabeledCandidates: boolean;
      separateLabels: boolean;
      rollingHoldoutCompleted: boolean;
      probabilityCalibrated: boolean;
    };
    checkpointStatisticalGatePassed: boolean;
    calibratedProbabilityAvailable: false;
    scoringEnabled: false;
    selectionEnabled: false;
    productionIntegrated: false;
    note: string;
  };
  dates: DynamicMainlineDay[];
  lineage: Record<string, string | null>;
};

export const DYNAMIC_MAINLINE_RESEARCH =
  document as unknown as DynamicMainlineDocument;
