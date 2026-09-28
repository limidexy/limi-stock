// Verifies the deployed public artifact against this checkout's stamped build.
// This is a release-integrity check, not a market-data or trading-quality test.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';

const target = new URL(
  process.argv[2] ?? 'https://dengfeng-intraday-radar.lxd215434.chatgpt.site/',
);
if (
  target.protocol !== 'https:' &&
  !['localhost', '127.0.0.1'].includes(target.hostname)
) {
  throw new Error('Public verification requires HTTPS.');
}
const local = JSON.parse(
  fs.readFileSync('dist/client/site-version.json', 'utf8'),
);
const hosting = JSON.parse(fs.readFileSync('.openai/hosting.json', 'utf8'));
const head = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();
if (
  local.commitSha !== head ||
  local.projectId !== hosting.project_id ||
  local.dirty
) {
  throw new Error(
    'Local release metadata does not identify the reviewed, clean HEAD and original Sites project.',
  );
}
const get = async (pathname) => {
  const url = new URL(pathname, target.origin);
  url.searchParams.set('release_verify', local.buildId);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30000),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`${pathname}: HTTP ${response.status}`);
  return response;
};
const remote = await (await get('/site-version.json')).json();
for (const key of [
  'schema',
  'version',
  'projectId',
  'commitSha',
  'buildId',
  'serverSha256',
  'dirty',
]) {
  if (remote[key] !== local[key])
    throw new Error(`Deployed ${key} differs from the local artifact.`);
}
const html = await (await get('/')).text();
const assets = [];
for (const asset of local.pageAssets) {
  const bytes = new Uint8Array(await (await get(asset.path)).arrayBuffer());
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== asset.sha256)
    throw new Error(`Asset hash mismatch: ${asset.path}`);
  assets.push({ ...asset, verified: true });
}
if (!local.pageAssets.some((asset) => html.includes(asset.path))) {
  throw new Error(
    'The public root page is not referencing the stamped page bundle.',
  );
}
console.log(
  JSON.stringify(
    {
      status: 'PASS',
      checkedAt: new Date().toISOString(),
      url: target.origin,
      version: remote.version,
      projectId: remote.projectId,
      commitSha: remote.commitSha,
      buildId: remote.buildId,
      assets,
    },
    null,
    2,
  ),
);
