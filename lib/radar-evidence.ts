export type RadarState = 'READY' | 'DEGRADED' | 'MISSING';
export type RadarBasis = 'SPEED' | 'DAY_CHANGE';
export type RadarMember = {
  code: string;
  name: string;
  changePct: number | null;
  speedPct: number | null;
  mainNetInflow: number | null;
  amount: number | null;
  industry: string;
  quoteTime?: string;
  contributionPct?: number | null;
  driverRole?: string;
};
export type RadarBoard = Omit<RadarMember, 'industry'>;
export type RadarEvent = RadarBoard & {
  direction: 'up' | 'down';
  selectionBasis: RadarBasis;
  memberCount: number | null;
  directionalCount: number | null;
  drivers: RadarMember[];
  members: RadarMember[];
  driverState: RadarState;
  driverBasis: string;
  memberQueriesReady: number;
  memberQueriesRequested: number;
  missingReasons: string[];
  windowReady?: boolean;
  displayChangePct?: number | null;
  displayFlow?: number | null;
};
export type RadarSnapshot = {
  dataVersion: number;
  status: RadarState;
  tradeDate: string;
  retrievedAt: string;
  requestedDate?: string;
  phase?: string;
  sessionState?: 'LIVE' | 'CLOSED';
  sourceState?: 'LIVE' | 'ARCHIVED' | 'STALE';
  source?: string;
  reason?: string;
  coverage: {
    reported: number;
    available: number;
    rankedCandidates: number;
    queryReady: number;
    queryRequested: number;
    excludedGroups: number;
    missingQueries: string[];
  };
  events: RadarEvent[];
  latencyMs?: number;
};

const number = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const text = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';
export function radarQuoteDate(value: string | undefined) {
  const stamp = value ? Date.parse(value) : NaN;
  return Number.isFinite(stamp)
    ? new Date(stamp + 8 * 3600_000)
        .toISOString()
        .slice(0, 10)
        .replaceAll('-', '')
    : null;
}

export function normalizeRadarRows(
  rows: Array<Record<string, unknown>>,
  tradeDate: string,
  asOf = Date.now(),
) {
  const result = new Map<string, RadarMember>();
  for (const row of rows) {
    const epoch = number(row.f124);
    const quoteTime =
      epoch !== null && epoch > 0 && epoch * 1000 <= asOf
        ? new Date(epoch * 1000).toISOString()
        : undefined;
    const code = text(row.f12);
    if (!code || !text(row.f14) || radarQuoteDate(quoteTime) !== tradeDate)
      continue;
    const next = {
      code,
      name: text(row.f14),
      changePct: number(row.f3),
      speedPct: number(row.f22),
      mainNetInflow: number(row.f62),
      amount: number(row.f6),
      industry: text(row.f100),
      quoteTime,
    };
    const prior = result.get(code);
    if (!prior || Date.parse(next.quoteTime!) >= Date.parse(prior.quoteTime!))
      result.set(code, next);
  }
  return [...result.values()];
}

export function mergeRadarQuotes<T extends RadarBoard>(rows: T[]) {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const prior = latest.get(row.code);
    if (
      !prior ||
      Date.parse(row.quoteTime ?? '') >= Date.parse(prior.quoteTime ?? '')
    )
      latest.set(row.code, row);
  }
  return [...latest.values()];
}

export function isThemeBoard(name: string) {
  return !/^(昨日|历史新高|历史新低|连板|涨停|跌停|百元股|低价股|高价股|B股|ST股|退市|沪股通|深股通|融资融券|转债标的|MSCI|富时罗素|上证\d|沪深\d|深证\d)/i.test(
    name,
  );
}

