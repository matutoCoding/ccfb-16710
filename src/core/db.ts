import type { CaseRecord, KvRecord, ScanRecording, ScoreRecord } from './types'

const DB_NAME = 'ultrasound-training-workbench'
const DB_VERSION = 1

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('cases')) {
        const store = db.createObjectStore('cases', { keyPath: 'id' })
        store.createIndex('createdAt', 'createdAt')
        store.createIndex('name', 'name')
      }
      if (!db.objectStoreNames.contains('scores')) {
        const store = db.createObjectStore('scores', { keyPath: 'id' })
        store.createIndex('student', 'student')
        store.createIndex('taskId', 'taskId')
        store.createIndex('createdAt', 'createdAt')
      }
      if (!db.objectStoreNames.contains('recordings')) {
        const store = db.createObjectStore('recordings', { keyPath: 'id' })
        store.createIndex('student', 'student')
        store.createIndex('createdAt', 'createdAt')
      }
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return dbPromise
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (objectStore: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode)
        const request = run(transaction.objectStore(store))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
  )
}

export const db = {
  async putCase(record: CaseRecord): Promise<void> {
    await tx('cases', 'readwrite', (s) => s.put(record))
  },
  async getCase(id: string): Promise<CaseRecord | undefined> {
    return tx<CaseRecord | undefined>('cases', 'readonly', (s) => s.get(id))
  },
  async getAllCases(): Promise<CaseRecord[]> {
    return tx<CaseRecord[]>('cases', 'readonly', (s) => s.getAll())
  },
  async deleteCase(id: string): Promise<void> {
    await tx('cases', 'readwrite', (s) => s.delete(id))
  },
  async putScore(record: ScoreRecord): Promise<void> {
    await tx('scores', 'readwrite', (s) => s.put(record))
  },
  async getAllScores(): Promise<ScoreRecord[]> {
    return tx<ScoreRecord[]>('scores', 'readonly', (s) => s.getAll())
  },
  async deleteScore(id: string): Promise<void> {
    await tx('scores', 'readwrite', (s) => s.delete(id))
  },
  async clearScores(): Promise<void> {
    await tx('scores', 'readwrite', (s) => s.clear())
  },
  async putRecording(record: ScanRecording): Promise<void> {
    await tx('recordings', 'readwrite', (s) => s.put(record))
  },
  async getAllRecordings(): Promise<ScanRecording[]> {
    return tx<ScanRecording[]>('recordings', 'readonly', (s) => s.getAll())
  },
  async deleteRecording(id: string): Promise<void> {
    await tx('recordings', 'readwrite', (s) => s.delete(id))
  },
  async getKv<T>(key: string): Promise<T | undefined> {
    const row = await tx<KvRecord | undefined>('kv', 'readonly', (s) => s.get(key))
    return row?.value as T | undefined
  },
  async setKv(key: string, value: unknown): Promise<void> {
    await tx('kv', 'readwrite', (s) => s.put({ key, value } satisfies KvRecord))
  }
}

export function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `${prefix}-${crypto.randomUUID()}`
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}
