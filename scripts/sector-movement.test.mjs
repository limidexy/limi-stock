import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkSectorSnapshot,
  parseSinaLeadQuote,
  parseSinaSectorPayload,
  rankSectorRows,
} from '../lib/sector-movement.ts';

// 与线上返回同构：var S_Finance_bankuai_industry = {"hangye_ZA01":"..."}。
const payload = (entries) =>
  `var S_Finance_bankuai_industry = {${entries
    .map(([key, value]) => `"${key}":"${value}"`)
    .join(',')}}`;

const row = (code, name, count, changePct, amount, lead) =>
  [
    code,
    name,
    count,
    '10.0',
    '0.1',
    changePct,
    '1000',
    amount,
    lead?.[0] ?? '',
    lead?.[1] ?? '',
    lead?.[2] ?? '',
    '0.01',
    lead?.[3] ?? '',
  ].join(',');

test('解析行业板块并带出成分家数、成交额与领涨股', () => {
  const { rows, rejected } = parseSinaSectorPayload(
    payload([
      ['hangye_ZA01', row('hangye_ZA01', '农业', 15, '-1.1456', '2826017810', ['sz300143', '0.272', '7.360', '盈康生命'])],
    ]),
    'industry',
  );
  assert.equal(rejected, 0);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, '农业');
  assert.equal(rows[0].kind, 'industry');
  assert.equal(rows[0].count, 15);
  assert.equal(rows[0].changePct, -1.1456);
  assert.equal(rows[0].amount, 2826017810);
  assert.equal(rows[0].lead?.code, 'sz300143');
  assert.equal(rows[0].lead?.name, '盈康生命');
  assert.equal(rows[0].lead?.price, 7.36);
});

test('字段不全的行被剔除并计数，不会当成正常板块', () => {
  const { rows, rejected } = parseSinaSectorPayload(
    payload([
      ['a', 'hangye_ZA01,农业,15'],
      ['b', 'hangye_ZA02,林业,3,7.2,-0.58,,204,1404,,0,,0,'],
      ['c', 'hangye_ZA03,牧业,9,7.2,-0.1,1.2,204,1404,sz1,1,1,0,某股'],
    ]),
    'industry',
  );
  assert.equal(rejected, 2);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, '牧业');
  assert.equal(rows[0].lead?.code, 'sz1');
});

test('没有涨跌幅的板块不参与排序', () => {
  const { rows } = parseSinaSectorPayload(
    payload([
      ['a', row('a', '甲', 1, '2.0', '100', ['sz1', '1', '1', '甲股'])],
      ['b', row('b', '乙', 1, '-3.0', '100', ['sz2', '1', '1', '乙股'])],
      ['c', row('c', '丙', 1, '0.5', '100', ['sz3', '1', '1', '丙股'])],
    ]),
    'industry',
  );
  const { up, down } = rankSectorRows(rows, 2);
  assert.deepEqual(up.map((item) => item.name), ['甲', '丙']);
  assert.deepEqual(down.map((item) => item.name), ['乙', '丙']);
});

test('非 JSON 响应返回空集而不是抛错', () => {
  const result = parseSinaSectorPayload('<html>502</html>', 'industry');
  assert.equal(result.rows.length, 0);
  assert.equal(result.rejected, 0);
});

test('领涨股快照解析出收盘价与报价日期', () => {
  const quote = parseSinaLeadQuote(
    'var hq_str_sz301520="万邦医药,50.810,50.050,60.060,60.060,47.060,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2026-10-30,15:35:45,00";',
  );
  assert.equal(quote?.code, 'sz301520');
  assert.equal(quote?.name, '万邦医药');
  assert.equal(quote?.close, 60.06);
  assert.equal(quote?.quoteDate, '2026-10-30');
});

const sector = {
  code: 'hangye_ZM73',
  name: '研究和试验发展',
  kind: 'industry',
  count: 31,
  changePct: 4.1668,
  amount: 28991790788,
  lead: { code: 'sz301520', name: '万邦医药', changePct: 20, price: 60.06 },
};

test('日期与价格都一致才判 READY', () => {
  const check = checkSectorSnapshot(
    sector,
    { code: 'sz301520', name: '万邦医药', close: 60.06, quoteDate: '2026-10-30' },
    '20261030',
  );
  assert.equal(check.status, 'READY');
  assert.deepEqual(check.reasons, []);
});

test('领涨股日期不一致时降级并说明差异', () => {
  const check = checkSectorSnapshot(
    sector,
    { code: 'sz301520', name: '万邦医药', close: 60.06, quoteDate: '2026-10-29' },
    '20261030',
  );
  assert.equal(check.status, 'DEGRADED');
  assert.match(check.reasons.join(' '), /与目标交易日/);
});

test('价格对不上时降级，不假装是同一份快照', () => {
  const check = checkSectorSnapshot(
    sector,
    { code: 'sz301520', name: '万邦医药', close: 59.1, quoteDate: '2026-10-30' },
    '20261030',
  );
  assert.equal(check.status, 'DEGRADED');
  assert.match(check.reasons.join(' '), /不一致/);
});

test('领涨股快照取不到时降级而不是默认通过', () => {
  const check = checkSectorSnapshot(sector, null, '20261030');
  assert.equal(check.status, 'DEGRADED');
  assert.match(check.reasons.join(' '), /未能校验/);
});
