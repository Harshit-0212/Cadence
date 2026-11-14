import { MongoClient, type Db } from 'mongodb';
import { config } from '../config.js';

let client: MongoClient | null = null;
let dbPromise: Promise<Db> | null = null;

async function connect(): Promise<Db> {
  const c = new MongoClient(config.mongoUri, { serverSelectionTimeoutMS: 2500 });
  await c.connect();
  client = c;
  return c.db(config.mongoDbName);
}

export function getDb(): Promise<Db> {
  if (!dbPromise) {
    dbPromise = connect().catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

export async function isDbConnected(): Promise<boolean> {
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

export async function closeDb(): Promise<void> {
  await client?.close();
  client = null;
  dbPromise = null;
}
