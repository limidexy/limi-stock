import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { closeDirectory } from './close-package.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'close-contract-'));
  t.after(() => fs.rmSync(root, { recursive: true }));
  const dir = path.join(root, 'data/market_close_modules_v261/20260930/CLOSE');
  fs.mkdirSync(dir, { recursive: true });
  const contract = {
    tradeDate: '20260930',
    sessionKind: 'CLOSE',
    marketDataCutoff: '15:00',
  };
  const structure = zlib.gzipSync(JSON.stringify(contract));
  fs.writeFileSync(path.join(dir, 'structure.json.gz'), structure);
  const manifest = {
    ...contract,
    version: 'close-capabilities:v2.61',
    status: 'DEGRADED',
    baseReady: true,
    modules: Object.fromEntries(
      ['quotes', 'indices', 'limit_up', 'limit_down', 'failed_board'].map(
        (k) => [k, { status: 'READY' }],
      ),
    ),
    artifacts: [
      {
        path: path.relative(root, path.join(dir, 'structure.json.gz')),
        bytes: structure.length,
        sha256: crypto.createHash('sha256').update(structure).digest('hex'),
      },
    ],
  };
  const save = () =>
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  save();
  return { root, dir, manifest, save };
}

test('independent validated base is consumable without calling full CLOSE READY', (t) => {
  const f = fixture(t);
  assert.equal(closeDirectory(f.root, '20260930'), f.dir);
  assert.equal(f.manifest.status, 'DEGRADED');
});
test('reject a modular manifest with no bound structure', (t) => {
  const f = fixture(t);
  f.manifest.artifacts = [];
  f.save();
  assert.throws(() => closeDirectory(f.root, '20260930'), /Missing bound/);
});
test('reject unhashed optional minute prices and damaged bytes', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.dir, 'minute_ohlcv.jsonl.gz'), 'unbound');
  assert.throws(() => closeDirectory(f.root, '20260930'), /Unhashed/);
  fs.unlinkSync(path.join(f.dir, 'minute_ohlcv.jsonl.gz'));
  fs.appendFileSync(path.join(f.dir, 'structure.json.gz'), 'bad');
  assert.throws(() => closeDirectory(f.root, '20260930'), /integrity/);
});
test('a rejected standard package does not hide independently validated same-day base', (t) => {
  const f = fixture(t);
  const standard = path.join(f.root, 'data/market/20260930/CLOSE');
  fs.mkdirSync(standard, { recursive: true });
  fs.writeFileSync(path.join(standard, 'manifest.json'), '{corrupted');
  assert.equal(closeDirectory(f.root, '20260930'), f.dir);
});
