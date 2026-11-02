import mongoose from 'mongoose';

export interface ConnectOptions {
  dbName?: string;
}

/**
 * Connects Mongoose. Collections and indexes are owned by the versioned migrations
 * (NFR-M5, ADR-0003), so Mongoose never creates them implicitly.
 */
export async function connectDb(
  uri: string,
  options: ConnectOptions = {},
): Promise<typeof mongoose> {
  mongoose.set('strictQuery', true);
  return mongoose.connect(uri, {
    ...(options.dbName ? { dbName: options.dbName } : {}),
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 10_000,
  });
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}

export function getDb(): mongoose.mongo.Db {
  const db = mongoose.connection.db;
  if (!db) throw new Error('Database is not connected');
  return db;
}
