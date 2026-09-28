import fs from 'node:fs';
import { shortEmotionReading } from '../lib/market-reading.ts';
import { buildCoreEvidence } from '../lib/core-evidence.ts';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  if (!process.argv[i].startsWith('--') || !process.argv[i + 1])
    throw new Error(
      'Usage: node --experimental-strip-types scripts/audit-emotion-cores.mjs --emotion FILE --ladder FILE [--tracking FILE] [--speed FILE] [--history FILE] [--output FILE]',
    );
  args.set(process.argv[i].slice(2), process.argv[i + 1]);
}
const read = (key, fallback) => {
  const file = args.get(key) ?? fallback;
  if (!file) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};
const emotion = read('emotion'),
  ladder = read('ladder'),
  tracking = read('tracking');
if (!emotion?.tradeDate || !ladder?.tradeDate)
  throw new Error('Exact-date emotion and ladder snapshots are required.');
const document = read('history', 'lib/close-history.generated.json');
const history = document.snapshots ?? document;
const dashed = (date) =>
  date.replace(/^(\d{4})-?(\d{2})-?(\d{2})$/, '$1-$2-$3');
const facts = {
  ...emotion,
  date: dashed(emotion.tradeDate),
  previousDate: dashed(
    ladder.tradeDate.replaceAll('-', '') ===
      emotion.tradeDate.replaceAll('-', '')
      ? (ladder.previousTradeDate ?? '')
      : tracking?.date?.replaceAll('-', '') ===
          emotion.tradeDate.replaceAll('-', '')
        ? (tracking.previousDate ?? '')
        : '',
  ),
  stale: emotion.sourceState === 'STALE',
  poolsReady:
    emotion.coverage?.poolsReady > 0 &&
    emotion.coverage?.poolsReady === emotion.coverage?.poolsRequested,
  breadthReady: Boolean(emotion.coverage?.breadthReady),
};
const previous = history.find(
  (snapshot) => snapshot.date === facts.previousDate,
);
const before = previous
  ? {
      ...previous,
      poolsReady:
        previous.ladders.flatMap((x) => x.stocks).length === previous.limitUp,
      breadthReady: previous.breadth.rowsAvailable > 0,
    }
  : null;
const coreEvidence = buildCoreEvidence({
  facts,
  history,
  tracking,
  speed: read('speed'),
});
const reading = shortEmotionReading(facts, before, ladder, coreEvidence);
const result = {
  input: {
    emotionDate: emotion.tradeDate,
    emotionCutoff: emotion.cutoff,
    emotionSourceState: emotion.sourceState,
    ladderDate: ladder.tradeDate,
    previousTradeDate: ladder.previousTradeDate,
    ladderCapturedAt: ladder.retrievedAt,
  },
  highBoard: {
    label: reading.highBoard.label,
    tone: reading.highBoard.tone,
    summary: reading.highBoard.summary,
  },
  relay: {
    label: reading.relay.label,
    candidateCount: reading.relay.candidateCount,
    attemptRate: reading.relay.attemptRate,
  },
  core: reading.core,
};
const text = `${JSON.stringify(result, null, 2)}\n`;
if (args.get('output')) fs.writeFileSync(args.get('output'), text);
else process.stdout.write(text);
