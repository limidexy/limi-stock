import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alignedSnapshot,
  overviewSessionLabel,
} from '../lib/snapshot-alignment.ts';

test('overview rejects older LIVE flow alongside a newer close', () => {
  assert.equal(
    alignedSnapshot(
      { tradeDate: '20260928', sourceState: 'LIVE' },
      '2026-09-30',
    ),
    null,
  );
  assert.equal(overviewSessionLabel('CLOSED'), '最近定格');
});
test('same-day archive is usable without being live', () => {
  const row = { tradeDate: '20260930', sourceState: 'ARCHIVED' };
  assert.equal(alignedSnapshot(row, '2026-09-30'), row);
  assert.equal(overviewSessionLabel('LIVE'), '盘中');
});
test('unknown dates and explicit stale data do not become current evidence', () => {
  assert.equal(
    alignedSnapshot(
      { tradeDate: '20260930', sourceState: 'STALE' },
      '20260930',
    ),
    null,
  );
  assert.equal(alignedSnapshot({ tradeDate: '20260930' }), null);
  assert.equal(alignedSnapshot({ tradeDate: '20260930' }, 'bad-date'), null);
  assert.equal(alignedSnapshot(null, '20260930'), null);
  assert.equal(overviewSessionLabel(), '最近定格');
});
