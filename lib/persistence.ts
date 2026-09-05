import { env } from 'cloudflare:workers';

import seedDocument from '@/lib/close-history.generated.json';
import type { CloseHistoryDocument, CloseSnapshot } from '@/lib/close-history';

type PersistedRow = {
  payload_json: string;
  captured_at?: string;
};

let schemaReady: Promise<void> | null = null;

function getDatabase(): D1Database {
  const database = (env as unknown as { DB?: D1Database }).DB;
  if (!database) throw new Error('D1 数据库尚未绑定');
  return database;
}

async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const database = getDatabase();
    await database.batch([
      database.prepare(`CREATE TABLE IF NOT EXISTS close_snapshots (
        trade_date TEXT PRIMARY KEY NOT NULL,
        cutoff TEXT NOT NULL,
        status TEXT NOT NULL,
        source TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        archived_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`),
      database.prepare(`CREATE TABLE IF NOT EXISTS market_module_snapshots (
        module TEXT NOT NULL,
        trade_date TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        PRIMARY KEY (module, trade_date)
      )`),
      database.prepare(`CREATE INDEX IF NOT EXISTS market_module_latest_idx
        ON market_module_snapshots (module, captured_at)`),
    ]);
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

function normalizeDate(value: string) {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 8) return value;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

export async function saveCloseSnapshot(snapshot: CloseSnapshot) {
  await ensureSchema();
  const database = getDatabase();
  const now = new Date().toISOString();
  await database
    .prepare(`INSERT INTO close_snapshots
      (trade_date, cutoff, status, source, payload_json, archived_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(trade_date) DO UPDATE SET
        cutoff = excluded.cutoff,
        status = excluded.status,
        source = excluded.source,
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at`)
    .bind(
      snapshot.date,
      snapshot.cutoff,
      snapshot.status,
      snapshot.source,
      JSON.stringify(snapshot),
      now,
      now,
    )
    .run();
}

async function seedCloseSnapshots() {
  await ensureSchema();
  const database = getDatabase();
  const countRow = await database
    .prepare('SELECT COUNT(*) AS total FROM close_snapshots')
    .first<{ total: number }>();
  if (Number(countRow?.total ?? 0) > 0) return;
  const seed = seedDocument as CloseHistoryDocument;
  const now = new Date().toISOString();
  await database.batch(
    seed.snapshots.map((snapshot) =>
      database
        .prepare(`INSERT OR IGNORE INTO close_snapshots
      (trade_date, cutoff, status, source, payload_json, archived_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          snapshot.date,
          snapshot.cutoff,
          snapshot.status,
          snapshot.source,
          JSON.stringify(snapshot),
          now,
          now,
        ),
    ),
  );
}

export async function loadCloseHistory(): Promise<CloseSnapshot[]> {
  await seedCloseSnapshots();
  const database = getDatabase();
  const result = await database
    .prepare('SELECT payload_json FROM close_snapshots ORDER BY trade_date ASC')
    .all<PersistedRow>();
  return result.results.map(
    (row) => JSON.parse(row.payload_json) as CloseSnapshot,
  );
}

export async function saveModuleSnapshot(
  module: string,
  payload: { tradeDate?: string; date?: string },
) {
  await ensureSchema();
  const database = getDatabase();
  const tradeDate = normalizeDate(
    String(payload.tradeDate ?? payload.date ?? ''),
  );
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) return;
  const now = new Date().toISOString();
  await database
    .prepare(`INSERT INTO market_module_snapshots
      (module, trade_date, payload_json, captured_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(module, trade_date) DO UPDATE SET
        payload_json = excluded.payload_json,
        captured_at = excluded.captured_at`)
    .bind(module, tradeDate, JSON.stringify(payload), now)
    .run();
}

export async function loadLatestModuleSnapshot<T>(
  module: string,
): Promise<(T & { persistedAt?: string }) | null> {
  await ensureSchema();
  const database = getDatabase();
  const row = await database
    .prepare(`SELECT payload_json, captured_at
      FROM market_module_snapshots
      WHERE module = ?
      ORDER BY trade_date DESC, captured_at DESC
      LIMIT 1`)
    .bind(module)
    .first<PersistedRow>();
  if (!row) return null;
  return {
    ...(JSON.parse(row.payload_json) as T),
    persistedAt: row.captured_at,
  };
}
