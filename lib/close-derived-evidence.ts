import document from '@/lib/close-derived-evidence.generated.json';
import type { FlowSnapshot, SectorFlowSeries } from '@/lib/market';

type DerivedFlowRow = {
  code: string;
  name: string;
  changePct: number | null;
  latestMainNetInflow: number;
  mainNetInflowPct: number | null;
  amount: number | null;
  points?: Array<{ time: string; mainNetInflow: number }>;
};

type DerivedSpeedRow = {
  code: string;
  name: string;
  price: number;
  changePct: number;
  speedPct: number;
  amount: number | null;
  turnoverPct: number | null;
  mainNetInflow: number | null;
  industry: string;
  concepts: string[];
  metadataState?: 'READY' | 'RECOVERED_LATE' | 'MISSING';
};

export type IntradayMinuteEvidence = {
  status: 'READY' | 'DEGRADED' | 'MISSING';
  resolution: string | null;
  minuteSnapshots: number;
  candidateCount: number;
  candidatePriceCovered?: number;
  candidateRelationEligible?: number;
  candidateWithObservations: number;
  candidateExclusions?: Array<{
    stock_code: string;
    stock_name: string;
    reason: string;
  }>;
  eventCounts: Record<string, number>;
  reason?: string | null;
};

export type AuctionOrderbookEvidence = {
  latestLocalDate: string | null;
  exactDateAvailable: boolean;
  orderbookReady: false;
  scoringEnabled: false;
  reason: string;
};

type DerivedDay = {
  flow?: {
    status: 'READY' | 'DEGRADED';
    curveStatus?: 'READY' | 'DEGRADED';
    cutoff: '15:00';
    sourceMode?: string;
    identityDate?: string;
    reported: number;
    available: number;
    curveRequested?: number;
    curveAvailable?: number;
    curveResolution?: string | null;
    rows: DerivedFlowRow[];
  } | null;
  speed?: {
    status: 'READY' | 'DEGRADED';
    cutoff: '15:00';
    windowStart: string;
    windowEnd: string;
    source: string;
    requested: number;
    available: number;
    metadataAvailable?: number;
    metadataAsOf?: string | null;
    metadataStatus?: 'READY' | 'RECOVERED_LATE' | 'DEGRADED' | 'MISSING';
    rows: DerivedSpeedRow[];
  } | null;
  intraday?: IntradayMinuteEvidence | null;
};

type DerivedDocument = {
  version: number;
  generatedAt: string;
  auction?: {
    latestLocalDate: string | null;
    availableDates: string[];
    orderbookReady: false;
    scoringEnabled: false;
    reason: string;
  };
  dates: Record<string, DerivedDay>;
};

const DERIVED = document as unknown as DerivedDocument;
const digits = (value: string) => value.replaceAll('-', '');

function flowSeries(row: DerivedFlowRow): SectorFlowSeries {
  const points = row.points?.length
    ? row.points
    : [{ time: '15:00', mainNetInflow: row.latestMainNetInflow }];
  const delta = (minutes: number) => {
    if (points.length <= minutes) return null;
    return points.at(-1)!.mainNetInflow - points.at(-(minutes + 1))!.mainNetInflow;
  };
  return {
    code: row.code,
    name: row.name,
    changePct: row.changePct,
    latestMainNetInflow: row.latestMainNetInflow,
    delta5m: delta(5),
    delta15m: delta(15),
    delta30m: delta(30),
    points,
    persistenceLabel:
      delta(5) !== null && delta(15) !== null && delta(30) !== null
        ? delta(5)! > 0 && delta(15)! > 0 && delta(30)! > 0
          ? '持续流入'
          : delta(5)! < 0 && delta(15)! < 0 && delta(30)! < 0
            ? '持续流出'
            : '资金拐点'
        : undefined,
    detailState: 'MISSING',
    detailBasis: '收盘包只保留板块15:00累计值，未保留成分分时资金路径',
    subgroups: [],
    representatives: [],
  };
}

