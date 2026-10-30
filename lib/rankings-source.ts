/**
 * 多窗口涨幅排行的数据源解析。
 *
 * 两条路径：
 *   1. 本地快照 public/rankings/YYYYMMDD.json（有历史、可复核、由 scripts/build-multi-window-rankings.mjs 生成）
 *   2. 外部接口（无历史能力，仅在本地快照缺失时兜底）
 *
 * 纯函数、无 React 依赖，便于单元测试。
 */

import type { RankingPayload, WindowKey } from './ranking-verification';

export const SNAPSHOT_INDEX_URL = '/rankings/index.json';
export const REMOTE_URL = 'https://bloomideas.xyz/api/research/multi-window-rankings';

const WINDOW_KEYS_CHECK: WindowKey[] = ['5', '10', '20', '30'];

export type SnapshotIndex = {
  version: number;
  generatedAt: string | null;
  source: string | null;
  latest: string | null;
  /** 已生成的交易日，倒序（最新在前）。 */
  dates: string[];
};

export type SourceKind = 'snapshot' | 'remote';

export function snapshotUrl(compactDate: string) {
  return `/rankings/${compactDate}.json`;
}

/** 只接受 8 位交易日，避免把任意路径拼进 URL。 */
export function isCompactDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{8}$/.test(value);
}

/**
 * 解析快照索引。索引缺失、为空或格式不对时返回 null，由调用方退回外部接口。
 * 不猜测日期：只接受 YYYYMMDD。
 */
export function parseSnapshotIndex(raw: unknown): SnapshotIndex | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const dates = Array.isArray(record.dates)
    ? record.dates.filter(isCompactDate)
    : [];
  if (!dates.length) return null;
  const unique = [...new Set(dates)].sort().reverse();
  return {
    version: typeof record.version === 'number' ? record.version : 1,
    generatedAt:
      typeof record.generatedAt === 'string' ? record.generatedAt : null,
    source: typeof record.source === 'string' ? record.source : null,
    latest: unique[0],
    dates: unique,
  };
}

/**
 * 校验载荷结构是否可用。缺目标日、缺覆盖统计或缺任一窗口即视为不可用，
 * 不尝试用默认值补齐——缺字段就是缺字段。
 */
export function assertPayload(raw: unknown): RankingPayload {
  if (!raw || typeof raw !== 'object') throw new Error('返回不是对象');
  const payload = raw as RankingPayload;
  if (!payload.tradeDate) throw new Error('返回缺少目标交易日');
  if (!payload.coverage || typeof payload.coverage !== 'object') {
    throw new Error('返回缺少覆盖统计');
  }
  for (const key of WINDOW_KEYS_CHECK) {
    if (!payload.windows?.[key]) throw new Error(`返回缺少 ${key} 日窗口`);
  }
  return payload;
}
