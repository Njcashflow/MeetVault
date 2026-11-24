import { openDB, IDBPDatabase } from 'idb';
import { MeetingSession, CorrectionRule } from '../types';

export class SessionRepository {
  private dbPromise: Promise<IDBPDatabase>;

  constructor() {
    this.dbPromise = openDB('MeetVaultDB', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('sessions')) {
          db.createObjectStore('sessions', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('dictionary')) {
          db.createObjectStore('dictionary', { keyPath: 'id' });
        }
      }
    });
  }

  async saveSession(session: MeetingSession): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction('sessions', 'readwrite');
    const existing = await tx.store.get(session.id);

    if (existing && existing.version !== session.version) {
      throw new Error('OptimisticLockError: Session was modified in another context.');
    }

    session.version += 1;
    await tx.store.put(session);
    await tx.done;
  }

  async getSession(id: string): Promise<MeetingSession | undefined> {
    const db = await this.dbPromise;
    return db.get('sessions', id);
  }

  async getAllSessions(): Promise<MeetingSession[]> {
    const db = await this.dbPromise;
    return db.getAll('sessions');
  }

  async deleteSession(id: string): Promise<void> {
    const db = await this.dbPromise;
    await db.delete('sessions', id);
  }

  async getAllRules(): Promise<CorrectionRule[]> {
    const db = await this.dbPromise;
    return db.getAll('dictionary');
  }

  async saveRule(rule: CorrectionRule): Promise<void> {
    const db = await this.dbPromise;
    await db.put('dictionary', rule);
  }

  async deleteRule(id: string): Promise<void> {
    const db = await this.dbPromise;
    await db.delete('dictionary', id);
  }
}
