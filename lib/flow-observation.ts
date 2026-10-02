import type { FlowSnapshot, SectorFlowSeries } from './market';

export type FundFlowPoint = { time: string; mainNetInflow: number };
export type FundFlowObservation = {
  state:
    | 'INSUFFICIENT'
    | 'QUIET'
    | 'SINGLE_JUMP'
    | 'MIXED'
    | 'WINDOW_ALIGNED'
    | 'PERSISTENT_INFLOW'
    | 'PERSISTENT_OUTFLOW'
    | 'TURN_ATTEMPT'
    | 'TURN_CONTINUED';
  label: string;
  basis: string;
  delta5m: number | null;
  delta15m: number | null;
  delta30m: number | null;
};

function tradingMinute(time: string): number | null {
  if (!/^\d{2}:\d{2}$/.test(time)) return null;
  const [h, m] = time.split(':').map(Number);
  if (m > 59) return null;
  const value = h * 60 + m;
  if (value >= 570 && value <= 690) return value - 570;
  if (value >= 780 && value <= 900) return value - 660;
  return null;
}

// Describe the available path, not a calibrated signal or market reversal.
// Non-overlapping five-minute segments prevent nested 5/15/30 windows from
// counting the same terminal print as three independent confirmations.
export function observeFundFlow(points: FundFlowPoint[]): FundFlowObservation {
  const tail = (minutes: number) => {
    if (points.length <= minutes) return null;
    const sample = points.slice(-(minutes + 1));
    const slots = sample.map((p) => tradingMinute(p.time));
    if (
      sample.some(
        (p, i) =>
          !Number.isFinite(p.mainNetInflow) ||
          slots[i] === null ||
          (i > 0 && slots[i]! - slots[i - 1]! !== 1),
      )
    )
      return null;
    return sample;
  };
  const delta = (minutes: number) => {
    const sample = tail(minutes);
    return sample
      ? sample.at(-1)!.mainNetInflow - sample[0].mainNetInflow
      : null;
  };
  const changes = {
    delta5m: delta(5),
    delta15m: delta(15),
    delta30m: delta(30),
  };
  const result = (
    state: FundFlowObservation['state'],
    label: string,
    basis: string,
  ): FundFlowObservation => ({ state, label, basis, ...changes });
  const sample = tail(30);
  if (!sample)
    return result(
      'INSUFFICIENT',
      '连续分钟不足',
      '保留可核验窗口的净变化；缺分钟、重复或乱序时不按行数冒充连续时间。',
    );
  const increments = sample
    .slice(1)
    .map((p, i) => p.mainNetInflow - sample[i].mainNetInflow);
  if (increments.every((n) => n === 0))
    return result(
      'QUIET',
      '窗口内无资金变化',
      '最近30个交易分钟累计值不变，不标成资金拐点，也不据此判断市场没有交易。',
    );
  if (increments.filter((n) => n !== 0).length <= 2)
    return result(
      'SINGLE_JUMP',
      '少数分钟跳变·延续未确认',
      '变化集中在一两个采样点，先观察随后是否延续；不能区分真实集中成交与供应商补记。',
    );
  const segments = Array.from({ length: 6 }, (_, index) => {
    const values = increments.slice(index * 5, index * 5 + 5);
    const net = values.reduce((a, b) => a + b, 0);
    const direction = Math.sign(net);
    // Three is a descriptive majority of five observations, not a fitted
    // alpha threshold. Amount significance must not be inferred from it.
    const consistent =
      direction !== 0 &&
      values.filter((v) => Math.sign(v) === direction).length >= 3;
    return { direction, consistent };
  });
  const agree = (a: number, b: number) =>
    segments[a].consistent &&
    segments[b].consistent &&
    segments[a].direction === segments[b].direction;
  const direction = (n: number) => (n > 0 ? '流入' : '流出');
  if (
    agree(2, 3) &&
    agree(4, 5) &&
    segments[3].direction !== segments[4].direction
  ) {
    return result(
      'TURN_CONTINUED',
      `${direction(segments[3].direction)}转${direction(segments[5].direction)}·已延续10分钟`,
      `此前两段与随后两段5分钟方向相反，随后每段至少3个分钟同向。仅确认截至${sample.at(-1)!.time}的资金统计延续，不代表价格、主线或情绪反转。`,
    );
  }
  if (
    agree(3, 4) &&
    segments[5].consistent &&
    segments[4].direction !== segments[5].direction
  ) {
    return result(
      'TURN_ATTEMPT',
      `${direction(segments[4].direction)}转${direction(segments[5].direction)}迹象`,
      '此前10分钟方向一致，最近5分钟首次反向；尚无第二段延续，需再看价格、助攻与回落后的表现。',
    );
  }
  if (
    segments.every((s) => s.consistent && s.direction === segments[0].direction)
  ) {
    return result(
      segments[0].direction > 0 ? 'PERSISTENT_INFLOW' : 'PERSISTENT_OUTFLOW',
      `30分钟各段均净${direction(segments[0].direction)}`,
      '六段不重叠5分钟均同向，每段至少3个分钟同向；只描述方向持续性，不代表金额显著、健康承接或未来继续。',
    );
  }
  if (
    [changes.delta5m, changes.delta15m, changes.delta30m].every(
      (v) => v !== 0 && Math.sign(v!) === Math.sign(changes.delta5m!),
    )
  ) {
    return result(
      'WINDOW_ALIGNED',
      `窗口净${direction(changes.delta5m!)}·途中有反复`,
      '5/15/30分钟净额同向，但逐段过程不一致；不能把嵌套窗口当作多次独立确认。',
    );
  }
  return result(
    'MIXED',
    '短长周期分化',
    '短长窗口或相邻段方向不同，尚未形成有前后过程支持的转向；不统一称为资金拐点。',
  );
}

