import type mongoose from 'mongoose';

export type Db = mongoose.mongo.Db;

export interface MigrationLogger {
  info(message: string): void;
  warn(message: string): void;
}

/**
 * NFR-M5: every migration is versioned (ordered `id`) and reversible (`down`).
 * Both directions must be idempotent so a run that fails half-way can be retried.
 * A migration is immutable once merged: change the schema with a new migration.
 */
export interface Migration {
  id: string;
  description: string;
  up(db: Db, log: MigrationLogger): Promise<void>;
  down(db: Db, log: MigrationLogger): Promise<void>;
}

export interface IndexSpec {
  key: Record<string, 1 | -1 | 'text'>;
  name: string;
  unique?: boolean;
  expireAfterSeconds?: number;
  /** Index only documents matching this filter (for example, only set token hashes). */
  partialFilterExpression?: Record<string, unknown>;
}
