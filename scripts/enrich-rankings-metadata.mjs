/**
 * 给多周期涨幅榜单补「行业 / 题材」。
 *
 * 来源：东财 F10 CoreConception 的 ssbk（所属板块）。
 *   BOARD_RANK 1 = 一级行业，2 = 二级行业，3 = 三级行业，
 *   之后是地域板块、行情/状态标签、真实概念混在一起。
 *
 * 必须做的剔除：状态类标签（昨日涨停、机构重仓、百日新高、融资融券…）
 * 不是题材。混进「题材」列会让这一列变成噪音，所以按白名单外的标签一律丢掉，
 * 只保留真实概念（新零售、人形机器人、央国企改革…）。
 *
 * 只补元数据，不改涨幅、不改名次、不改区间。取不到的写 metadataStatus=DEGRADED 并写明原因。
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIR = path.join(ROOT, 'public/rankings');
const CACHE = path.join(DIR, 'metadata.json');
const SOURCE = '东方财富 F10 所属板块';
const HEADERS = {
  referer: 'https://emweb.securities.eastmoney.com/',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

/** 行情/状态/风格类标签：不是题材。 */
const NOT_THEME = new Set(
  [
    '题材股',
    '趋势股',
    '东方财富热股',
    '机构重仓',
    '基金重仓',
    '基金减仓',
    '基金增仓',
    'QFII重仓',
    '社保重仓',
    '保险重仓',
    '券商重仓',
    '信托重仓',
    '融资融券',
    '沪股通',
    '深股通',
    '转融券标的',
    '昨日涨停',
    '昨日涨停_含一字',
    '昨日连板_含一字',
    '昨日炸板',
    '昨日触板',
    '昨日高振幅',
    '昨日高换手',
    '昨日打二板以上表现',
    '最近多板',
    '百日新高',
    '历史新高',
    '近期新高',
    '连续亏损',
    '次新股',
    '注册制次新股',
    '高送转',
    '股权激励',
    '预盈预增',
    '预亏预减',
    '破净股',
    '低价股',
    '高价股',
    '大盘股',
    '中盘股',
    '小盘股',
    '微盘股',
    '超大盘',
    'AH股',
    'B股',
    'GDR',
    'MSCI中国',
    '标准普尔',
    '富时罗素',
    '标普道琼斯A股',
    '深成500',
    '上证180_',
    '上证50_',
    '沪深300_',
    '中证500',
    '创业板综',
    '科创板做市商',
    'HS300_',
    '上证380',
    '上证50_',
    '深证100R',
    '中盘价值',
    '中盘成长',
    '小盘价值',
    '小盘成长',
    '大盘价值',
    '大盘成长',
    '养老金',
    '证金持股',
    '汇金持股',
  ].map((x) => x.toLowerCase()),
);

/** 业绩期标签，如「2026中报首亏」「2025年报预增」。 */
const PERIOD_LABEL = /^\d{4}(一季报|中报|三季报|年报)/;

/** 纯地域名（不带「板块」后缀时也要剔除，否则会被当成题材）。 */
const PROVINCES = new Set([
  '北京', '上海', '天津', '重庆', '河北', '山西', '内蒙古', '辽宁', '吉林',
  '黑龙江', '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南', '湖北',
  '湖南', '广东', '广西', '海南', '四川', '贵州', '云南', '西藏', '陕西',
  '甘肃', '青海', '宁夏', '新疆', '深圳', '广州', '杭州', '南京', '武汉',
]);

function isTheme(name) {
  const clean = name.trim();
  if (!clean) return false;
  if (clean.endsWith('板块')) return false; // 地域板块
  if (NOT_THEME.has(clean.toLowerCase())) return false;
  if (PERIOD_LABEL.test(clean)) return false;
  if (/[ⅡⅢ]$/.test(clean)) return false;
  if (/^(预|昨日|最近|连续)/.test(clean) && clean.length <= 8) return false;
  // 持仓/资金类标签：QFII新进、私募新进、基金增仓…
  if (/(新进|重仓|减仓|增仓)$/.test(clean)) return false;
  // 估值/价格/风格类标签：百元股、高市盈率、高市净率、消费风格、转债标的
  if (clean.endsWith('股') && clean.length <= 5) return false;
  if (/(市盈率|市净率|标的|风格)$/.test(clean)) return false;
  if (['专精特新', '独角兽', '瞪羚企业', '隐形冠军', '细分龙头'].includes(clean))
    return false;
  if (PROVINCES.has(clean)) return false;
  return true;
}

function prefix(code) {
  if (code.startsWith('6')) return 'SH';
  if (code.startsWith('8') || code.startsWith('9') || code.startsWith('4'))
    return 'BJ';
  return 'SZ';
}

async function fetchJson(url, timeoutMs = 12_000) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: HEADERS,
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      last = error;
      if (attempt < 3)
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw last;
}

