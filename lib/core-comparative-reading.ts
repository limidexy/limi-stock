import type { CoreCandidate, EvidenceState } from './market-reading';
import type { TapeSnapshot, TapeStock } from './tape-observation';

export type CoreReadingCase = {
  id: string;
  kind: 'TIER' | 'RESPONSE' | 'FAILURE';
  question: string;
  premise: string;
  codes: string[];
  verdict: 'SPLIT' | 'SUPPORTED' | 'PRESSURE_REMAINS' | 'PARTIAL' | 'OBSERVING';
  state: EvidenceState;
  reading: string;
  boundary: string;
  nextCheck: string;
};
export type CoreStockReading = {
  premise: string;
  action: string;
  reading: string;
  comparisonCodes: string[];
  boundary: string;
  nextCheck: string;
  expectationAvailable: false;
};
export type CoreComparativeReading = {
  state: EvidenceState;
  observedAt: string;
  scope: string;
  cases: CoreReadingCase[];
  stocks: Record<string, CoreStockReading>;
};

const pct = (n: number | null) =>
  n === null ? '报价缺失' : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
const names = (rows: TapeStock[]) => rows.map((r) => r.name).join('、');
const stable = (r: TapeStock) => r.support === 'STABLE_SEAL';
const repaired = (r: TapeStock) => r.support === 'RESEALED';
const pressured = (r: TapeStock) =>
  r.support === 'OPENED' ||
  r.support === 'WEAKENING' ||
  (r.changePct !== null && r.changePct < 0);
const clock = (s: string) =>
  s.includes('T') ? s.slice(11, 16) : s.slice(0, 5);
const family = (code: string) =>
  /^(300|301|688|689)/.test(code)
    ? '20cm'
    : /^(4|8|92)/.test(code)
      ? '北交所'
      : '主板';

function action(row: TapeStock): string {
  const sequence: Array<{ time: string; text: string }> = [];
  if (row.firstLimitTime)
    sequence.push({ time: row.firstLimitTime, text: '采样见涨停价' });
  if (row.openedAt)
    sequence.push({
      time: row.openedAt,
      text: row.openingGap ? '采样已离开涨停价（打开时点缺失）' : '打开涨停',
    });
  if (row.resealedAt)
    sequence.push({ time: row.resealedAt, text: '回到涨停价' });
  if (!sequence.length) {
    const rise = row.upEvents.at(-1),
      fall = row.downEvents.at(-1);
    if (rise)
      sequence.push({
        time: rise.at,
        text: `从${pct(rise.fromPct)}升至${pct(rise.toPct)}`,
      });
    if (fall)
      sequence.push({
        time: fall.at,
        text: `从${pct(fall.fromPct)}回落至${pct(fall.toPct)}`,
      });
  }
  return `${row.name}${
    sequence.length
      ? sequence
          .sort((a, b) => a.time.localeCompare(b.time))
          .map((e) => `${e.time}${e.text}`)
          .join('，')
      : '可见窗口未见明确封板或快速转折'
  }；${row.lastTime}为${pct(row.changePct)}。`;
}

/** Read a question across stocks, not a winner from isolated attributes.
 * Input is the engine's date/cutoff/availability-gated tape only. Historical
 * standards supply the METHOD, never names, grades, roles or runtime facts.
 * These are scoped market observations, not trade cards or causal estimates.
 */
