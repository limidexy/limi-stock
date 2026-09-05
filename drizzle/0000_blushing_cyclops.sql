CREATE TABLE `close_snapshots` (
	`trade_date` text PRIMARY KEY NOT NULL,
	`cutoff` text NOT NULL,
	`status` text NOT NULL,
	`source` text NOT NULL,
	`payload_json` text NOT NULL,
	`archived_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `market_module_snapshots` (
	`module` text NOT NULL,
	`trade_date` text NOT NULL,
	`payload_json` text NOT NULL,
	`captured_at` text NOT NULL,
	PRIMARY KEY(`module`, `trade_date`)
);
--> statement-breakpoint
CREATE INDEX `market_module_latest_idx` ON `market_module_snapshots` (`module`,`captured_at`);