export function selectRadarBoards(boards: RadarBoard[], live: boolean) {
  const unique = [
    ...new Map(
      boards
        .filter((board) => isThemeBoard(board.name))
        .map((board) => [board.code, board]),
    ).values(),
  ];
  const selections: Array<
    RadarBoard & { direction: 'up' | 'down'; selectionBasis: RadarBasis }
  > = [];
  const used = new Set<string>();
  const select = (direction: 'up' | 'down', basis: RadarBasis) => {
    const key = basis === 'SPEED' ? 'speedPct' : 'changePct';
    const remaining =
      3 - selections.filter((row) => row.direction === direction).length;
    const candidates = unique
      .filter(
        (row) =>
          !used.has(row.code) &&
          row[key] !== null &&
          (direction === 'up' ? row[key]! > 0 : row[key]! < 0),
      )
      .sort((a, b) =>
        direction === 'up' ? b[key]! - a[key]! : a[key]! - b[key]!,
      )
      .slice(0, remaining);
    for (const row of candidates) {
      used.add(row.code);
      selections.push({ ...row, direction, selectionBasis: basis });
    }
  };
  if (live) {
    select('up', 'SPEED');
    select('down', 'SPEED');
  }
  select('up', 'DAY_CHANGE');
  select('down', 'DAY_CHANGE');
  return selections;
}

export function selectRadarDrivers(
  members: RadarMember[],
  direction: 'up' | 'down',
  basis: RadarBasis,
) {
  const key = basis === 'SPEED' ? 'speedPct' : 'changePct';
  const directional = [
    ...new Map(members.map((row) => [row.code, row])).values(),
  ].filter(
    (row) =>
      row[key] !== null && (direction === 'up' ? row[key]! > 0 : row[key]! < 0),
  );
  const aligned = (row: RadarMember) =>
    row.mainNetInflow !== null &&
    (direction === 'up' ? row.mainNetInflow > 0 : row.mainNetInflow < 0);
  const denominator = directional
    .filter(aligned)
    .reduce((sum, row) => sum + Math.abs(row.mainNetInflow!), 0);
  const drivers = directional
    .sort(
      (a, b) =>
        Number(aligned(b)) - Number(aligned(a)) ||
        (aligned(a) && aligned(b)
          ? Math.abs(b.mainNetInflow!) - Math.abs(a.mainNetInflow!)
          : Math.abs(b[key]!) - Math.abs(a[key]!)),
    )
    .slice(0, 4)
    .map((row) => ({
      ...row,
      driverRole: aligned(row)
        ? '价格与资金同向'
        : direction === 'up'
          ? '价格走强，资金未同向'
          : '价格走弱，资金未同向',
      contributionPct:
        aligned(row) && denominator > 0
          ? (Math.abs(row.mainNetInflow!) / denominator) * 100
          : null,
    }));
  return { drivers, directionalCount: directional.length };
}

export function radarDisplay(event: RadarEvent) {
  return {
    ...event,
    windowReady: false,
    displayChangePct:
      event.selectionBasis === 'DAY_CHANGE' ? event.changePct : event.speedPct,
    displayFlow: event.mainNetInflow,
  };
}

export function eligibleRadarTime(
  event: RadarEvent,
  snapshot: Pick<RadarSnapshot, 'tradeDate' | 'sourceState' | 'sessionState'>,
  now = Date.now(),
) {
  const time = Date.parse(event.quoteTime ?? '');
  if (
    snapshot.sourceState !== 'LIVE' ||
    snapshot.sessionState !== 'LIVE' ||
    radarQuoteDate(event.quoteTime) !== snapshot.tradeDate ||
    !Number.isFinite(time) ||
    time > now ||
    now - time > 90_000
  )
    return null;
  return time;
}

