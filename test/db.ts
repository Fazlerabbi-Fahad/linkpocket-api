import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { inject } from 'vitest';
import { connectDb } from '../src/db/connection.js';

/** Connects mongoose to a fresh, uniquely named database on the shared test server. */
export async function connectTestDb(): Promise<mongoose.mongo.Db> {
  await connectDb(inject('mongoUri'), { dbName: `lp_test_${randomUUID().slice(0, 8)}` });
  const db = mongoose.connection.db;
  if (!db) throw new Error('Test database is not connected');
  return db;
}

export async function dropTestDb(): Promise<void> {
  await mongoose.connection.db?.dropDatabase();
  await mongoose.disconnect();
}
