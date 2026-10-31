/* Conexión a MongoDB e índices. */
import { MongoClient } from 'mongodb';

/** Colecciones con datos de la app (una por tipo de documento). */
export const COLLECTIONS = ['chats', 'messages', 'categories', 'groups'];

export async function connect(uri, dbName) {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  const db = client.db(dbName);
  await ensureIndexes(db);
  return { client, db };
}

export async function ensureIndexes(db) {
  await Promise.all(COLLECTIONS.map((name) => db.collection(name).createIndex({ _rev: 1 })));
  await db.collection('messages').createIndex({ chatId: 1 });
  await db.collection('messages').createIndex({ remindAt: 1 }, { sparse: true });
}
