import { index, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const closeSnapshots = sqliteTable('close_snapshots', {
  tradeDate: text('trade_date').primaryKey(),
  cutoff: text('cutoff').notNull(),
  status: text('status').notNull(),
  source: text('source').notNull(),
  payloadJson: text('payload_json').notNull(),
  archivedAt: text('archived_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const marketModuleSnapshots = sqliteTable(
  'market_module_snapshots',
  {
    module: text('module').notNull(),
    tradeDate: text('trade_date').notNull(),
    payloadJson: text('payload_json').notNull(),
    capturedAt: text('captured_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.module, table.tradeDate] }),
    index('market_module_latest_idx').on(table.module, table.capturedAt),
  ],
);