// Persisted snapshots contain facts plus old wording. Recompute descriptions
// from their own retained path; never update their date or freshness status.
export function refreshFlowObservations<
  T extends FlowSnapshot & { allRows?: SectorFlowSeries[] },
>(snapshot: T): T {
  const retained = snapshot.allRows ?? [
    ...snapshot.series,
    ...snapshot.split.inflow,
    ...snapshot.split.outflow,
    ...snapshot.split.cumulativeInflow,
    ...snapshot.split.cumulativeOutflow,
    ...snapshot.split.persistentStrong,
    ...snapshot.split.persistentWeak,
  ];
  const byCode = new Map<string, SectorFlowSeries>();
  for (const item of retained) {
    if (!byCode.has(item.code)) {
      const observation = observeFundFlow(item.points);
      byCode.set(item.code, {
        ...item,
        delta5m: observation.delta5m,
        delta15m: observation.delta15m,
        delta30m: observation.delta30m,
        persistenceLabel: observation.label,
        flowObservation: observation,
      });
    }
  }
  const rows = [...byCode.values()];
  const select = (items: SectorFlowSeries[]) =>
    items.map((item) => byCode.get(item.code) ?? item);
  const inflow = rows.filter((r) => r.delta5m !== null && r.delta5m > 0);
  const outflow = rows.filter((r) => r.delta5m !== null && r.delta5m < 0);
  const persistent = (direction: 1 | -1) =>
    rows
      .filter(
        (r) =>
          r.latestMainNetInflow * direction > 0 &&
          r.changePct !== null &&
          r.changePct * direction > 0,
      )
      .sort((a, b) => {
        const rank = (r: SectorFlowSeries) =>
          r.delta30m === null ? 1 : r.delta30m * direction > 0 ? 0 : 2;
        return (
          rank(a) - rank(b) ||
          (b.latestMainNetInflow - a.latestMainNetInflow) * direction
        );
      })
      .slice(0, 6);
  return {
    ...snapshot,
    series: select(snapshot.series),
    ...(snapshot.allRows ? { allRows: select(snapshot.allRows) } : {}),
    split: {
      ...snapshot.split,
      inflow: inflow.sort((a, b) => b.delta5m! - a.delta5m!).slice(0, 6),
      outflow: outflow.sort((a, b) => a.delta5m! - b.delta5m!).slice(0, 6),
      cumulativeInflow: rows
        .filter((r) => r.latestMainNetInflow > 0)
        .sort((a, b) => b.latestMainNetInflow - a.latestMainNetInflow)
        .slice(0, 6),
      cumulativeOutflow: rows
        .filter((r) => r.latestMainNetInflow < 0)
        .sort((a, b) => a.latestMainNetInflow - b.latestMainNetInflow)
        .slice(0, 6),
      persistentStrong: persistent(1),
      persistentWeak: persistent(-1),
      positiveCount: inflow.length,
      negativeCount: outflow.length,
    },
  };
}