export function buildCoreComparativeReading(args: {
  candidates: CoreCandidate[];
  tape: TapeSnapshot | null;
  observedAt: string;
  previousDate: string | null;
}): CoreComparativeReading {
  const { candidates, tape, observedAt, previousDate } = args;
  const cutoff = clock(observedAt);
  const pathRows = tape?.rows ?? [];
  const paths = new Map(pathRows.map((r) => [r.code, r]));
  const fresh = (r: TapeStock) =>
    r.lastTime === cutoff &&
    r.quoteTime !== null &&
    clock(r.quoteTime) === cutoff &&
    r.changePct !== null &&
    (r.latestWindowComplete || r.fullSession);
  const current = pathRows.filter(fresh);
  const currentByCode = new Map(current.map((r) => [r.code, r]));
  const cases: CoreReadingCase[] = [];

  // Same tier is a competition/pressure comparison, NOT a common theme.
  // Include failed peers from the tape, not just current seals/candidate cards.
  const tiers = new Map<string, TapeStock[]>();
  for (const row of pathRows) {
    if (row.previousHeight < 2) continue;
    const key = `${family(row.code)}·昨${row.previousHeight}板`;
    const group = tiers.get(key) ?? [];
    group.push(row);
    tiers.set(key, group);
  }
  for (const [key, all] of [...tiers].sort(
    (a, b) =>
      b[1][0].previousHeight - a[1][0].previousHeight ||
      a[0].localeCompare(b[0]),
  )) {
    if (all.length < 2) continue;
    const visible = all.filter(fresh);
    if (visible.length < 2) continue;
    const strong = visible.filter(stable),
      repair = visible.filter(repaired),
      weak = visible.filter(pressured);
    const classified = new Set(
      [...strong, ...repair, ...weak].map((r) => r.code),
    );
    const other = visible.filter((r) => !classified.has(r.code));
    const unresolvedSeal = other.filter((r) => r.limitState === 'LIMIT_UP');
    const unsealed = other.filter((r) => r.limitState !== 'LIMIT_UP');
    const pressureSide = [...weak, ...unsealed];
    const split = Boolean(
      (strong.length || repair.length) && pressureSide.length,
    );
    const lines = [
      strong.length ? `${names(strong)}在可见分钟维持涨停价` : '',
      repair.length
        ? repair.map((r) => `${r.name}${r.resealedAt}回到涨停价`).join('、')
        : '',
      weak.length
        ? `另一侧${weak.map((r) => `${r.name}${r.support === 'OPENED' ? `${r.openedAt}${r.openingGap ? '采样已离开涨停价' : '打开后'}` : ''}${pct(r.changePct)}`).join('、')}`
        : '',
      other.length
        ? `${other.map((r) => `${r.name}${pct(r.changePct)}，${r.limitState === 'LIMIT_UP' ? '当前处于涨停价，但回封过程不完整' : '尚未处于涨停价'}`).join('、')}`
        : '',
    ].filter(Boolean);
    const conclusion = split
      ? '本组出现承接分层：强端或回封存在，但没有修复所有同身位。'
      : unresolvedSeal.length
        ? pressureSide.length
          ? '部分股票当前已在涨停价，其他仍未封住；封板者的过程未知，不能确认它们如何修复。'
          : '当前价格共同处于涨停价，但部分承接过程未知；缺证据不等于未修复，也不据此确认健康承接。'
        : repair.length && strong.length
          ? '当前都处于涨停价，但一直稳定与分歧后回封承担的验证任务不同。'
          : strong.length + repair.length === visible.length
            ? '已覆盖的同身位暂时都守住涨停价；还不能据此推成其他层级也健康。'
            : '本组未形成一致承接，继续看压力是否收窄。';
    cases.push({
      id: `tier:${key}`,
      kind: 'TIER',
      codes: all.map((r) => r.code),
      question: `${key}：是共同加强，还是只有部分承接？`,
      premise: `以${previousDate ?? '前一交易日'}的同身位作比较；当前可比较${visible.length}/${all.length}只，范围限本次分钟样本。`,
      verdict: split
        ? 'SPLIT'
        : unresolvedSeal.length
          ? 'PARTIAL'
          : strong.length + repair.length === visible.length
            ? 'SUPPORTED'
            : 'OBSERVING',
      state:
        visible.length === all.length && !unresolvedSeal.length
          ? 'READY'
          : 'DEGRADED',
      reading: lines.join('；') + '。' + conclusion,
      boundary:
        '同身位不等于同一题材；比较的是承接差异，不据此认定谁带动谁，也不把封住直接等同于更好的交易。',
      nextCheck: pressureSide.length
        ? `接下来先看${names(pressureSide)}能否止跌或重新封住，再看${names([...strong, ...repair]) || '本组强端'}是否保持；弱侧继续恶化则不确认本组修复。`
        : unresolvedSeal.length
          ? `补核${names(unresolvedSeal)}缺失时段的原始分钟，并观察后续是否维持涨停价；不要求已经处于涨停价的股票再次“修复”。`
          : `继续观察${names(visible)}首次出现分歧后谁仍有承接；目前的共同封住不能代替分歧检验。`,
    });
  }

  // Previously strong -> now failed is a distinct observation, not simply
  // yesterday's red stocks versus today's green stocks.
  const failedStrong = current.filter(
    (r) => r.firstLimitTime && r.limitState !== 'LIMIT_UP' && r.openedAt,
  );
  if (failedStrong.length) {
    cases.push({
      id: 'failed-strong',
      kind: 'FAILURE',
      question: '曾经封板的强侧，分歧解决了吗？',
      premise:
        '保留本窗口曾到涨停价、之后打开且当前仍未回封的股票，不从最终封板名单反推强弱。',
      codes: failedStrong.map((r) => r.code),
      verdict: 'PRESSURE_REMAINS',
      state: 'READY',
      reading:
        failedStrong.map(action).join('') +
        '这些对象的压力仍在；其他个股封住，不能抹去它们已发生的失败。',
      boundary:
        '这是已覆盖范围的失败强侧，不是全市场炸板总数；不凭个股打开推断资金被另一个板块抽走。',
      nextCheck: `若${names(failedStrong)}重新回到涨停价并维持，才增加修复证据；若继续下沉，保留失败而不是只展示幸存强股。`,
    });
  }

  // Only the engine's individually verified concept/time pairs may support a
  // direction reading. Same-industry tape co-movement never grants this edge.
  for (const candidate of candidates) {
    if (!tape || candidate.dimensions.leadership.state !== 'READY') continue;
    for (const group of candidate.interpretation.influence.groups) {
      const own = currentByCode.get(candidate.code);
      const members = group.members.filter(
        (m) => m.time <= cutoff && m.lag > 0,
      );
      if (!members.length || !own) continue;
      const membersNow = members.flatMap((m) =>
        currentByCode.has(m.code) ? [currentByCode.get(m.code)!] : [],
      );
      const losses = membersNow.filter(pressured);
      const missing = members.filter((m) => !currentByCode.has(m.code));
      const lossCodes = new Set(losses.map((r) => r.code));
      const original = members
        .map(
          (m) =>
            `${m.name}${m.time}随后${group.direction === 'down' ? '下行' : '上行'}（相隔${m.lag}分钟）`,
        )
        .join('、');
      const status =
        group.direction === 'down'
          ? '已见局部负向先后，不把它写成核心影响消失。'
          : losses.length
            ? '出现过响应，但部分成员已回落；启动时的扩散不能当成当前持续加强。'
            : missing.length
              ? '响应先后已见，但后续状态覆盖不全，持续性还不能判断。'
              : '已见局部响应，当前未见这些成员处于上述受压状态；尚不能确认整条方向持续加强。';
      cases.push({
        id: `response:${candidate.code}:${group.concept}:${group.direction}`,
        kind: 'RESPONSE',
        question: `${group.concept}：${candidate.name}出现动作后，响应延续了吗？`,
        premise:
          '共同概念只提供关联范围；用具体先后与随后受压情况，分别检验启动和延续。',
        codes: [candidate.code, ...members.map((m) => m.code)],
        verdict: losses.length
          ? 'PRESSURE_REMAINS'
          : missing.length
            ? 'PARTIAL'
            : 'OBSERVING',
        state: missing.length ? 'DEGRADED' : 'READY',
        reading:
          action(own) +
          original +
          '。' +
          membersNow
            .map(
              (r) =>
                `${r.name}当前${pct(r.changePct)}${lossCodes.has(r.code) ? '，响应后仍有压力' : ''}`,
            )
            .join('；') +
          '。' +
          status,
        boundary: `仅覆盖列出的${members.length}个关联成员${missing.length ? `，其中${missing.length}个缺少同截止点状态` : ''}；先后不单独证明因果，不能把此前已强的股票算作新助攻。`,
        nextCheck: `继续看${names(losses.length ? losses : membersNow) || members.map((m) => m.name).join('、')}在下一次回落后的表现，并检查${candidate.name}是否再次主动；没有共同恢复，就只保留局部响应。`,
      });
    }
  }

  const stocks: Record<string, CoreStockReading> = {};
  for (const candidate of candidates) {
    const row = currentByCode.get(candidate.code);
    const prior = paths.get(candidate.code)?.previousHeight;
    const premise =
      prior && prior >= 2
        ? `${candidate.name}前一交易日处于${prior}板；今天要检验它与同身位的承接是否分离，而不是只看还能否多一板。`
        : candidate.interpretation.identity.basis;
    const comparisons =
      row?.peerRelations.filter(
        (p) =>
          currentByCode.has(p.code) &&
          currentByCode.get(p.code)!.previousHeight === row.previousHeight &&
          family(p.code) === family(row.code),
      ) ?? [];
    const competition = comparisons
      .map((p) => `${p.name}${currentByCode.get(p.code)!.supportLabel}`)
      .join('；');
    const followingEarlier =
      row?.observedRelations.earlierCodes.flatMap((c) =>
        currentByCode.has(c) ? [currentByCode.get(c)!] : [],
      ) ?? [];
    const alreadyStrong =
      row?.observedRelations.preexistingStrongCodes.flatMap((c) =>
        currentByCode.has(c) ? [currentByCode.get(c)!] : [],
      ) ?? [];
    const directionCases = cases.filter(
      (c) => c.kind === 'RESPONSE' && c.codes[0] === candidate.code,
    );
    const observedAction = row
      ? action(row)
      : `${candidate.name}${candidate.quoteState === 'READY' ? `截至${candidate.quoteTime}为${pct(candidate.changePct)}` : '当前报价未完整核验'}；缺少同截止点分钟过程，不能还原启动与承接先后。`;
    const implication = !row
      ? '目前只能说明已知身份和报价结果。'
      : comparisons.some((p) => p.relation === 'WEAKER_SUPPORT')
        ? '在这个比较窗口，它没有承担最稳定的承接；原来的空间或历史地位不抹掉，但强度判断要服从当下分歧。'
        : comparisons.some((p) => p.relation === 'REPAIR_SEPARATION')
          ? '它通过回封与仍弱的同身位形成分离；这确认的是本股修复，群体能否修复仍要看弱侧。'
          : comparisons.some((p) => p.relation === 'MORE_STABLE')
            ? '它在同身位分歧中提供稳定参照；稳定封住与主动发动方向是两个不同判断。'
            : '单股路径已见，但尚未得到足以分出承接优势的对照。';
    const sequenceBoundary =
      followingEarlier.length || alreadyStrong.length
        ? `${followingEarlier.length ? `${names(followingEarlier)}先动` : ''}${followingEarlier.length && alreadyStrong.length ? '；' : ''}${alreadyStrong.length ? `${names(alreadyStrong)}此前已经处于强侧` : ''}，不能倒写成被它带动。`
        : '未排除共同环境或其他先动者，时间先后不直接证明带动因果。';
    stocks[candidate.code] = {
      premise,
      action: observedAction,
      reading:
        observedAction +
        (competition ? `同一时点对照：${competition}。` : '') +
        implication +
        (directionCases.length
          ? directionCases.map((c) => c.reading).join('')
          : '题材响应未形成可用证据，方向确认与容量职责暂不授予。'),
      comparisonCodes: [...new Set(comparisons.map((p) => p.code))],
      boundary:
        sequenceBoundary +
        '盘前预期基线不足，仅描述相对表现；盘面地位与可交易性分开，当前不提供交易评级。',
      nextCheck: comparisons.length
        ? comparisons.some((p) => p.relation === 'WEAKER_SUPPORT')
          ? `先看${candidate.name}能否止跌或回到涨停价，同时对照${comparisons
              .filter((p) => p.relation === 'WEAKER_SUPPORT')
              .map((p) => p.name)
              .join(
                '、',
              )}是否仍守住强势；未恢复前，不能因它比更弱者抗跌就认定领先。`
          : `下一步对照${comparisons
              .map((p) => p.name)
              .filter((v, i, a) => a.indexOf(v) === i)
              .join(
                '、',
              )}：本股与弱侧一起改善才增加群体修复证据；若只有本股维持，则仍是局部分离。`
        : candidate.interpretation.nextCheck,
      expectationAvailable: false,
    };
  }
  return {
    state: !current.length
      ? 'MISSING'
      : current.length === pathRows.length
        ? 'READY'
        : 'DEGRADED',
    observedAt,
    scope: tape
      ? `${tape.scope}；同截止点可比较${current.length}/${pathRows.length}只，判断不外推到未覆盖股票。`
      : '缺少同截止点分钟证据，暂不生成群体过程结论。',
    cases,
    stocks,
  };
}