export function radarWindow(
  before: RadarEvent,
  after: RadarEvent,
  snapshot: Pick<RadarSnapshot, 'tradeDate' | 'sourceState' | 'sessionState'>,
  now = Date.now(),
) {
  const fallback = radarDisplay(after);
  const time = eligibleRadarTime(after, snapshot, now);
  const priorTime = Date.parse(before.quoteTime ?? '');
  if (
    time === null ||
    radarQuoteDate(before.quoteTime) !== snapshot.tradeDate ||
    !Number.isFinite(priorTime) ||
    time - priorTime < 165_000 ||
    time - priorTime > 210_000 ||
    before.code !== after.code
  )
    return fallback;
  const priceDelta = (a: number | null, b: number | null) =>
    a === null || b === null || b <= -100
      ? null
      : ((1 + a / 100) / (1 + b / 100) - 1) * 100;
  const boardChange = priceDelta(after.changePct, before.changePct);
  const boardFlow =
    after.mainNetInflow === null || before.mainNetInflow === null
      ? null
      : after.mainNetInflow - before.mainNetInflow;
  if (
    boardChange === null ||
    boardFlow === null ||
    (after.direction === 'up' ? boardChange <= 0 : boardChange >= 0)
  )
    return fallback;
  const base = new Map(before.members.map((member) => [member.code, member]));
  const alignedQuote = (member: RadarMember, anchor: number) => {
    const quote = Date.parse(member.quoteTime ?? '');
    return (
      radarQuoteDate(member.quoteTime) === snapshot.tradeDate &&
      quote <= anchor &&
      anchor - quote <= 30_000
    );
  };
  const members = after.members.flatMap((member) => {
    const prior = base.get(member.code);
    if (
      !prior ||
      !alignedQuote(member, time) ||
      !alignedQuote(prior, priorTime)
    )
      return [];
    const elapsed =
      Date.parse(member.quoteTime!) - Date.parse(prior.quoteTime!);
    if (elapsed < 165_000 || elapsed > 210_000) return [];
    const change = priceDelta(member.changePct, prior.changePct);
    if (change === null) return [];
    return [
      {
        ...member,
        changePct: change,
        mainNetInflow:
          member.mainNetInflow === null || prior.mainNetInflow === null
            ? null
            : member.mainNetInflow - prior.mainNetInflow,
      },
    ];
  });
  const { drivers, directionalCount } = selectRadarDrivers(
    members,
    after.direction,
    'DAY_CHANGE',
  );
  if (!drivers.length) return fallback;
  const boardAligns = after.direction === 'up' ? boardFlow > 0 : boardFlow < 0;
  const sourceComplete = [before, after].every(
    (event) =>
      event.driverState === 'READY' &&
      event.memberQueriesReady === event.memberQueriesRequested &&
      !event.missingReasons.length,
  );
  return {
    ...after,
    drivers,
    directionalCount,
    windowReady: true,
    displayChangePct: boardChange,
    displayFlow: boardFlow,
    driverState: (sourceComplete &&
    boardAligns &&
    drivers.some((row) => row.driverRole === '价格与资金同向')
      ? 'READY'
      : 'DEGRADED') as RadarState,
    driverBasis:
      '相隔约3分钟的真实报价；成分价格与资金变化仅作同步关联，不代表因果证明。资金占比仅针对同向样本。',
  };
}

export function normalizeLegacyRadar(snapshot: RadarSnapshot) {
  return {
    ...snapshot,
    dataVersion: 1,
    status: 'DEGRADED' as const,
    reason:
      '旧板块归档正在补查；其报价时间与查询明细未完整记录，暂不用于3分钟确认。',
    coverage: {
      ...snapshot.coverage,
      available: snapshot.coverage?.rankedCandidates ?? 0,
    },
    events: snapshot.events
      .filter(
        (event) =>
          isThemeBoard(event.name) &&
          (snapshot.sessionState !== 'CLOSED' ||
            (event.changePct !== null &&
              (event.direction === 'up'
                ? event.changePct > 0
                : event.changePct < 0))),
      )
      .map((event) => {
        const selectionBasis: RadarBasis =
          snapshot.sessionState === 'CLOSED' ? 'DAY_CHANGE' : 'SPEED';
        const members = event.members ?? [];
        const selected = selectRadarDrivers(
          members,
          event.direction,
          selectionBasis,
        );
        return {
          ...event,
          ...selected,
          selectionBasis,
          driverState: (selected.drivers.length
            ? 'DEGRADED'
            : 'MISSING') as RadarState,
          driverBasis:
            '最近成功日内快照，个股与板块同向展示；非当前实时，无同窗因果确认。',
        };
      }),
  };
}

