import closeHistoryDocument from '@/lib/close-history.generated.json';
import type {
  AuctionOrderbookEvidence,
  IntradayMinuteEvidence,
} from '@/lib/close-derived-evidence';

export type CloseStock = {
  code: string;
  name: string;
  changePct: number | null;
  industry: string;
  height: number;
  firstTouch: string | null;
  lastSeal: string | null;
  breakCount: number;
  sealFund: number | null;
};

export type CloseSnapshot = {
  date: string;
  previousDate?: string;
  closeQuotes?: Record<
    string,
    {
      changePct: number;
      speedPct?: number | null;
      quoteTime: string;
      source: string;
    }
  >;
  cutoff: '15:00';
  status: 'READY';
  evidenceStatus?: 'READY' | 'DEGRADED';
  /**
   * 涨停/炸板/跌停三池若由「精确日期日线 OHLCV」重建（收盘价触及涨停价），
   * 池成员与连板高度精确，但封板时点/炸板次数不可得。仅此一项标记为重建，
   * 不代表整日快照降级，也不能据此声称有分时封板过程。
   */
  boardProcessReconstructed?: boolean;
  poolMode?: string;
  modules?: Record<
    string,
    {
      status: string;
      requested?: number;
      available?: number;
      reason?: string | null;
    }
  >;
  source: string;
  limitUp: number;
  failed: number;
  limitDown: number;
  sealRate: number;
  highestBoard: number;
  consecutiveCount: number;
  turnover: number;
  breadth: {
    scope?: string;
    requested: number;
    rowsAvailable: number;
    up: number;
    down: number;
    flat: number;
    medianChangePct: number;
  };
  indexMood: string;
  shortMood: string;
  cycleNode: string;
  concentratedIndustries: Array<{ name: string; count: number }>;
  leaders: string[];
  indices: Array<{
    code: string;
    name: string;
    close: number | null;
    changePct: number | null;
  }>;
  ladders: Array<{ height: number; stocks: CloseStock[] }>;
  failedStocks: CloseStock[];
  limitDownStocks: CloseStock[];
  coverage: { reported: number; available: number };
};

export type CloseHistoryDocument = {
  version: number;
  generatedAt: string;
  methodology: {
    facts: string;
    labels: string;
  };
  knownMissingDates?: string[];
  snapshots: CloseSnapshot[];
  archive?: {
    state: 'READY' | 'DEGRADED';
    mode: 'DYNAMIC' | 'BUNDLED_FALLBACK';
    latestDate: string;
    expectedDate?: string;
    marketDate?: string;
    requestedDate?: string;
    sessionState?: 'LIVE' | 'CLOSED';
    missingDates?: string[];
    availableDates?: number;
    message: string;
  };
};

export type IntradayEmotionSnapshot = {
  status: 'READY' | 'DEGRADED' | 'MISSING';
  retrievedAt: string;
  tradeDate: string;
  requestedDate?: string;
  phase: string;
  sessionState: 'LIVE' | 'CLOSED';
  sourceState: 'LIVE' | 'ARCHIVED' | 'STALE';
  cutoff: string;
  source: string;
  reason?: string;
  limitUp: number;
  failed: number;
  limitDown: number;
  sealRate: number;
  highestBoard: number;
  consecutiveCount: number;
  breadth: {
    rowsAvailable: number;
    up: number;
    down: number;
    flat: number;
    medianChangePct: number | null;
  };
  indexMood: string;
  shortMood: string;
  cycleNode: string;
  concentratedIndustries: Array<{ name: string; count: number }>;
  leaders: string[];
  intradayEvidence?: IntradayMinuteEvidence | null;
  auctionEvidence?: AuctionOrderbookEvidence | null;
  ladders?: CloseSnapshot['ladders'];
  failedStocks?: CloseStock[];
  limitDownStocks?: CloseStock[];
  indices?: CloseSnapshot['indices'];
  coverage: {
    poolsReady: number;
    poolsRequested: number;
    breadthReady: boolean;
  };
};

export const CLOSE_HISTORY =
  closeHistoryDocument as unknown as CloseHistoryDocument;
export const CLOSE_DATES = CLOSE_HISTORY.snapshots.map(
  (snapshot) => snapshot.date,
);
export const LATEST_CLOSE_DATE = CLOSE_DATES.at(-1) ?? '';
