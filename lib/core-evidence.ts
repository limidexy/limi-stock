import type { CloseSnapshot } from './close-history';
import type { EmotionCoreEvidence, EmotionFacts } from './market-reading';
import type { EmotionTracking } from './emotion-tracking';
import type { RadarEvent } from './radar-evidence';

export type CoreTrackingPayload = EmotionTracking & {
  sourceState?: 'LIVE' | 'ARCHIVED' | 'STALE';
  retrievedAt?: string;
  availableAt?: string;
  concepts?: Record<string, string[]>;
  conceptsAvailableAt?: string;
  conceptsState?: 'READY' | 'DEGRADED' | 'MISSING' | 'RECOVERED_LATE';
  influenceHistory?: EmotionCoreEvidence['influenceHistory'];
};

export type CoreSpeedInput = {
  code: string;
  name: string;
  changePct: number | null;
  speedPct: number | null;
  amount?: number | null;
  turnoverPct?: number | null;
  mainNetInflow?: number | null;
  industry?: string;
  concepts?: string[];
  metadataState?: 'READY' | 'DEGRADED' | 'MISSING';
  metadataAsOf?: string;
  quoteTime?: string | null;
  quoteSource?: string | null;
};

export type CoreFlowInput = {
  code?: string;
  name: string;
  latestMainNetInflow: number;
  persistenceLabel?: string;
};

type CoreEvidenceWithHistory = EmotionCoreEvidence & {
  history?: EmotionFacts[];
};

const digits = (value: string) => value.replaceAll('-', '');

const dashedDate = (value: string) => {
  const normalized = digits(value);
  return /^\d{8}$/.test(normalized)
    ? `${normalized.slice(0, 4)}-${normalized.slice(4, 6)}-${normalized.slice(6)}`
    : value;
};

const localDateAt = (value: number) =>
  new Date(value + 8 * 3_600_000).toISOString().slice(0, 10);

const localClockAt = (value: number) =>
  new Date(value + 8 * 3_600_000).toISOString().slice(11, 19);

const fixedDecisionAt = (date: string, cutoff: string) =>
  `${dashedDate(date)}T${/^\d{2}:\d{2}:\d{2}$/.test(cutoff) ? cutoff : `${cutoff}:00`}+08:00`;

const liveDecisionAt = (value: number) =>
  `${localDateAt(value)}T${new Date(value + 8 * 3_600_000)
    .toISOString()
    .slice(11, 23)
    .replace(/\.000$/, '')}+08:00`;

function canUseLiveDecision(
  facts: EmotionFacts,
  tracking: CoreTrackingPayload | null | undefined,
  speed:
    | {
        tradeDate?: string;
        sourceState?: 'LIVE' | 'ARCHIVED' | 'STALE';
      }
    | null
    | undefined,
  now: number | undefined,
  sessionEvidence?: {
    date: string;
    sourceState?: string;
    sessionState?: string;
  },
) {
  if (!Number.isFinite(now) || facts.cutoff.slice(0, 5) === '15:00')
    return false;
  const date = dashedDate(facts.date);
  const currentDate = localDateAt(now!);
  const clock = localClockAt(now!);
  const inSession = clock >= '09:15:00' && clock <= '15:00:00';
  const sourceLive =
    (tracking?.date &&
      dashedDate(tracking.date) === date &&
      tracking.sourceState === 'LIVE' &&
      tracking.sessionState === 'LIVE') ||
    (speed?.tradeDate &&
      dashedDate(speed.tradeDate) === date &&
      speed.sourceState === 'LIVE') ||
    (sessionEvidence?.date &&
      dashedDate(sessionEvidence.date) === date &&
      sessionEvidence.sourceState === 'LIVE' &&
      sessionEvidence.sessionState === 'LIVE');
  const cutoff = fixedDecisionAt(date, facts.cutoff);
  const cutoffTime = Date.parse(cutoff);
  return (
    currentDate === date &&
    inSession &&
    sourceLive &&
    (!Number.isFinite(cutoffTime) || now! >= cutoffTime)
  );
}

