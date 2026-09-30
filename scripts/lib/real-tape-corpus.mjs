// Real-price fixtures, NOT program-labelled fixtures. Each scenario is cut from
// the immutable raw-minute archive BEFORE any system interpretation is applied.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { priceLimitState } from '../../lib/timeline-evidence.ts';

export const REAL_SCENARIOS = [
  {
    id: '0922-0945-space-repair-divergence',
    date: '2026-09-22',
    cutoff: '09:45',
    focus: [
      '001216',
      '603230',
      '002285',
      '601811',
      '000504',
      '600630',
      '002453',
      '600448',
      '600127',
    ],
  },
  {
    id: '0918-0940-peer-divergence',
    date: '2026-09-18',
    cutoff: '09:40',
    focus: ['001216', '603248', '003026', '605058'],
  },
  {
    id: '0918-1000-repair-separation',
    date: '2026-09-18',
    cutoff: '10:00',
    focus: ['001216', '603248', '003026', '605058'],
  },
  {
    id: '0924-0940-middle-warning',
    date: '2026-09-24',
    cutoff: '09:40',
    focus: [
      '601811',
      '000910',
      '600825',
      '001234',
      '002614',
      '600743',
      '600503',
      '603636',
    ],
  },
  {
    id: '0924-0940-outside-core-attacker',
    date: '2026-09-24',
    cutoff: '09:40',
    focus: ['600641', '002119', '688512'],
  },
];

export function loadRealScenario(scenario) {
  const file = new URL(
    '../../lib/emotion-tracking.generated.json',
    import.meta.url,
  );
  const bytes = fs.readFileSync(file),
    raw = JSON.parse(bytes).dates[scenario.date];
  if (!raw) throw new Error(`Missing actual source date ${scenario.date}`);
  const closes = JSON.parse(
    fs.readFileSync(
      new URL('../../lib/close-history.generated.json', import.meta.url),
    ),
  ).snapshots;
  const history = closes
    .filter((x) => x.date < scenario.date)
    .map((x) => ({ ...x, poolsReady: true, breadthReady: true }));
  const previous = history.find((x) => x.date === raw.previousDate);
  if (!previous) throw new Error('Exact preceding session missing');
  const meta = new Map(
    history
      .flatMap((x) => [
        ...x.ladders.flatMap((l) => l.stocks),
        ...x.failedStocks,
        ...x.limitDownStocks,
      ])
      .map((x) => [x.code, x]),
  );
  const prior = previous.ladders.flatMap((l) => l.stocks),
    priorMap = new Map(prior.map((x) => [x.code, x]));
  const trends = Object.fromEntries(
    Object.entries(raw.trends).map(([code, value]) => [
      code,
      {
        ...value,
        points: value.points.filter((p) => p.time <= scenario.cutoff),
      },
    ]),
  );
  const observedAt = `${scenario.date}T${scenario.cutoff}:00+08:00`;
  const quotes = Object.fromEntries(
    Object.entries(trends).flatMap(([code, t]) => {
      const p = t.points.at(-1);
      return p?.time === scenario.cutoff && t.preClose > 0
        ? [
            [
              code,
              {
                changePct: (p.price / t.preClose - 1) * 100,
                quoteTime: observedAt,
                source: t.source ?? raw.source,
              },
            ],
          ]
        : [];
    }),
  );
  const observed = Object.entries(trends).map(([code, t]) => {
    const p = t.points.at(-1),
      known = priorMap.get(code);
    const state = p
      ? priceLimitState(code, t.name, p.price, t.preClose)
      : 'UNKNOWN';
    return {
      code,
      name: t.name,
      industry: meta.get(code)?.industry ?? '未知',
      height: (known?.height ?? 0) + 1,
      changePct: quotes[code]?.changePct ?? null,
      firstTouch: null,
      lastSeal: null,
      breakCount: undefined,
      sealFund: null,
      observedPriceState: state,
    };
  });
  const stocks = observed.filter((s) => s.observedPriceState === 'LIMIT_UP');
  const failedStocks = observed.filter(
    (s) =>
      s.observedPriceState !== 'LIMIT_UP' &&
      trends[s.code].points.some(
        (p) =>
          priceLimitState(s.code, s.name, p.price, trends[s.code].preClose) ===
          'LIMIT_UP',
      ),
  );
  const limitDownStocks = observed.filter(
    (s) => s.observedPriceState === 'LIMIT_DOWN',
  );
  const rows = prior.map((s) => ({
    code: s.code,
    name: s.name,
    fromHeight: s.height,
    toHeight: s.height + 1,
    industry: s.industry,
    state: stocks.some((x) => x.code === s.code)
      ? 'SEALED'
      : failedStocks.some((x) => x.code === s.code)
        ? 'FAILED'
        : 'DROPPED',
    changePct: quotes[s.code]?.changePct ?? null,
    speedPct: null,
    quoteTime: quotes[s.code]?.quoteTime,
  }));
  const facts = {
    date: scenario.date,
    previousDate: previous.date,
    cutoff: scenario.cutoff,
    retrievedAt: observedAt,
    status: 'DEGRADED',
    poolsReady: true,
    coreStructureReady: true,
    breadthReady: false,
    coreContextReady: false,
    // Counts describe the observed raw-minute universe, not the entire market.
    limitUp: stocks.length,
    failed: failedStocks.length,
    limitDown: limitDownStocks.length,
    ladders: [...new Set(stocks.map((s) => s.height))].map((height) => ({
      height,
      stocks: stocks.filter((s) => s.height === height),
    })),
    highestBoard: Math.max(0, ...stocks.map((s) => s.height)),
    consecutiveCount: stocks.filter((s) => s.height >= 2).length,
    failedStocks,
    limitDownStocks,
    closeQuotes: quotes,
    breadth: {
      up: 0,
      down: 0,
      flat: 0,
      rowsAvailable: 0,
      medianChangePct: null,
    },
  };
  const sourceDay = {
    date: scenario.date,
    previousDate: previous.date,
    cutoff: scenario.cutoff,
    sessionState: 'LIVE',
    sourceState: 'LIVE',
    availableAt: observedAt,
    asOf: observedAt,
    source:
      raw.source +
      ' · event-time retrospective replay, not historical receipt proof',
    quotes,
    trends,
    // Deliberately OMIT retrospectively collected concepts and final-day pools.
    conceptsState: 'MISSING',
    noTrade: raw.noTrade ?? {},
  };
  return {
    scenario,
    sourceHash: createHash('sha256').update(bytes).digest('hex'),
    sourceDay,
    history,
    previous,
    facts,
    rows,
    stocks,
    universe: [...meta.values()].filter((s) => trends[s.code]),
    retrospective: true,
  };
}