export type RadarFetch = (options: {
  fs: string;
  fid: string;
  order: 0 | 1;
  pageSize: number;
  fields: string;
}) => Promise<{
  rows: Array<Record<string, unknown>>;
  total: number;
  stale?: boolean;
}>;
type RadarContext = Required<
  Pick<
    RadarSnapshot,
    'tradeDate' | 'requestedDate' | 'phase' | 'sessionState' | 'sourceState'
  >
>;
const RADAR_FIELDS = 'f12,f14,f3,f6,f22,f62,f100,f124';

// Ranking samples are intentionally bounded. Available never means the provider's full universe.
export async function buildRadarSnapshot(
  context: RadarContext,
  fetchRows: RadarFetch,
  now = Date.now(),
): Promise<RadarSnapshot> {
  const startedAt = Date.now();
  const live =
    context.sessionState === 'LIVE' && context.sourceState === 'LIVE';
  const read = async (fs: string, fid: string, order: 0 | 1) => {
    const label = `${fs} · ${fid === 'f22' ? '涨速' : fid === 'f62' ? '主力净额' : '日涨跌幅'}${order ? '降序' : '升序'}`;
    try {
      const payload = await fetchRows({
        fs,
        fid,
        order,
        pageSize: 40,
        fields: RADAR_FIELDS,
      });
      if (!Array.isArray(payload.rows) || !payload.rows.length)
        throw new Error('行情列表为空或字段缺失');
      const sampleNow = now + Date.now() - startedAt;
      const rows = normalizeRadarRows(
        payload.rows,
        context.tradeDate,
        sampleNow,
      );
      const field =
        fid === 'f22'
          ? 'speedPct'
          : fid === 'f62'
            ? 'mainNetInflow'
            : 'changePct';
      const valid = rows.filter((row) => row[field] !== null);
      const outdated =
        live &&
        rows.some((row) => sampleNow - Date.parse(row.quoteTime!) > 90_000);
      const stale = Boolean(payload.stale || outdated);
      const reasons = [
        rows.length < payload.rows.length
          ? '部分报价日期缺失、跨日或晚于读取时刻，已排除'
          : '',
        valid.length < rows.length ? '部分排序字段缺失' : '',
        stale ? '包含非当前实时报价' : '',
        !valid.length ? '没有目标交易日的有效报价' : '',
      ].filter(Boolean);
      return {
        rows,
        total: payload.total,
        ready: reasons.length === 0,
        stale,
        reasons: reasons.map((reason) => `${label}：${reason}`),
      };
    } catch (error) {
      return {
        rows: [] as RadarMember[],
        total: 0,
        ready: false,
        stale: false,
        reasons: [`${label}：${String(error)}`],
      };
    }
  };
  const querySpec: Array<[string, 0 | 1]> = live
    ? [
        ['f22', 1],
        ['f22', 0],
        ['f3', 1],
        ['f3', 0],
      ]
    : [
        ['f3', 1],
        ['f3', 0],
      ];
  const rankings = await Promise.all(
    querySpec.map(([fid, order]) => read('m:90+t:3', fid, order)),
  );
  const boards = mergeRadarQuotes(rankings.flatMap((result) => result.rows));
  const selected = selectRadarBoards(boards, live);
  const events: RadarEvent[] = [];
  let memberStale = false;
  for (let offset = 0; offset < selected.length; offset += 3) {
    const batch = await Promise.all(
      selected.slice(offset, offset + 3).map(async (board) => {
        const order = board.direction === 'up' ? 1 : 0;
        const queries = await Promise.all([
          read(
            `b:${board.code}`,
            board.selectionBasis === 'SPEED' ? 'f22' : 'f3',
            order,
          ),
          read(`b:${board.code}`, 'f62', order),
        ]);
        memberStale ||= queries.some((query) => query.stale);
        const members = mergeRadarQuotes(
          queries.flatMap((query) => query.rows),
        );
        const { drivers, directionalCount } = selectRadarDrivers(
          members,
          board.direction,
          board.selectionBasis,
        );
        const missingReasons = queries.flatMap((query) => query.reasons);
        if (board.changePct === null || board.mainNetInflow === null)
          missingReasons.push('板块价格或主力资金字段缺失');
        const field =
          board.selectionBasis === 'SPEED' ? 'speedPct' : 'changePct';
        if (
          members.some(
            (member) => member[field] === null || member.mainNetInflow === null,
          )
        )
          missingReasons.push('部分成分股价格或资金字段缺失，未按0处理');
        if (!drivers.length)
          missingReasons.push(
            members.length ? '有效样本中暂无同方向个股' : '成分行情不可用',
          );
        return {
          ...board,
          members,
          drivers,
          directionalCount,
          memberCount: Math.max(...queries.map((query) => query.total)) || null,
          memberQueriesReady: queries.filter((query) => query.ready).length,
          memberQueriesRequested: 2,
          driverState: (!members.length
            ? 'MISSING'
            : missingReasons.length
              ? 'DEGRADED'
              : 'READY') as RadarState,
          driverBasis: `${board.selectionBasis === 'DAY_CHANGE' ? '按目标交易日日涨跌幅' : '按当前报价涨速'}筛选同向个股，资金同向优先。合并价格榜与资金榜样本，非全成分因果归因；资金占比仅针对同向样本。`,
          missingReasons,
        };
      }),
    );
    events.push(...batch);
  }
  const missingQueries = rankings.flatMap((result) => result.reasons);
  const issues = [
    ...missingQueries,
    ...events.flatMap((event) =>
      event.missingReasons.map((reason) => `${event.name}：${reason}`),
    ),
  ];
  if (!events.length) issues.push('目标交易日暂无可用题材板块样本');
  const status: RadarState = !events.length
    ? 'MISSING'
    : issues.length
      ? 'DEGRADED'
      : 'READY';
  return {
    dataVersion: 2,
    ...context,
    status,
    retrievedAt: new Date(now).toISOString(),
    sourceState:
      memberStale || rankings.some((query) => query.stale)
        ? 'STALE'
        : context.sourceState,
    source: '东方财富公开行情 · 题材排名与双向成分样本',
    reason: issues.length ? issues.join('；') : undefined,
    coverage: {
      reported: Math.max(...rankings.map((query) => query.total)),
      available: boards.filter((board) => isThemeBoard(board.name)).length,
      rankedCandidates: boards.length,
      excludedGroups: boards.filter((board) => !isThemeBoard(board.name))
        .length,
      queryReady: rankings.filter((query) => query.ready).length,
      queryRequested: rankings.length,
      missingQueries,
    },
    events,
    latencyMs: Date.now() - startedAt,
  };
}