export function archivedCloseFlow(
  tradeDate: string,
): (FlowSnapshot & { allRows: SectorFlowSeries[] }) | null {
  const day = DERIVED.dates[digits(tradeDate)];
  if (!day?.flow?.rows.length) return null;
  const allRows = day.flow.rows.map(flowSeries);
  const inflows = [...allRows]
    .filter((row) => row.latestMainNetInflow > 0)
    .sort((a, b) => b.latestMainNetInflow - a.latestMainNetInflow);
  const outflows = [...allRows]
    .filter((row) => row.latestMainNetInflow < 0)
    .sort((a, b) => a.latestMainNetInflow - b.latestMainNetInflow);
  const series = [...inflows.slice(0, 8), ...outflows.slice(0, 8)];
  const curveReady =
    day.flow.curveStatus === 'READY' &&
    (day.flow.curveAvailable ?? 0) === (day.flow.curveRequested ?? -1) &&
    series.every((row) => row.points.length >= 230);
  const persistentStrong = allRows
    .filter((row) => row.persistenceLabel === '持续流入')
    .sort((a, b) => (b.delta30m ?? 0) - (a.delta30m ?? 0))
    .slice(0, 8);
  const persistentWeak = allRows
    .filter((row) => row.persistenceLabel === '持续流出')
    .sort((a, b) => (a.delta30m ?? 0) - (b.delta30m ?? 0))
    .slice(0, 8);
  return {
    status: curveReady ? 'READY' : 'DEGRADED',
    curveState: curveReady ? 'READY' : 'DEGRADED',
    splitState: curveReady ? 'READY' : 'MISSING',
    retrievedAt: `${digits(tradeDate).slice(0, 4)}-${digits(tradeDate).slice(4, 6)}-${digits(tradeDate).slice(6)}T15:00:00+08:00`,
    tradeDate: digits(tradeDate),
    requestedDate: digits(tradeDate),
    phase: '休市快照',
    sessionState: 'CLOSED',
    sourceState: 'ARCHIVED',
    lastPointTime: '15:00',
    source: curveReady
      ? '已校验CLOSE包 + 精确交易日1分钟板块资金归档'
      : '已校验CLOSE包·精确交易日15:00行业板块主力净额',
    reason: curveReady
      ? '当日板块1分钟资金曲线已完整归档，可计算5/15/30分钟变化'
      : '已恢复收盘累计额；精确日期分钟曲线仍缺失',
    basis: curveReady
      ? '曲线经交易日、时间顺序、重复分钟和15:00截止校验。'
      : '只展示当日15:00累计主力净额；单点不冒充盘中曲线。',
    coverage: {
      requested: day.flow.curveRequested ?? day.flow.reported,
      available: day.flow.curveAvailable ?? 0,
    },
    series,
    allRows,
    split: {
      inflow: [],
      outflow: [],
      cumulativeInflow: inflows.slice(0, 6),
      cumulativeOutflow: outflows.slice(0, 6),
      persistentStrong,
      persistentWeak,
      positiveCount: inflows.length,
      negativeCount: outflows.length,
    },
  };
}

function nominalLimitPct(code: string, name: string) {
  if (name.includes('ST')) return 5;
  if (/^(300|301|688|689)/.test(code)) return 20;
  if (/^(4|8|92)/.test(code)) return 30;
  return 10;
}

export function archivedCloseSpeed(tradeDate: string) {
  const day = DERIVED.dates[digits(tradeDate)];
  if (!day?.speed?.rows.length) return null;
  const rows = day.speed.rows.slice(0, 12).map((row) => {
    const limitPct = nominalLimitPct(row.code, row.name);
    const distanceToLimitPct = Math.max(0, limitPct - row.changePct);
    return {
      ...row,
      concepts: row.concepts,
      metadataState: row.concepts.length
        ? row.metadataState === 'READY'
          ? ('READY' as const)
          : ('DEGRADED' as const)
        : ('MISSING' as const),
      recentLimitCount: null,
      recentLimitSessions: 20,
      recentLimitState: 'MISSING' as const,
      recentLimitMethod: '待用精确日线补充',
      limitPct,
      distanceToLimitPct,
      status:
        distanceToLimitPct <= 0.8
          ? '临近涨停'
          : row.speedPct >= 1
            ? '尾盘5分钟快速拉升'
            : row.changePct < 0
              ? '深水脉冲'
              : '尾盘加速',
    };
  });
  return {
    status: 'DEGRADED' as const,
    retrievedAt: `${digits(tradeDate).slice(0, 4)}-${digits(tradeDate).slice(4, 6)}-${digits(tradeDate).slice(6)}T15:00:00+08:00`,
    tradeDate: digits(tradeDate),
    requestedDate: digits(tradeDate),
    phase: '休市快照',
    sessionState: 'CLOSED' as const,
    sourceState: 'ARCHIVED' as const,
    source: '腾讯精确日1分钟全市场快照',
    reason: `价格和${day.speed.windowStart}—${day.speed.windowEnd}涨速已对齐；概念${day.speed.metadataStatus === 'READY' ? '已当日归档' : '为后补分类'}，近20日涨停次数仍独立校验`,
    coverage: {
      requested: rows.length,
      conceptReady: rows.filter((row) => row.metadataState === 'READY').length,
      recentLimitReady: 0,
    },
    rows,
  };
}

export function archivedIntradayEvidence(
  tradeDate: string,
): IntradayMinuteEvidence | null {
  const evidence = DERIVED.dates[digits(tradeDate)]?.intraday;
  if (!evidence) return null;
  return {
    status: evidence.status,
    resolution: evidence.resolution,
    minuteSnapshots: evidence.minuteSnapshots,
    candidateCount: evidence.candidateCount,
    candidatePriceCovered: evidence.candidatePriceCovered,
    candidateRelationEligible: evidence.candidateRelationEligible,
    candidateWithObservations: evidence.candidateWithObservations,
    candidateExclusions: evidence.candidateExclusions,
    eventCounts: evidence.eventCounts,
    reason: evidence.reason,
  };
}

export function archivedAuctionEvidence(
  tradeDate: string,
): AuctionOrderbookEvidence {
  const target = digits(tradeDate);
  const availableDates = DERIVED.auction?.availableDates ?? [];
  return {
    latestLocalDate: DERIVED.auction?.latestLocalDate ?? null,
    exactDateAvailable: availableDates.includes(target),
    orderbookReady: false,
    scoringEnabled: false,
    reason:
      DERIVED.auction?.reason ?? '目标交易日真实竞价订单簿语义和覆盖未校验',
  };
}
