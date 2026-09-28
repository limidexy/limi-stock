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
}): CoreEvidenceWithHistory {
  const {
    facts,
    tracking,
    speed,
    radarEvents = [],
    flowRows = [],
    history = [],
  } = args;
  const factDate = digits(facts.date);
  const trackingDate = tracking?.date ? digits(tracking.date) : '';
  const trackingAligned = Boolean(tracking && trackingDate === factDate);
  const speedAligned = Boolean(
    speed?.tradeDate && digits(speed.tradeDate) === factDate,
  );
  const availableAt = trackingAligned
    ? (tracking?.availableAt ?? tracking?.retrievedAt)
    : undefined;
  const result: CoreEvidenceWithHistory = {
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
    speedRows:
      speedAligned && speed?.sourceState !== 'STALE'
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
