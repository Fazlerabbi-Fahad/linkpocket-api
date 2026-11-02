import type { Db, IndexSpec, MigrationLogger } from './types.js';

export async function collectionExists(db: Db, name: string): Promise<boolean> {
  const found = await db.listCollections({ name }, { nameOnly: true }).toArray();
  return found.length > 0;
}

export async function ensureCollection(db: Db, name: string): Promise<void> {
  if (!(await collectionExists(db, name))) await db.createCollection(name);
}

export async function createIndexes(db: Db, collection: string, specs: IndexSpec[]): Promise<void> {
  if (specs.length === 0) return;
  await db.collection(collection).createIndexes(
    specs.map(({ key, name, unique, expireAfterSeconds, partialFilterExpression }) => ({
      key,
      name,
      ...(unique !== undefined ? { unique } : {}),
      ...(expireAfterSeconds !== undefined ? { expireAfterSeconds } : {}),
      ...(partialFilterExpression !== undefined ? { partialFilterExpression } : {}),
    })),
  );
}

export async function dropIndexesIfPresent(
  db: Db,
  collection: string,
  names: string[],
): Promise<void> {
  if (!(await collectionExists(db, collection))) return;
  const existing = new Set((await db.collection(collection).indexes()).map((index) => index.name));
  for (const name of names) {
    if (existing.has(name)) await db.collection(collection).dropIndex(name);
  }
}

/**
 * Rolling back a "create collection" migration must never destroy data (ADR-0003):
 * the collection is dropped only when it is empty; otherwise it is kept and reported.
 */
export async function dropCollectionIfEmpty(
  db: Db,
  name: string,
  log: MigrationLogger,
): Promise<void> {
  if (!(await collectionExists(db, name))) return;
  const hasDocuments = (await db.collection(name).countDocuments({}, { limit: 1 })) > 0;
  if (hasDocuments) {
    log.warn(`Kept collection "${name}" because it contains documents.`);
    return;
  }
  await db.dropCollection(name);
}