export type RadarHistory = Map<
  string,
  Array<{ at: number; event: RadarEvent }>
>;
export function windowedRadarEvents(
  data: RadarSnapshot,
  history: RadarHistory,
  now = Date.now(),
) {
  if (data.sourceState !== 'LIVE' || data.sessionState !== 'LIVE') {
    history.clear();
    return data.events.map((event) =>
      data.sourceState === 'STALE'
        ? {
            ...radarDisplay(event),
            driverState: 'DEGRADED' as const,
            driverBasis: `非当前实时。${event.driverBasis}`,
          }
        : radarDisplay(event),
    );
  }
  const current = new Set(
    data.events.map((event) => `${data.tradeDate}:${event.code}`),
  );
  for (const key of history.keys()) if (!current.has(key)) history.delete(key);
  return data.events.map((event) => {
    const key = `${data.tradeDate}:${event.code}`;
    const time = eligibleRadarTime(event, data, now);
    if (time === null) {
      history.delete(key);
      return {
        ...radarDisplay(event),
        driverState: 'DEGRADED' as const,
        driverBasis:
          '非当前实时：报价过期或时间未验证，保留原数值但不用于短窗确认。',
      };
    }
    const points = (history.get(key) ?? []).filter(
      (point) => point.at >= time - 210_000 && point.at <= time,
    );
    const base = [...points]
      .reverse()
      .find((point) => time - point.at >= 165_000);
    if (!points.some((point) => point.at === time))
      points.push({ at: time, event });
    history.set(key, points);
    return base
      ? radarWindow(base.event, event, data, now)
      : radarDisplay(event);
  });
}
