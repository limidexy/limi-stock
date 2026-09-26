import {
  emotionReading,
  finite,
  ladderReading,
  shortEmotionReading,
  type EmotionFacts,
  type ReadingLadder,
} from '@/lib/market-reading';
import type { CloseSnapshot } from '@/lib/close-history';
import type {
  AuctionOrderbookEvidence,
  IntradayMinuteEvidence,
} from '@/lib/close-derived-evidence';
import { alignedEvidence } from '@/lib/unified-market-evidence';
import type { RadarEvent, RadarSnapshot } from '@/lib/radar-evidence';

export type KnowledgeState = 'READY' | 'DEGRADED' | 'MISSING';
export type KnowledgeJudgment = 'CONFIRMED' | 'OBSERVE' | 'UNCONFIRMED';
export type KnowledgeTone = 'positive' | 'negative' | 'mixed' | 'neutral';

export type KnowledgeModule = {
  id:
    | 'environment'
    | 'emotion'
    | 'profit'
    | 'mainline'
    | 'high-board'
    | 'relay'
    | 'leader'
    | 'expectation'
    | 'auction'
    | 'chips'
    | 'intraday'
    | 'risk';
  name: string;
  question: string;
  conclusion: string;
  state: KnowledgeState;
  judgment: KnowledgeJudgment;
  tone: KnowledgeTone;
  evidence: string[];
  boundary: string;
  next: string;
};

export type UnifiedFlow = {
  status: KnowledgeState;
  tradeDate: string;
  sessionState?: 'LIVE' | 'CLOSED';
  sourceState?: 'LIVE' | 'ARCHIVED' | 'STALE';
  reason?: string;
  series: Array<{
    code: string;
    name: string;
    latestMainNetInflow: number;
    persistenceLabel?: string;
  }>;
  split: {
    cumulativeInflow: Array<{
      code: string;
      name: string;
      latestMainNetInflow: number;
      persistenceLabel?: string;
    }>;
    persistentStrong: Array<{
      code: string;
      name: string;
      latestMainNetInflow: number;
      persistenceLabel?: string;
    }>;
  };
  allRows?: Array<{
    code: string;
    name: string;
    latestMainNetInflow: number;
    persistenceLabel?: string;
  }>;
};

export type UnifiedSpeed = {
  status: KnowledgeState;
  tradeDate: string;
  sourceState?: 'LIVE' | 'ARCHIVED' | 'STALE';
  rows: Array<{
    code: string;
    name: string;
    changePct: number | null;
    speedPct: number | null;
    concepts: string[];
  }>;
};

export type UnifiedMarketInput = {
  facts: EmotionFacts;
  close?: CloseSnapshot | null;
  previousClose?: CloseSnapshot | null;
  ladder?: ReadingLadder | null;
  radar?: RadarSnapshot | null;
  radarEvents: RadarEvent[];
  flow?: UnifiedFlow | null;
  speed?: UnifiedSpeed | null;
  intradayEvidence?: IntradayMinuteEvidence | null;
  auctionEvidence?: AuctionOrderbookEvidence | null;
};

export type UnifiedMarketReading = {
  status: KnowledgeState;
  date: string;
  cutoff: string;
  headline: string;
  factChain: string;
  modules: KnowledgeModule[];
  readyCount: number;
  degradedCount: number;
  missingCount: number;
};

