import document from '@/lib/close-derived-evidence.generated.json';
import type { FlowSnapshot, SectorFlowSeries } from '@/lib/market';

type DerivedFlowRow = {
  code: string;
  name: string;
  changePct: number | null;
  latestMainNetInflow: number;
  mainNetInflowPct: number | null;
  amount: number | null;
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
};

export type IntradayMinuteEvidence = {
  status: 'READY' | 'DEGRADED' | 'MISSING';
  resolution: string | null;
  minuteSnapshots: number;
  candidateCount: number;
  candidateWithObservations: number;
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
    cutoff: '15:00';
    sourceMode?: string;
    identityDate?: string;
    reported: number;
    available: number;
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
  return {
    code: row.code,
    name: row.name,
    changePct: row.changePct,
    latestMainNetInflow: row.latestMainNetInflow,
    delta5m: null,
    delta15m: null,
    delta30m: null,
    points: [{ time: '15:00', mainNetInflow: row.latestMainNetInflow }],
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
  return {
    status: 'DEGRADED',
    curveState: 'DEGRADED',
    splitState: 'MISSING',
    retrievedAt: `${digits(tradeDate).slice(0, 4)}-${digits(tradeDate).slice(4, 6)}-${digits(tradeDate).slice(6)}T15:00:00+08:00`,
    tradeDate: digits(tradeDate),
    requestedDate: digits(tradeDate),
    phase: '休市快照',
    sessionState: 'CLOSED',
    sourceState: 'ARCHIVED',
    lastPointTime: '15:00',
    source: '已校验CLOSE包·精确交易日15:00行业板块主力净额',
    reason:
      '已恢复当日收盘累计净流入/净流出；未保留板块分钟资金曲线，不计算5/15/30分钟分流',
    basis:
      '该降级回放只展示当日15:00累计主力净额。单点不冒充盘中曲线，也不用于判断持续流入或转弱。',
    coverage: {
      requested: day.flow.reported,
      available: day.flow.available,
    },
    series,
    allRows,
    split: {
      inflow: [],
      outflow: [],
      cumulativeInflow: inflows.slice(0, 6),
      cumulativeOutflow: outflows.slice(0, 6),
      persistentStrong: [],
      persistentWeak: [],
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
        ? ('READY' as const)
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
    reason: `价格和${day.speed.windowStart}—${day.speed.windowEnd}涨速已对齐；概念与近20日涨停次数仍独立校验`,
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
  return DERIVED.dates[digits(tradeDate)]?.intraday ?? null;
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
