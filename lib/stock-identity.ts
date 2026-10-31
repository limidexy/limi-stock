/**
 * 从「情绪跟踪」归档里取出单只股票在某个交易日的身份证据。
 *
 * 这里只做读取与归并：不新增判定、不推断因果、不因为某股涨幅大就授予龙头身份。
 * 项目自带的识别产出（断板老高标 / 当日核心 / 昨日炸板 / 盘中反核 / 同组跟随）
 * 原样透出，并保留其自身的边界说明。
 */

export type IdentityFact = { label: string; value: string };

export type StockIdentityView = {
  status: 'READY' | 'DEGRADED' | 'MISSING';
  /** 归档里该股出现的角色，可能为空。 */
  roles: string[];
  facts: IdentityFact[];
  /** 辨识度（空间记忆）依据；没有证据时为 null，不猜。 */
  recognition: string | null;
  notes: string[];
  reasons: string[];
  source: string;
  date: string | null;
};

const EMPTY: StockIdentityView = {
  status: 'MISSING',
  roles: [],
  facts: [],
  recognition: null,
  notes: [],
  reasons: [],
  source: 'EMOTION_TRACKING_ARCHIVE',
  date: null,
};

type Row = Record<string, unknown>;

const asRows = (value: unknown): Row[] => {
  if (!value || typeof value !== 'object') return [];
  const rows = (value as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as Row[]) : [];
};

const text = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const num = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const pct = (value: unknown) => {
  const n = num(value);
  if (n == null) return null;
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
};

/**
 * 断板之后归档里还跟了几天。只用归档自带的逐日路径计数，不跨缺口推断交易日。
 */
function sessionsAfterBreak(path: unknown, brokenDate: string | null) {
  if (!brokenDate || !Array.isArray(path)) return null;
  const dates = path
    .map((item) => (item && typeof item === 'object' ? text((item as Row).date) : null))
    .filter((date): date is string => Boolean(date));
  return dates.filter((date) => date > brokenDate).length;
}

export function resolveStockIdentity(
  payload: unknown,
  code: string,
): StockIdentityView {
  if (!payload || typeof payload !== 'object') {
    return { ...EMPTY, reasons: ['情绪跟踪归档不可用。'] };
  }
  const root = payload as Row;
  const state = text(root.status);
  const date = text(root.date);
  if (state === 'MISSING') {
    return {
      ...EMPTY,
      date,
      reasons: [text(root.reason) ?? '该交易日没有情绪跟踪归档。'],
    };
  }
  if (!date) {
    return { ...EMPTY, reasons: ['归档未返回可解析的交易日。'] };
  }

  const roles: string[] = [];
  const facts: IdentityFact[] = [];
  const notes: string[] = [];
  let recognition: string | null = null;
  /** 该股是否在任一跟踪名单里出现过（出现但无角色，和完全没出现是两件事）。 */
  let seen = false;

  // 一、断板老高标：项目自带的空间记忆跟踪。
  const oldLeader = asRows(root.oldLeaders).find((row) => row.code === code);
  if (oldLeader) {
    seen = true;
    roles.push('断板老高标');
    const peakHeight = num(oldLeader.peakHeight);
    const peakDate = text(oldLeader.peakDate);
    const brokenDate = text(oldLeader.brokenDate);
    if (peakHeight != null) {
      facts.push({
        label: '历史空间记忆',
        value: `${peakHeight} 板${peakDate ? `（${peakDate}）` : ''}`,
      });
      if (peakHeight >= 2) recognition = `历史空间记忆 ${peakHeight} 板`;
    }
    if (brokenDate) facts.push({ label: '断板日', value: brokenDate });
    const after = sessionsAfterBreak(oldLeader.path, brokenDate);
    if (after != null) {
      facts.push({ label: '断板后跟踪', value: `${after} 个归档交易日` });
    }
    const height = num(oldLeader.height);
    // 老高标行的 height 是断板时的板高，不是当日板高；与峰值相同时不重复展示。
    if (height != null && height > 0 && height !== peakHeight) {
      facts.push({ label: '断板时板高', value: `${height} 板` });
    }
    const industry = text(oldLeader.industry);
    if (industry) facts.push({ label: '行业', value: industry });
    notes.push('断板老高标是空间记忆跟踪，不是龙头认证。');
  }

  // 二、当日核心与同组响应。
  const leadLag = asRows(root.leadLag);
  const lead = leadLag.find((item) => {
    const core = item.core;
    return core && typeof core === 'object' && (core as Row).code === code;
  });
  if (lead) {
    seen = true;
    roles.push('当日核心');
    const industry = text(lead.industry);
    if (industry) facts.push({ label: '同组板块', value: industry });
    const followers = Array.isArray(lead.rows) ? lead.rows.length : 0;
    facts.push({ label: '同组响应', value: `${followers} 只` });
    notes.push(
      '核心与同组响应只说明先后顺序，不等于带动全市场；跟踪归档的板位是跟踪起点，当日是否封住以收盘归档为准。',
    );
  } else {
    // 作为同组跟随者出现。
    const follower = leadLag.find(
      (item) =>
        Array.isArray(item.rows) &&
        (item.rows as Row[]).some((row) => row.code === code),
    );
    if (follower) {
      seen = true;
      const row = (follower.rows as Row[]).find((item) => item.code === code);
      roles.push('同组跟随');
      if (row) {
        const time = text(row.time);
        const role = text(row.role);
        facts.push({
          label: '跟随时点',
          value: [time, role].filter(Boolean).join(' · ') || '归档未给出时点',
        });
      }
    }
  }

  // 三、昨日炸板后的当日表现。
  const failed = asRows(root.failedRepair).find((row) => row.code === code);
  if (failed) {
    seen = true;
    roles.push('昨日炸板');
    const yesterday = pct(failed.yesterdayChangePct);
    if (yesterday) facts.push({ label: '昨日涨幅', value: yesterday });
    const label = text(failed.label);
    if (label) facts.push({ label: '当日状态', value: label });
  }

  // 四、盘中反核（深跌拉回）的分钟过程。归档对每只跟踪股都有一行，
  // 但只有真的出现拉回事件才算反核，否则只作说明，不给角色。
  const rebound = asRows(root.rebounds).find((row) => row.code === code);
  if (rebound) {
    seen = true;
    const label = text(rebound.label) ?? '';
    const hasEvent =
      Boolean(rebound.event) || (label.length > 0 && label !== '未见深跌拉回');
    if (hasEvent) {
      roles.push('盘中反核');
      const low = pct(rebound.lowPct);
      const last = pct(rebound.lastPct);
      const points = num(rebound.points);
      if (low) facts.push({ label: '盘中最低', value: low });
      if (last) facts.push({ label: '收盘', value: last });
      if (points != null) facts.push({ label: '分钟点数', value: `${points} 个` });
      if (label) facts.push({ label: '过程', value: label });
      const reason = text(rebound.reason);
      if (reason) notes.push(reason);
    } else {
      notes.push('当日分钟路径未见深跌拉回，不计作反核。');
    }
  }

  const base = { ...EMPTY, status: 'READY' as const, date, roles, facts, recognition, notes };
  if (!roles.length) {
    if (seen) return { ...base, notes };
    return {
      ...base,
      notes: [
        '该交易日归档名单中没有该股：可能当日未涨停、未断板，或不在跟踪范围。不作身份推断。',
      ],
    };
  }
  return base;
}
