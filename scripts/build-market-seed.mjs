import fs from 'node:fs';
import path from 'node:path';

const baseUrl = process.argv[2] ?? 'http://localhost:3000';
const outputPath = path.join(process.cwd(), 'lib', 'market-snapshots.generated.json');
const modules = ['radar', 'flow', 'timeline', 'ladder', 'speed'];
const snapshots = {};

for (const moduleName of modules) {
  const response = await fetch(`${baseUrl}/api/${moduleName}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${moduleName} seed failed: HTTP ${response.status}`);
  const payload = await response.json();
  const hasRows = ['events', 'series', 'competitors', 'rows'].some((key) => Array.isArray(payload[key]) && payload[key].length > 0);
  if (!hasRows) throw new Error(`${moduleName} seed is empty`);
  snapshots[moduleName] = {
    ...payload,
    sourceState: 'ARCHIVED',
    sessionState: 'CLOSED',
    phase: '休市快照',
  };
}

fs.writeFileSync(outputPath, `${JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), snapshots })}\n`);
console.log(`Wrote ${modules.length} market seed snapshots to ${outputPath}`);