const date = (value?: string) => (value ?? '').replaceAll('-', '');
const pct = (value: number | null, digits = 1) =>
  value === null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`;
const money = (value: number | null | undefined) =>
  !finite(value) ? '—' : `${(value / 100_000_000).toFixed(1)}亿`;
const turnover = (value: number) =>
  `${(value / 1_000_000_000_000).toFixed(2)}万亿`;
const sameDate = (target: string, other?: string) =>
  Boolean(target && other && date(target) === date(other));

function conceptResonance(speed?: UnifiedSpeed | null) {
  const ignored = new Set([
    '融资融券',
    '深股通',
    '沪股通',
    'MSCI中国',
    '富时罗素',
    '标普道琼斯A股',
    '国企改革',
    '央企改革',
    '专精特新',
  ]);
  const counts = new Map<string, { count: number; stocks: string[] }>();
  for (const row of speed?.rows ?? []) {
    for (const concept of new Set(
      row.concepts.filter((item) => !ignored.has(item)),
    )) {
      const prior = counts.get(concept) ?? { count: 0, stocks: [] };
      counts.set(concept, {
        count: prior.count + 1,
        stocks: [...prior.stocks, row.name],
      });
    }
  }
  return [...counts.entries()]
    .filter(([, value]) => value.count >= 2)
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))[0];
}

function flowFor(name: string, flow?: UnifiedFlow | null) {
  return [
    ...(flow?.allRows ?? []),
    ...(flow?.split.persistentStrong ?? []),
    ...(flow?.split.cumulativeInflow ?? []),
    ...(flow?.series ?? []),
  ].find((row) => row.name === name);
}

export function unifiedMarketReading(
  input: UnifiedMarketInput,
): UnifiedMarketReading {
  const {
    facts,
    close,
    previousClose,
    ladder,
    radar,
    radarEvents,
    flow,
    speed,
    intradayEvidence,
    auctionEvidence,
  } = input;
  const observed = emotionReading(facts);
  const previousFacts: EmotionFacts | null = previousClose
    ? {
        ...previousClose,
        poolsReady: true,
        breadthReady: true,
      }
    : null;
  const short = shortEmotionReading(facts, previousFacts, ladder);
  const cohort = ladderReading(ladder, facts.date);
  const quoteReady = cohort.ready && cohort.all.priceReady === cohort.all.count;
  const alignedClose = close && sameDate(facts.date, close.date) ? close : null;
  const alignedPrevious =
    alignedClose &&
    previousClose &&
    date(previousClose.date) < date(alignedClose.date)
      ? previousClose
      : null;
  const turnoverDelta =
    alignedClose && alignedPrevious && alignedPrevious.turnover > 0
      ? (alignedClose.turnover / alignedPrevious.turnover - 1) * 100
      : null;
  const liquidity =
    turnoverDelta === null
      ? '成交环境数据不足'
      : turnoverDelta >= 5
        ? '增量环境'
        : turnoverDelta <= -5
          ? '缩量环境'
          : '存量环境';

  const alignedFlow = alignedEvidence(facts.date, flow);
  const alignedSpeed = alignedEvidence(facts.date, speed);
  const topRising = radarEvents.find((event) => event.direction === 'up');
  const topFalling = radarEvents.find((event) => event.direction === 'down');
  const risingFlow = topRising
    ? flowFor(topRising.name, alignedFlow)
    : undefined;
  const flowAligned = Boolean(
    topRising &&
    risingFlow &&
    risingFlow.latestMainNetInflow > 0 &&
    topRising.driverState === 'READY' &&
    topRising.drivers.length >= 2,
  );
  const resonance = conceptResonance(alignedSpeed);

  const relayWinners = cohort.ready
    ? cohort.rows.filter((row) => row.fromHeight >= 2 && row.state === 'SEALED')
    : [];
  const relayLosers = cohort.ready
    ? cohort.rows
        .filter(
          (row) =>
            row.fromHeight >= 2 &&
            row.state !== 'SEALED' &&
            finite(row.changePct) &&
            row.changePct < 0,
        )
        .sort((a, b) => a.changePct! - b.changePct!)
    : [];
  const topHeight = Math.max(
    0,
    ...(facts.ladders ?? []).map((level) => level.height),
  );
  const topStocks =
    facts.ladders?.find((level) => level.height === topHeight)?.stocks ?? [];
  const strongestPeer = cohort.ready
    ? [...cohort.rows]
        .filter((row) => finite(row.changePct))
        .sort(
          (a, b) =>
            Number(b.state === 'SEALED') - Number(a.state === 'SEALED') ||
            b.fromHeight - a.fromHeight ||
            b.changePct! - a.changePct!,
        )[0]
    : undefined;
  const weakestPeer = cohort.ready
    ? [...cohort.rows]
        .filter((row) => finite(row.changePct))
        .sort(
          (a, b) =>
            Number(a.state === 'SEALED') - Number(b.state === 'SEALED') ||
            b.fromHeight - a.fromHeight ||
            a.changePct! - b.changePct!,
        )[0]
    : undefined;
  const boardProcess = (facts.ladders ?? [])
    .flatMap((level) => level.stocks)
    .filter(
      (stock) =>
        stock.firstTouch !== undefined &&
        stock.breakCount !== undefined &&
        stock.lastSeal !== undefined,
    );
  const resealed = boardProcess.filter((stock) => (stock.breakCount ?? 0) > 0);
  const oneWord = boardProcess.filter(
    (stock) => stock.firstTouch === '09:25' && (stock.breakCount ?? 0) === 0,
  );
  const windowEvents = radarEvents.filter((event) => event.windowReady);
  const minuteEvidenceReady =
    intradayEvidence?.status === 'READY' &&
    intradayEvidence.resolution === 'ONE_MINUTE_LAST_FULL_MARKET_SNAPSHOT' &&
    intradayEvidence.minuteSnapshots >= 241;
  const relationEvidenceReady = Boolean(
    minuteEvidenceReady &&
    intradayEvidence &&
    (intradayEvidence.candidateRelationEligible ??
      intradayEvidence.candidateCount) > 0 &&
    intradayEvidence.candidateWithObservations ===
      (intradayEvidence.candidateRelationEligible ??
        intradayEvidence.candidateCount),
  );
  const relationEventCount = Object.values(
    intradayEvidence?.eventCounts ?? {},
  ).reduce((sum, count) => sum + count, 0);

  const environmentState: KnowledgeState =
    turnoverDelta !== null && observed.indexReady && observed.breadthReady
      ? 'READY'
      : alignedClose || observed.indexReady || observed.breadthReady
        ? 'DEGRADED'
        : 'MISSING';
  const emotionState: KnowledgeState =
    observed.usable && short.status === 'READY' ? 'READY' : 'DEGRADED';

  const modules: KnowledgeModule[] = [
    {
      id: 'environment',
      name: '市场环境',
      question: '流动性和指数风险环境是什么？',
      conclusion: `${liquidity} · ${observed.indexMood} · ${observed.broad}`,
      state: environmentState,
      judgment: environmentState === 'READY' ? 'CONFIRMED' : 'OBSERVE',
      tone:
        observed.indexMood === '三大指数上涨' && observed.broad === '多数上涨'
          ? 'positive'
          : observed.indexMood === '三大指数下跌' &&
              observed.broad === '多数下跌'
            ? 'negative'
            : 'mixed',
      evidence: [
        turnoverDelta === null
          ? '缺少同口径相邻收盘成交额，不能判定增量/存量/缩量'
          : `两市成交额 ${turnover(alignedClose!.turnover)}，较前收盘 ${pct(turnoverDelta)}`,
        `指数：${observed.indexMood}；赚钱面：${observed.broad}`,
      ],
      boundary:
        '±5%仅用于描述成交环境变化，不是策略阈值，也不代表特定风格必然有效。',
      next: '如果成交额扩张且指数、上涨面同向改善，则确认风险偏好扩张；否则按存量轮动理解。',
    },
    {
      id: 'emotion',
      name: '三层情绪',
      question: '总体、短线、核心是否共振？',
      conclusion: `${observed.indexMood}｜${observed.board}｜${short.highBoard.label}、${short.relay.label}`,
      state: emotionState,
      judgment: emotionState === 'READY' ? 'CONFIRMED' : 'OBSERVE',
      tone:
        short.highBoard.tone === 'negative' || short.relay.tone === 'negative'
          ? 'negative'
          : short.highBoard.tone === 'positive' &&
              short.relay.tone === 'positive'
            ? 'positive'
            : 'mixed',
      evidence: [
        `总体：${observed.indexMood}，${observed.broad}`,
        `短线：涨停${facts.limitUp}、炸板${facts.failed}、跌停${facts.limitDown}，封板率${observed.sealRate === null ? '—' : `${observed.sealRate.toFixed(1)}%`}`,
        `核心：${short.highBoard.label}；接力：${short.relay.label}`,
        `群体转折：${short.transition}`,
      ],
      boundary: '指数、短线和核心情绪分层展示，任何一层都不能替代另外两层。',
      next: '如果高标稳定、中位负反馈减少且低位补充增加，才从修复尝试升级为修复扩散。',
    },
    {
      id: 'profit',
      name: '赚钱效应',
      question: '资金正在重复模仿什么？',
      conclusion: cohort.ready
        ? relayWinners.length
          ? `连板正反馈集中在${relayWinners
              .slice(0, 3)
              .map((row) => row.name)
              .join('、')}`
          : resonance
            ? `${resonance[0]}出现涨速共振，连板正反馈不足`
            : '连板正反馈不足，赚钱模式分散'
        : '连板样本不完整，赚钱模式不能定性',
      state:
        cohort.ready && alignedSpeed?.rows.length
          ? 'READY'
          : cohort.ready
            ? 'DEGRADED'
            : 'MISSING',
      judgment: relayWinners.length >= 2 || resonance ? 'CONFIRMED' : 'OBSERVE',
      tone: relayWinners.length >= 2 ? 'positive' : 'mixed',
      evidence: [
        cohort.ready
          ? `昨日2板及以上 ${cohort.consecutive.advanced}/${cohort.consecutive.count}只晋级，样本数${cohort.consecutive.count}`
          : '缺少同日期、同口径的前一日连板身份池',
        resonance
          ? `涨速榜${resonance[0]}同现${resonance[1].count}只：${resonance[1].stocks.slice(0, 4).join('、')}`
          : alignedSpeed
            ? '当日涨速榜暂未形成至少2只的同概念共振'
            : speed
              ? `涨速证据日期${speed.tradeDate}与当日不一致，已停用`
              : '缺少当日涨速证据',
      ],
      boundary:
        '当前只覆盖连板和涨速共振，尚未完整覆盖20cm、容量趋势、低吸和反包模式。',
      next: '如果同一模式连续获得次日溢价且样本扩大，才把它升级为可重复的赚钱效应。',
    },
    {
      id: 'mainline',
      name: '主线',
      question: '哪个方向正在形成持续共识？',
      conclusion: topRising
        ? `${flowAligned ? '主线候选' : '强势方向'}：${topRising.name}${flowAligned ? '（价格与资金同向）' : '；持续性未确认'}`
        : '当前没有达到异动阈值的强势方向',
      state: topRising
        ? topRising.driverState === 'READY' &&
          (Boolean(risingFlow) || topRising.windowReady)
          ? 'READY'
          : 'DEGRADED'
        : radar?.status === 'MISSING'
          ? 'MISSING'
          : 'DEGRADED',
      judgment: flowAligned
        ? 'CONFIRMED'
        : topRising
          ? 'OBSERVE'
          : 'UNCONFIRMED',
      tone: flowAligned ? 'positive' : 'mixed',
      evidence: topRising
        ? [
            `${topRising.name}${topRising.selectionBasis === 'SPEED' ? '短窗涨速' : '日内涨幅'}${pct(topRising.displayChangePct ?? topRising.changePct)}`,
            `${
              topRising.drivers
                .slice(0, 4)
                .map((stock) => stock.name)
                .join('、') || '驱动股不可用'
            }参与驱动`,
            risingFlow
              ? `板块主力净额${money(risingFlow.latestMainNetInflow)}${risingFlow.persistenceLabel ? `，${risingFlow.persistenceLabel}` : ''}`
              : alignedFlow
                ? `当日资金表未找到“${topRising.name}”同名板块，概念与行业口径不同，未强行映射`
                : flow
                  ? `资金数据日期${flow.tradeDate}未与${facts.date}对齐，已停用`
                  : '未取得同板块资金流证据',
          ]
        : [radar?.reason ?? '板块价格、资金与成分股证据不足'],
      boundary:
        '强势板块不自动等于主线；驱动、梯队、容量、持续和分歧回流尚未全部满足。',
      next: '如果核心主动走强、助攻快速出现、容量载体承接且分歧后回流，才升级为主线确认。',
    },
    {
      id: 'high-board',
      name: '高标',
      question: '风险偏好上限是否稳定？',
      conclusion: short.highBoard.label,
      state:
        short.highBoard.rows.length && short.status === 'READY'
          ? 'READY'
          : 'DEGRADED',
      judgment:
        short.highBoard.rows.length && short.status === 'READY'
          ? 'CONFIRMED'
          : 'OBSERVE',
      tone:
        short.highBoard.tone === 'unknown' ? 'neutral' : short.highBoard.tone,
      evidence: short.highBoard.evidence.map(
        (item) => `${item.label}：${item.value}`,
      ),
      boundary:
        '高标是动态高位生态，不用单一最高板或某只核心存活替代群体反馈。',
      next: '如果最高两档抗住分歧且中位不再扩散亏钱效应，则高标风险上限稳定；否则继续降级。',
    },
    {
      id: 'relay',
      name: '接力',
      question: '赚钱效应还能向上传递吗？',
      conclusion: short.relay.label,
      state:
        short.relay.candidateCount >= 3 && short.status === 'READY'
          ? 'READY'
          : 'DEGRADED',
      judgment:
        short.relay.candidateCount >= 3 && short.status === 'READY'
          ? 'CONFIRMED'
          : 'OBSERVE',
      tone: short.relay.tone === 'unknown' ? 'neutral' : short.relay.tone,
      evidence: short.relay.evidence.map(
        (item) => `${item.label}：${item.value}`,
      ),
      boundary:
        '晋级率、封板率、失败代价和梯队连续性共同决定接力，不把高封板率单独当成强。',
      next: '如果晋级意愿、封板稳定性和中位反馈同时改善，才确认接力增强。',
    },
    {
      id: 'leader',
      name: '龙头 / 角色',
      question: '谁拥有主动性、带动性与抗跌性？',
      conclusion: topStocks.length
        ? `${topStocks.length === 1 ? '高位核心候选' : '同身位核心竞争'}：${topStocks.map((stock) => stock.name).join('、')}`
        : '高位核心候选尚未形成',
      state:
        topStocks.length && boardProcess.length
          ? 'READY'
          : topStocks.length
            ? 'DEGRADED'
            : 'MISSING',
      judgment: topStocks.length ? 'OBSERVE' : 'UNCONFIRMED',
      tone: topStocks.length === 1 ? 'mixed' : 'neutral',
      evidence: [
        topStocks.length
          ? `当前${topHeight}板：${topStocks.map((stock) => `${stock.name}（${stock.industry}）`).join('、')}`
          : '没有完整高标梯队',
        topStocks.length
          ? `封板过程：${topStocks.map((stock) => `${stock.name}${stock.firstTouch ?? '—'}首触/${stock.breakCount ?? '—'}次炸板`).join('；')}`
          : '封板过程不可用',
      ],
      boundary:
        '先涨停或板数最高只获得候选资格；缺少逐分钟先后与板块响应时，不授予“真正龙头”。',
      next: '如果它先于板块启动、随后带来快速助攻，并在分歧中最抗跌，才从候选升级为龙头。',
    },
    {
      id: 'expectation',
      name: '预期差',
      question: '谁明显高于或低于应有表现？',
      conclusion:
        strongestPeer && weakestPeer
          ? `同窗分离：${strongestPeer.name}强于${weakestPeer.name}`
          : '参照系不完整，不能判断超预期',
      state: quoteReady && strongestPeer && weakestPeer ? 'READY' : 'MISSING',
      judgment:
        quoteReady && strongestPeer && weakestPeer ? 'OBSERVE' : 'UNCONFIRMED',
      tone: strongestPeer && weakestPeer ? 'mixed' : 'neutral',
      evidence:
        strongestPeer && weakestPeer
          ? [
              `强侧：${strongestPeer.name}，昨${strongestPeer.fromHeight}板，今${pct(strongestPeer.changePct)}`,
              `弱侧：${weakestPeer.name}，昨${weakestPeer.fromHeight}板，今${pct(weakestPeer.changePct)}`,
            ]
          : ['缺少完整同身位价格与身份样本'],
      boundary:
        '当前比较的是同窗相对表现；昨日板质、换手、竞价和题材环境未齐，不使用“弱转强”标签。',
      next: '如果个股相对同身位、板块和市场持续主动分离，且竞价与盘中承接一致，才确认超预期。',
    },
    {
      id: 'auction',
      name: '集合竞价',
      question: '隔夜预期如何重新定价？',
      conclusion: '真实订单簿语义未接入，竞价评分关闭',
      state: 'MISSING',
      judgment: 'UNCONFIRMED',
      tone: 'neutral',
      evidence: [
        'ORDERBOOK_READY=false',
        'scoringEnabled=false；DISPLAY_READY不能替代真实09:15—09:25订单簿',
        auctionEvidence?.latestLocalDate
          ? `本机异动系统订单簿最新日期${auctionEvidence.latestLocalDate}，与${facts.date}不一致，已禁止使用`
          : '本机未找到目标交易日订单簿证据',
      ],
      boundary:
        '没有反复验证虚拟价格、匹配量和未匹配量，就不判断抢筹、撤单或弱转强。',
      next: '只有真实竞价窗口的价格、匹配量、未匹配量语义和覆盖率同时通过，才启用判断。',
    },
    {
      id: 'chips',
      name: '量价筹码',
      question: '筹码是否完成健康交换？',
      conclusion: boardProcess.length
        ? `封板过程可见：一字一致${oneWord.length}只，开板回封${resealed.length}只；筹码交换仍未完整定性`
        : '封板过程和换手证据不足',
      state: boardProcess.length ? 'DEGRADED' : 'MISSING',
      judgment: boardProcess.length ? 'OBSERVE' : 'UNCONFIRMED',
      tone: resealed.length > 0 ? 'mixed' : 'neutral',
      evidence: [
        `可核验首触/炸板/回封 ${boardProcess.length}只`,
        `一字一致${oneWord.length}只；经历开板后回封${resealed.length}只`,
      ],
      boundary:
        '首触和炸板次数只能描述封板过程；缺少分钟成交量、均价和历史分位时，不能判断健康换手或爆量失控。',
      next: '如果爆量后价格稳住、低点抬高并重新封住，才确认筹码完成承接。',
    },
    {
      id: 'intraday',
      name: '分时主动性',
      question: '启动、扩散、兑现和二次承接是否真实？',
      conclusion: windowEvents.length
        ? `已识别${windowEvents.length}个真实短窗异动，完整传导链仍未确认`
        : relationEvidenceReady
          ? relationEventCount > 0
            ? `完整1分钟路径已校验，识别${relationEventCount}个启动、扩散、分歧或修复转折`
            : '完整1分钟路径与候选关系已校验，当日未识别到达阈值的传导事件'
          : minuteEvidenceReady
            ? '精确1分钟路径完整，但候选关系观察未覆盖，不判断带动与承接'
            : '缺少连续分钟传导证据，不能判断真实承接',
      state:
        windowEvents.length || relationEvidenceReady
          ? 'READY'
          : minuteEvidenceReady
            ? 'DEGRADED'
            : 'MISSING',
      judgment:
        windowEvents.length || relationEvidenceReady
          ? 'CONFIRMED'
          : minuteEvidenceReady
            ? 'OBSERVE'
            : 'UNCONFIRMED',
      tone: windowEvents.some((event) => event.direction === 'up')
        ? 'mixed'
        : 'neutral',
      evidence: windowEvents.length
        ? windowEvents
            .slice(0, 3)
            .map(
              (event) =>
                `${event.name}${event.direction === 'up' ? '启动' : '下杀'}，短窗${pct(event.displayChangePct ?? event.changePct)}`,
            )
        : relationEvidenceReady
          ? [
              `精确1分钟快照${intradayEvidence!.minuteSnapshots}个，分辨率${intradayEvidence!.resolution}`,
              `动态事件${relationEventCount}个；事件是阈值转折证据，不直接等同龙头带动`,
            ]
          : minuteEvidenceReady
            ? [
                `精确1分钟快照${intradayEvidence!.minuteSnapshots}个，价格路径READY`,
                `关系候选观察${intradayEvidence!.candidateWithObservations}/${intradayEvidence!.candidateRelationEligible ?? intradayEvidence!.candidateCount}；排除${intradayEvidence!.candidateExclusions?.length ?? 0}只不具备可比同行组`,
              ]
            : ['当前仅有日内快照，未形成可复核的连续分钟路径'],
      boundary:
        '短窗异动不等于龙头带动；没有先后顺序、助攻耗时和回踩后的再承接，就不生成盘面故事。',
      next: '如果核心先动、30分钟内助攻扩散、回踩缩量且再次承接，才确认点带面。',
    },
    {
      id: 'risk',
      name: '亏钱效应 / 风险',
      question: '哪里的负反馈正在扩散？',
      conclusion: relayLosers.length
        ? `亏钱效应集中在中高位掉队：${relayLosers
            .slice(0, 3)
            .map((row) => row.name)
            .join('、')}`
        : facts.limitDown > 0 || facts.failed > facts.limitUp * 0.5
          ? '失败侧压力存在，但未定位到完整中高位样本'
          : '暂未见中高位负反馈扩散，仍需监控失败侧',
      state:
        observed.poolsReady && cohort.ready && quoteReady
          ? 'READY'
          : 'DEGRADED',
      judgment:
        observed.poolsReady && cohort.ready && quoteReady
          ? 'CONFIRMED'
          : 'OBSERVE',
      tone:
        relayLosers.length >= 2 || facts.limitDown >= 5 ? 'negative' : 'mixed',
      evidence: [
        `炸板${facts.failed}只、跌停${facts.limitDown}只`,
        cohort.ready
          ? `昨日2板及以上掉队且收跌${relayLosers.length}/${cohort.consecutive.count}只`
          : '前一日中高位身份池不完整',
        topFalling
          ? `最强下杀方向：${topFalling.name}，${
              topFalling.drivers
                .slice(0, 3)
                .map((row) => row.name)
                .join('、') || '领跌股不可用'
            }`
          : '未检测到达到阈值的集中板块下杀',
      ],
      boundary:
        '极端负反馈优先于平均指标；单只跌停不等于退潮，必须观察是否向中位、高标和同题材扩散。',
      next: '如果中位大面、昨日强股核按钮和板块跌停同步增加，则确认亏钱效应扩散。',
    },
  ];

  const readyCount = modules.filter((item) => item.state === 'READY').length;
  const degradedCount = modules.filter(
    (item) => item.state === 'DEGRADED',
  ).length;
  const missingCount = modules.filter(
    (item) => item.state === 'MISSING',
  ).length;
  const strongestState: KnowledgeState = modules.every(
    (item) => item.state === 'READY',
  )
    ? 'READY'
    : modules.some((item) => item.state !== 'MISSING')
      ? 'DEGRADED'
      : 'MISSING';
  const headline = `${observed.indexMood} · ${observed.broad} · ${short.highBoard.label} · ${short.relay.label}`;
  const factChain = topRising
    ? `${topRising.name}进入资金视野 → ${flowAligned ? '价格与资金同向' : '资金同向尚未确认'} → ${relayWinners.length ? `${relayWinners.length}只连板完成传递` : '接力传递不足'} → ${relayLosers.length ? `${relayLosers.length}只中高位负反馈` : '失败侧暂未扩散'}`
    : `未见明确板块启动 → ${relayWinners.length ? `${relayWinners.length}只连板维持正反馈` : '接力正反馈不足'} → ${relayLosers.length ? `${relayLosers.length}只中高位负反馈` : '失败侧暂未扩散'}`;

  return {
    status: strongestState,
    date: facts.date,
    cutoff: facts.cutoff,
    headline,
    factChain,
    modules,
    readyCount,
    degradedCount,
    missingCount,
  };
}
