// Run AFTER the final clean commit and `pnpm build`, BEFORE uploading dist to
// the existing Sites project. Never claim a dirty build belongs to a clean SHA.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const git = (...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const dirty = git('status', '--porcelain').length > 0;
if (dirty && !process.argv.includes('--allow-dirty')) {
  throw new Error(
    'Refusing to stamp a dirty checkout as a deployable release. Commit the reviewed changes first.',
  );
}
const hosting = JSON.parse(fs.readFileSync('.openai/hosting.json', 'utf8'));
const bundled = JSON.parse(
  fs.readFileSync('dist/.openai/hosting.json', 'utf8'),
);
if (
  !hosting.project_id ||
  hosting.project_id !== bundled.project_id ||
  hosting.d1 !== bundled.d1
) {
  throw new Error(
    'Built Sites project or database binding differs from the existing checkout.',
  );
}
const buildId = fs.readFileSync('dist/server/BUILD_ID', 'utf8').trim();
const commitSha = git('rev-parse', 'HEAD');
const hash = (file) =>
  createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const chunks = 'dist/client/_next/static/chunks';
const pageAssets = fs
  .readdirSync(chunks)
  .filter((name) => /^page-.*\.js$/.test(name))
  .sort();
if (!pageAssets.length || !buildId)
  throw new Error('A complete vinext production build is required.');
const release = {
  schema: 'limi-site-release-v1',
  version: 'emotion-core-v6',
  projectId: hosting.project_id,
  commitSha,
  dirty,
  buildId,
  stampedAt: new Date().toISOString(),
  serverSha256: hash('dist/server/index.js'),
  pageAssets: pageAssets.map((name) => ({
    path: `/_next/static/chunks/${name}`,
    sha256: hash(path.join(chunks, name)),
  })),
};
fs.writeFileSync(
  'dist/client/site-version.json',
  `${JSON.stringify(release, null, 2)}\n`,
);
console.log(JSON.stringify(release, null, 2));
