export type EarlyObservationState = 'READY' | 'DEGRADED' | 'MISSING';

export type EarlyBoardQuote = {
  code: string;
  name: string;
  price: number | null;
  changePct: number | null;
  volume: number | null;
  amount: number | null;
  quoteTime: string;
};

export type EarlyObservationSnapshot = {
  status: EarlyObservationState;
  tradeDate: string;
  retrievedAt: string;
  quoteTime: string | null;
  latestQuoteTime: string | null;
  quoteAgeSeconds: number | null;
  quoteSpreadSeconds: number | null;
  source: string;
  scope: string;
  sourceState: 'LIVE' | 'STALE';
  reason?: string;
  coverage: {
    requested: number;
    exactDate: number;
    priced: number;
    volumeAndAmount: number;
    pagesRequested: number;
    pagesReceived: number;
  };
  breadth: { up: number; down: number; flat: number };
  rows: EarlyBoardQuote[];
};

export type EarlyObservationComparison = {
  baselineQuoteTime: string;
  latestQuoteTime: string;
  elapsedSeconds: number;
  quoteAdvanced: boolean;
  breadthDelta: { up: number; down: number; flat: number };
  matchedTurnoverBoards: number;
  medianVolumeChangePct: number | null;
  medianAmountChangePct: number | null;
};
