/**
 * 板块异动：读取新浪财经的板块收盘快照（行业 + 概念），按当日涨跌幅排序。
 *
 * 上游只提供板块层面的收盘快照，既没有主力资金流，也没有成分股明细。
 * 这里只做解析、字段校验和排序：涨跌幅就是涨跌幅，不写成资金流；
 * 缺的字段留 null，不拿别的口径补。
 *
 * 板块快照本身不带时间戳，因此另用「板块领涨股的个股快照」反查日期：
 * 领涨股日期与目标交易日一致、且收盘价与板块给出的领涨价一致，才认这份快照属于该日。
 */

export type SectorKind = 'industry' | 'concept';

export type SectorLead = {
  /** 带市场前缀，例如 sz301520。 */
  code: string;
  name: string;
  changePct: number | null;
  price: number | null;
};

export type SectorRow = {
  code: string;
  name: string;
  kind: SectorKind;
  /** 板块成分家数。 */
  count: number | null;
  changePct: number | null;
  /** 板块当日成交额，单位元。 */
  amount: number | null;
  lead: SectorLead | null;
};

export type SectorSnapshotCheck = {
  status: 'READY' | 'DEGRADED';
  /** 校验用的领涨股，null 表示没有可校验的样本。 */
  code: string | null;
  name: string | null;
  quoteDate: string | null;
  close: number | null;
  sectorPrice: number | null;
  reasons: string[];
};

export type SectorBoard = {
  status: 'READY' | 'DEGRADED' | 'MISSING';
  tradeDate: string | null;
  requestedDate: string;
  retrievedAt: string;
  source: string;
  reasons: string[];
  coverage: {
    industries: number;
    concepts: number;
    usable: number;
    rejected: number;
  };
  check: SectorSnapshotCheck | null;
  /** 全部板块，已按当日涨跌幅降序。行业与概念分别由 kind 区分。 */
  rows: SectorRow[];
};

const FIELD_COUNT = 13;

const num = (value: string | undefined) => {
  const parsed = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(parsed)
    ? parsed
    : null;
};

export function parseSinaSectorPayload(
  raw: string,
  kind: SectorKind,
): { rows: SectorRow[]; rejected: number } {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return { rows: [], rejected: 0 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return { rows: [], rejected: 0 };
  }
  if (!parsed || typeof parsed !== 'object') return { rows: [], rejected: 0 };

  const rows: SectorRow[] = [];
  let rejected = 0;
  for (const value of Object.values(parsed as Record<string, unknown>)) {
    const fields = typeof value === 'string' ? value.split(',') : [];
    if (fields.length < FIELD_COUNT) {
      rejected += 1;
      continue;
    }
    const code = fields[0].trim();
    const name = fields[1].trim();
    const changePct = num(fields[5]);
    if (!code || !name || changePct === null) {
      rejected += 1;
      continue;
    }
    const leadCode = fields[8].trim();
    const leadName = fields[12].trim();
    rows.push({
      code,
      name,
      kind,
      count: num(fields[2]),
      changePct,
      amount: num(fields[7]),
      lead:
        leadCode && leadName
          ? {
              code: leadCode,
              name: leadName,
              changePct: num(fields[9]),
              price: num(fields[10]),
            }
          : null,
    });
  }
  return { rows, rejected };
}

/** 按涨跌幅排序：涨幅榜取前列，跌幅榜取末列，两端都不含无涨跌幅的板块。 */
export function rankSectorRows(rows: SectorRow[], limit: number) {
  const sorted = [...rows].sort(
    (a, b) => (b.changePct ?? 0) - (a.changePct ?? 0),
  );
  return {
    up: sorted.slice(0, limit),
    down: sorted.slice(-limit).reverse(),
  };
}

/**
 * 解析新浪个股快照，取名称、收盘价与报价日期。
 * 字段位置：0 名称、3 现价/收盘、30 日期、31 时间。
 */
export function parseSinaLeadQuote(raw: string) {
  const match = raw.match(/hq_str_(\w+)="([^"]*)"/);
  if (!match) return null;
  const fields = match[2].split(',');
  if (fields.length < 32) return null;
  return {
    code: match[1],
    name: fields[0].trim(),
    close: num(fields[3]),
    quoteDate: fields[30].trim(),
  };
}

export function checkSectorSnapshot(
  sector: SectorRow | null,
  quote: ReturnType<typeof parseSinaLeadQuote>,
  tradeDate: string,
): SectorSnapshotCheck {
  const expected = `${tradeDate.slice(0, 4)}-${tradeDate.slice(4, 6)}-${tradeDate.slice(6)}`;
  const base: SectorSnapshotCheck = {
    status: 'DEGRADED',
    code: sector?.lead?.code ?? null,
    name: sector?.lead?.name ?? null,
    quoteDate: quote?.quoteDate ?? null,
    close: quote?.close ?? null,
    sectorPrice: sector?.lead?.price ?? null,
    reasons: [],
  };
  if (!sector?.lead) {
    return { ...base, reasons: ['没有可用于校验的领涨股。'] };
  }
  if (!quote) {
    return { ...base, reasons: ['领涨股快照不可用，未能校验板块快照的日期。'] };
  }
  const reasons: string[] = [];
  if (quote.quoteDate !== expected) {
    reasons.push(
      `领涨股报价日期为 ${quote.quoteDate || '未知'}，与目标交易日 ${expected} 不一致。`,
    );
  }
  const priceGap =
    quote.close !== null && sector.lead.price !== null
      ? Math.abs(quote.close - sector.lead.price)
      : null;
  if (priceGap === null) {
    reasons.push('领涨股收盘价或板块给出的领涨价缺失，价格一致性未能校验。');
  } else if (priceGap > 0.011) {
    reasons.push(
      `领涨股收盘价 ${quote.close} 与板块领涨价 ${sector.lead.price} 不一致。`,
    );
  }
  return {
    ...base,
    status: reasons.length ? 'DEGRADED' : 'READY',
    reasons,
  };
}
