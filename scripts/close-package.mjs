import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

// A module package is not a full READY recap package. Consumers request its
// validated base capabilities, and propagate its independent module gaps.
export function closeDirectory(root, date) {
  const rejected = [];
  for (const directory of [
    path.join(root, 'data/market', date, 'CLOSE'),
    path.join(root, 'data/market_close_modules_v261', date, 'CLOSE'),
  ]) {
    const file = path.join(directory, 'manifest.json');
    if (!fs.existsSync(file)) continue;
    try {
      const m = JSON.parse(fs.readFileSync(file, 'utf8'));
      const modular = m.version === 'close-capabilities:v2.61';
      if (
        m.tradeDate !== date ||
        m.sessionKind !== 'CLOSE' ||
        m.marketDataCutoff !== '15:00'
      )
        continue;
      if (modular ? !m.baseReady : m.status !== 'READY') continue;
      if (
        modular &&
        !['quotes', 'indices', 'limit_up', 'failed_board', 'limit_down'].every(
          (key) => m.modules?.[key]?.status === 'READY',
        )
      )
        continue;
      if (
        !Array.isArray(m.artifacts) ||
        !m.artifacts.some(
          (a) =>
            path.resolve(root, a.path) ===
            path.join(directory, 'structure.json.gz'),
        )
      )
        throw new Error(`Missing bound CLOSE structure: ${date}`);
      const names = new Set();
      for (const artifact of m.artifacts ?? []) {
        const absolute = path.resolve(root, artifact.path);
        if (path.dirname(absolute) !== directory || names.has(absolute))
          throw new Error(`Unbound or duplicate CLOSE artifact: ${date}`);
        names.add(absolute);
        const bytes = fs.readFileSync(path.resolve(root, artifact.path));
        if (
          bytes.length !== artifact.bytes ||
          crypto.createHash('sha256').update(bytes).digest('hex') !==
            artifact.sha256
        )
          throw new Error(
            `CLOSE artifact integrity failed: ${date}/${path.basename(artifact.path)}`,
          );
      }
      for (const name of ['minute_ohlcv.jsonl.gz', 'daily_ohlcv.jsonl.gz'])
        if (
          fs.existsSync(path.join(directory, name)) &&
          !names.has(path.join(directory, name))
        )
          throw new Error(`Unhashed CLOSE prices: ${date}`);
      const structure = JSON.parse(
        zlib.gunzipSync(
          fs.readFileSync(path.join(directory, 'structure.json.gz')),
        ),
      );
      if (
        structure.tradeDate !== date ||
        structure.sessionKind !== 'CLOSE' ||
        structure.marketDataCutoff !== '15:00'
      )
        throw new Error(`CLOSE structure date mismatch: ${date}`);
      if (rejected.length)
        console.warn(
          `Rejected CLOSE ${date}: ${rejected.join('; ')}; using independent DEGRADED capabilities`,
        );
      return directory;
    } catch (error) {
      rejected.push(String(error));
    }
  }
  if (rejected.length)
    throw new Error(`No verified CLOSE ${date}: ${rejected.join('; ')}`);
  return null;
}

export function closeDates(root) {
  const dates = new Set();
  for (const base of ['data/market', 'data/market_close_modules_v261']) {
    const directory = path.join(root, base);
    if (fs.existsSync(directory))
      for (const date of fs.readdirSync(directory))
        if (/^\d{8}$/.test(date)) dates.add(date);
  }
  return [...dates].sort().filter((date) => {
    try {
      return closeDirectory(root, date);
    } catch (error) {
      console.warn(String(error));
      return false;
    }
  });
}