function closeFacts(snapshot: CloseSnapshot): EmotionFacts {
  return {
    ...snapshot,
    date: snapshot.date,
    previousDate: snapshot.previousDate,
    status: snapshot.status,
    stale: false,
    poolsReady:
      snapshot.ladders.flatMap((level) => level.stocks).length ===
      snapshot.limitUp,
    breadthReady: snapshot.breadth.rowsAvailable > 0,
  };
}

export function buildCoreEvidence(args: {
  facts: EmotionFacts;
  tracking?: CoreTrackingPayload | null;
  speed?: {
    tradeDate?: string;
    retrievedAt?: string;
    sourceState?: 'LIVE' | 'ARCHIVED' | 'STALE';
    rows?: CoreSpeedInput[];
  } | null;
  radarEvents?: RadarEvent[];
  flowRows?: CoreFlowInput[];
  history?: CloseSnapshot[];
  now?: number;
  decisionMode?: 'LIVE' | 'FIXED';
  sessionEvidence?: {
    date: string;
    sourceState?: string;
    sessionState?: string;
  };
}): CoreEvidenceWithHistory {
  const {
    facts,
    tracking,
    speed,
    radarEvents = [],
    flowRows = [],
    history = [],
    now,
    decisionMode = 'FIXED',
    sessionEvidence,
  } = args;
  const factDate = digits(facts.date);
  const trackingDate = tracking?.date ? digits(tracking.date) : '';
  const trackingAligned = Boolean(tracking && trackingDate === factDate);
  const speedAligned = Boolean(
    speed?.tradeDate && digits(speed.tradeDate) === factDate,
  );
  const live =
    decisionMode === 'LIVE' &&
    canUseLiveDecision(facts, tracking, speed, now, sessionEvidence);
  const effectiveDecisionMode = live ? 'LIVE' : 'FIXED';
  const captured = Date.parse(facts.retrievedAt ?? '');
  const exactSnapshot =
    facts.cutoff !== '15:00' &&
    /^\d{2}:\d{2}$/.test(facts.cutoff) &&
    Number.isFinite(captured) &&
    localDateAt(captured) === dashedDate(facts.date) &&
    localClockAt(captured).slice(0, 5) === facts.cutoff;
  const decisionAt = live
    ? liveDecisionAt(now!)
    : exactSnapshot
      ? liveDecisionAt(captured)
      : fixedDecisionAt(facts.date, facts.cutoff);
  const availableAt = trackingAligned
    ? (tracking?.availableAt ?? tracking?.retrievedAt)
    : undefined;
  const result: CoreEvidenceWithHistory = {
    decisionAt,
    decisionMode: effectiveDecisionMode,
    date: facts.date,
    cutoff: facts.cutoff,
    sourceState: trackingAligned
      ? (tracking?.sourceState ?? 'ARCHIVED')
      : facts.stale
        ? 'STALE'
        : 'LIVE',
    retrievedAt: tracking?.retrievedAt,
    availableAt,
    source: tracking?.source,
    influenceHistory: tracking?.influenceHistory,
    tracking: trackingAligned
      ? ({
          ...tracking!,
          availableAt,
          concepts: tracking!.concepts,
          conceptsAvailableAt: tracking!.conceptsAvailableAt,
          conceptsState: tracking!.conceptsState,
        } as unknown as EmotionCoreEvidence['tracking'])
      : undefined,
    speedRows: speedAligned
      ? (speed!.rows ?? []).map((row) => ({
          ...row,
          availableAt: speed!.retrievedAt,
        }))
      : [],
    sectorEvents: radarEvents
      .filter((event) => event.direction === 'up' || event.direction === 'down')
      .map((event) => ({
        name: event.name,
        direction: event.direction,
        driverCodes: event.drivers.map((driver) => driver.code),
        driverNames: event.drivers.map((driver) => driver.name),
        driverState: event.driverState,
        windowReady: event.windowReady,
        quoteTime: event.quoteTime,
      })),
    flowRows,
    history: history.map(closeFacts),
  };
  return result;
}