/** 解析一只股票的行业与题材。行业取一级·二级，题材取剔除状态标签后的概念。 */
export function parseBoards(code, payload) {
  const rows = Array.isArray(payload?.ssbk) ? payload.ssbk : [];
  if (!rows.length)
    return {
      code,
      status: 'DEGRADED',
      industry: null,
      themes: [],
      reason: 'F10 未返回所属板块',
    };
  const ranked = [...rows]
    .map((row) => ({
      rank: Number(row.BOARD_RANK ?? 999),
      name: String(row.BOARD_NAME ?? '').trim(),
    }))
    .filter((row) => row.name)
    .sort((a, b) => a.rank - b.rank);
  const levels = ranked
    .filter((row) => row.rank <= 3)
    .map((row) => row.name);
  const industry = [...new Set(levels)].slice(0, 2).join(' · ') || null;
  const themes = [
    ...new Set(
      ranked
        .filter((row) => row.rank > 3 || !levels.includes(row.name))
        .map((row) => row.name)
        .filter(isTheme),
    ),
  ].slice(0, 6);
  return {
    code,
    status: industry || themes.length ? 'READY' : 'DEGRADED',
    industry,
    themes,
    reason: industry || themes.length ? null : '所属板块里没有可用行业或题材',
  };
}

async function mapLimit(items, limit, worker) {
  const out = [];
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        out[index] = await worker(items[index]);
      }
    }),
  );
  return out;
}

async function collectCodes() {
  const files = (await readdir(DIR)).filter(
    (name) => /^\d{8}\.json$/.test(name),
  );
  const codes = new Set();
  for (const name of files) {
    const payload = JSON.parse(await readFile(path.join(DIR, name), 'utf8'));
    for (const window of Object.values(payload.windows ?? {})) {
      for (const row of window.rows ?? []) codes.add(row.code);
    }
  }
  return { files, codes: [...codes].sort((a, b) => a.localeCompare(b)) };
}

async function main() {
  const { files, codes } = await collectCodes();
  let cache = { version: 1, source: SOURCE, generatedAt: null, records: {} };
  try {
    cache = JSON.parse(await readFile(CACHE, 'utf8'));
  } catch {
    // 首次运行没有缓存
  }
  const records = cache.records ?? {};
  // 过滤规则会演进；旧缓存里的题材再过滤一次，不必重新抓取。
  for (const record of Object.values(records)) {
    record.themes = (record.themes ?? []).filter(isTheme);
    if (!record.industry && !record.themes.length) record.status = 'DEGRADED';
  }
  const missing = codes.filter((code) => records[code]?.status !== 'READY');
  console.log(`榜单文件 ${files.length} 个，股票 ${codes.length} 只，待补 ${missing.length} 只`);

  const fetched = await mapLimit(missing, 5, async (code) => {
    try {
      const payload = await fetchJson(
        `https://emweb.securities.eastmoney.com/PC_HSF10/CoreConception/PageAjax?code=${prefix(code)}${code}`,
      );
      return parseBoards(code, payload);
    } catch (error) {
      return {
        code,
        status: 'DEGRADED',
        industry: null,
        themes: [],
        reason: error instanceof Error ? error.message : '请求失败',
      };
    }
  });
  for (const item of fetched) records[item.code] = item;

  const ready = Object.values(records).filter((x) => x.status === 'READY').length;
  console.log(`元数据可用 ${ready}/${codes.length}`);
  await writeFile(
    CACHE,
    `${JSON.stringify(
      { version: 1, source: SOURCE, generatedAt: new Date().toISOString(), records },
      null,
      2,
    )}\n`,
  );

  let touched = 0;
  for (const name of files) {
    const file = path.join(DIR, name);
    const payload = JSON.parse(await readFile(file, 'utf8'));
    let changed = false;
    for (const window of Object.values(payload.windows ?? {})) {
      let metadataReady = 0;
      for (const row of window.rows ?? []) {
        const meta = records[row.code];
        const industry = meta?.industry ?? null;
        const themes = meta?.themes ?? [];
        if (row.industry !== industry || JSON.stringify(row.themes) !== JSON.stringify(themes)) {
          row.industry = industry;
          row.themes = themes;
          changed = true;
        }
        row.metadataStatus = industry || themes.length ? 'READY' : 'DEGRADED';
        if (industry && themes.length) metadataReady += 1;
      }
      if (window.metadataReady !== metadataReady) {
        window.metadataReady = metadataReady;
        changed = true;
      }
    }
    const metadata = { industry: true, themes: true };
    if (JSON.stringify(payload.metadata) !== JSON.stringify(metadata)) {
      payload.metadata = metadata;
      changed = true;
    }
    if (changed) {
      await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`);
      touched += 1;
    }
  }
  console.log(`改写榜单 ${touched} 个文件`);
}

await main();
