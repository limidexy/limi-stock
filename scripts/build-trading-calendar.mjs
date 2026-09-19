import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const outputPath = path.join(
  projectRoot,
  'lib',
  'trading-calendar.generated.json',
);
const symbols = ['sh000001', 'sz399001'];

async function sessions(symbol) {
  const response = await fetch(
    `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,,,180,qfq`,
    { headers: { 'user-agent': 'Mozilla/5.0' } },
  );
  if (!response.ok)
    throw new Error(`${symbol} 日线请求失败 HTTP ${response.status}`);
  const payload = await response.json();
  const rows = payload?.data?.[symbol]?.qfqday ?? payload?.data?.[symbol]?.day;
  if (!Array.isArray(rows) || rows.length < 20)
    throw new Error(`${symbol} 日线交易日不足`);
  return rows
    .map((row) => String(row?.[0] ?? ''))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));
}

const calendars = await Promise.all(symbols.map(sessions));
const dates = calendars[0].filter((date) =>
  calendars.slice(1).every((calendar) => calendar.includes(date)),
);
if (!dates.length) throw new Error('两市指数没有交集交易日');

const document = {
  version: 1,
  generatedAt: new Date().toISOString(),
  status: 'READY',
  source: '腾讯行情上证指数与深证成指日线日期交集',
  symbols,
  dates,
};
fs.writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`);
console.log(
  `Wrote ${dates.length} verified sessions through ${dates.at(-1)} to ${outputPath}`,
);
