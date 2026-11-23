/**
 * DERMA-SHIELD · vault.js
 * -----------------------------------------------------------------------------
 * PIN-locked offline clinical ledger built on IndexedDB.
 *
 * Design notes
 *  - Zero network: every scan, timer, lesion record and audit report is stored
 *    locally so the app is fully functional at the beach with no signal.
 *  - PIN protection uses PBKDF2-SHA-256 (210 000 iterations) to derive an AES-GCM
 *    key. The PIN itself is never stored — only a random salt and a verifier
 *    ciphertext. Records are encrypted field-wise so a browser profile dump does
 *    not leak lesion photography.
 *  - The sync queue is an append-only operation log. When Vercel/Supabase
 *    connectivity returns, the queue can be replayed to a server endpoint; while
 *    offline it simply accumulates and reports "pending" state in the UI.
 *  - Every function degrades gracefully when IndexedDB is unavailable (Safari
 *    private mode) by falling back to an in-memory adapter.
 * ------------------------------------------------------------------------- */

export const DB_NAME = 'derma-shield-vault';
export const DB_VERSION = 3;

export const STORES = Object.freeze({
  SCANS: 'scans',
  LESIONS: 'lesions',
  EXPOSURES: 'exposures',
  AUDITS: 'audits',
  SYNC: 'sync_queue',
  META: 'meta',
  SETTINGS: 'settings'
});

const PBKDF2_ITERATIONS = 210000;
const KEY_LENGTH = 256;

/* ------------------------------------------------------------- crypto helpers */

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function fromB64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Derive a 256-bit AES-GCM key from a 4–8 digit PIN + salt. */
export async function derivePinKey(pin, saltB64) {
  const salt = fromB64(saltB64);
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(String(pin)), 'PBKDF2', false, [
    'deriveKey'
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

/** Encrypt a JS value to a portable `{iv, ct}` envelope. */
export async function encryptJson(key, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(JSON.stringify(value))
  );
  return { iv: toB64(iv), ct: toB64(ct) };
}

/** Decrypt a `{iv, ct}` envelope back to a JS value. */
export async function decryptJson(key, envelope) {
  const iv = fromB64(envelope.iv);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, fromB64(envelope.ct));
  return JSON.parse(dec.decode(plain));
}

/** Random salt for a fresh vault. */
export function newSalt() {
  return toB64(crypto.getRandomValues(new Uint8Array(16)));
}

/* ------------------------------------------------------------------ adapter */

/**
 * Thin promise wrapper over IDB with an in-memory fallback. All methods are
 * intentionally low-level; higher layers work in terms of the domain stores.
 */
export function createVaultAdapter(name = DB_NAME) {
  const memory = new Map();
  let dbPromise = null;
  let memoryMode = false;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        memoryMode = true;
        resolve(null);
        return;
      }
      let req;
      try {
        req = indexedDB.open(name, DB_VERSION);
      } catch (err) {
        memoryMode = true;
        resolve(null);
        return;
      }
      req.onupgradeneeded = (event) => {
        const db = req.result;
        for (const store of Object.values(STORES)) {
          if (!db.objectStoreNames.contains(store)) {
            const os = db.createObjectStore(store, {
              keyPath: 'id',
              autoIncrement: store !== STORES.META && store !== STORES.SETTINGS
            });
            if (store === STORES.SCANS || store === STORES.LESIONS || store === STORES.EXPOSURES) {
              os.createIndex('createdAt', 'createdAt');
            }
            if (store === STORES.SYNC) os.createIndex('status', 'status');
          }
        }
        void event;
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        memoryMode = true;
        resolve(null);
      };
      req.onblocked = () => {
        memoryMode = true;
        resolve(null);
      };
      void reject;
    });
    return dbPromise;
  }

  async function tx(store, mode, fn) {
    const db = await open();
    if (!db) {
      memoryMode = true;
      return fn(null);
    }
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(store, mode);
      const os = transaction.objectStore(store);
      let result;
      try {
        result = fn(os);
      } catch (err) {
        reject(err);
        return;
      }
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('tx aborted'));
    });
  }

  function memList(store) {
    if (!memory.has(store)) memory.set(store, new Map());
    return memory.get(store);
  }

  return {
    get memoryMode() {
      return memoryMode;
    },
    async ready() {
      await open();
      return true;
    },
    async put(store, value) {
      const db = await open();
      const record = { ...value, updatedAt: Date.now() };
      if (!record.createdAt) record.createdAt = Date.now();
      // IndexedDB rejects a *present* key path whose value is undefined, so the
      // key has to be removed entirely for autoIncrement stores to mint one.
      if (record.id === undefined || record.id === null) delete record.id;
      if (!db) {
        const map = memList(store);
        const id = record.id ?? `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        record.id = id;
        map.set(id, record);
        return id;
      }
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(store, 'readwrite');
        const os = transaction.objectStore(store);
        const req = record.id != null ? os.put(record) : os.add(record);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },
    async get(store, id) {
      const db = await open();
      if (!db) return memList(store).get(id) ?? null;
      return new Promise((resolve, reject) => {
        const req = db.transaction(store, 'readonly').objectStore(store).get(id);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
      });
    },
    async delete(store, id) {
      const db = await open();
      if (!db) {
        memList(store).delete(id);
        return true;
      }
      return new Promise((resolve, reject) => {
        const req = db.transaction(store, 'readwrite').objectStore(store).delete(id);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    },
    async all(store, { limit = 500, descending = true } = {}) {
      const db = await open();
      if (!db) {
        return [...memList(store).values()]
          .sort((a, b) => (descending ? b.createdAt - a.createdAt : a.createdAt - b.createdAt))
          .slice(0, limit);
      }
      return new Promise((resolve, reject) => {
        const req = db.transaction(store, 'readonly').objectStore(store).getAll();
        req.onsuccess = () => {
          const rows = (req.result ?? []).sort((a, b) =>
            descending ? (b.createdAt ?? 0) - (a.createdAt ?? 0) : (a.createdAt ?? 0) - (b.createdAt ?? 0)
          );
          resolve(rows.slice(0, limit));
        };
        req.onerror = () => reject(req.error);
      });
    },
    async count(store) {
      const db = await open();
      if (!db) return memList(store).size;
      return new Promise((resolve, reject) => {
        const req = db.transaction(store, 'readonly').objectStore(store).count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },
    async clear(store) {
      const db = await open();
      if (!db) {
        memList(store).clear();
        return true;
      }
      return new Promise((resolve, reject) => {
        const req = db.transaction(store, 'readwrite').objectStore(store).clear();
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    },
    /** Export everything for the Admin telemetry CSV/JSON exporter. */
    async dump() {
      const out = {};
      for (const store of Object.values(STORES)) out[store] = await this.all(store, { limit: 5000 });
      return out;
    }
  };
}

/* --------------------------------------------------------------- vault facade */

/**
 * High-level vault: PIN gate, encrypted records and sync queue in one object.
 * Consumers (Svelte components) talk only to this facade.
 */
export function createVault() {
  const adapter = createVaultAdapter();
  const session = {
    unlocked: false,
    key: null,
    salt: null,
    failedAttempts: 0,
    lockedUntil: 0,
    storageMode: 'indexeddb'
  };

  async function ensureSalt() {
    const meta = await adapter.get(STORES.META, 'vault');
    if (meta?.salt) return meta;
    const salt = newSalt();
    await adapter.put(STORES.META, {
      id: 'vault',
      salt,
      createdAt: Date.now(),
      verifier: null,
      version: 1
    });
    return { id: 'vault', salt };
  }

  return {
    adapter,
    stores: STORES,
    session,

    async init() {
      await adapter.ready();
      session.storageMode = adapter.memoryMode ? 'memory' : 'indexeddb';
      const meta = await ensureSalt();
      session.salt = meta.salt;
      return { salt: meta.salt, storageMode: session.storageMode };
    },

    /** Create a brand-new PIN (first run or after reset). */
    async enroll(pin) {
      if (!/^\d{4,8}$/.test(String(pin))) throw new Error('PIN must be 4–8 digits');
      const meta = (await adapter.get(STORES.META, 'vault')) ?? { id: 'vault', salt: newSalt() };
      const key = await derivePinKey(pin, meta.salt);
      const verifier = await encryptJson(key, { ok: true, at: Date.now() });
      await adapter.put(STORES.META, { ...meta, salt: meta.salt, verifier, enrolledAt: Date.now() });
      session.key = key;
      session.salt = meta.salt;
      session.unlocked = true;
      return { ok: true };
    },

    /** Verify a PIN against the stored verifier. Rate limited in-session. */
    async unlock(pin) {
      const now = Date.now();
      if (session.lockedUntil > now) {
        throw new Error(`Locked — retry in ${Math.ceil((session.lockedUntil - now) / 1000)}s`);
      }
      const meta = await adapter.get(STORES.META, 'vault');
      if (!meta?.verifier) return this.enroll(pin);
      const key = await derivePinKey(pin, meta.salt);
      try {
        const check = await decryptJson(key, meta.verifier);
        if (!check?.ok) throw new Error('bad verifier');
      } catch {
        session.failedAttempts++;
        if (session.failedAttempts >= 3) {
          session.lockedUntil = now + Math.min(120000, 10000 * 2 ** (session.failedAttempts - 3));
        }
        throw new Error(
          `Incorrect PIN${session.failedAttempts >= 3 ? ' — temporarily locked' : ''}`
        );
      }
      session.key = key;
      session.salt = meta.salt;
      session.unlocked = true;
      session.failedAttempts = 0;
      session.lockedUntil = 0;
      return { ok: true };
    },

    lock() {
      session.unlocked = false;
      session.key = null;
      return { ok: true };
    },

    get isEnrolled() {
      return adapter.get(STORES.META, 'vault').then((m) => Boolean(m?.verifier));
    },

    /** Encrypt a record payload when unlocked; store plaintext-gated otherwise. */
    async securePut(store, record) {
      if (!session.unlocked || !session.key) {
        // Refuse rather than write plaintext clinical data: the UI always gates
        // this behind an unlocked vault, and a silent downgrade would be a
        // privacy bug, not a convenience.
        throw new Error('Vault is locked — unlock before writing records');
      }
      const envelope = await encryptJson(session.key, record);
      const row = {
        createdAt: record.createdAt ?? Date.now(),
        kind: record.kind ?? store,
        // IndexedDB indices need a non-secret primitive, so only a coarse
        // category and the timestamp are stored in the clear. The clinical
        // summary lives *inside* the encrypted envelope.
        category: record.kind ?? store,
        locked: !session.key,
        encrypted: true,
        payload: envelope
      };
      // Only carry an explicit key when the caller supplied one; otherwise let
      // the store's autoIncrement assign it.
      if (record.id !== undefined && record.id !== null) row.id = record.id;
      const id = await adapter.put(store, row);
      // The sync log also carries no clinical content — just the operation.
      await this.queueSync(store, 'upsert', id, null);
      return id;
    },

    async secureGet(store, id) {
      const row = await adapter.get(store, id);
      if (!row) return null;
      if (!row.encrypted) return row;
      if (!session.key) throw new Error('Vault locked');
      const payload = await decryptJson(session.key, row.payload);
      return { ...row, summary: payload.summary ?? null, ...payload, _decrypted: true };
    },

    async secureList(store, opts) {
      const rows = await adapter.all(store, opts);
      if (!session.key) return rows.map((r) => ({ ...r, locked: r.encrypted }));
      const out = [];
      for (const row of rows) {
        if (!row.encrypted) {
          out.push(row);
          continue;
        }
        try {
          const payload = await decryptJson(session.key, row.payload);
          out.push({ ...row, summary: payload.summary ?? null, ...payload, _decrypted: true });
        } catch {
          out.push({ ...row, decryptError: true });
        }
      }
      return out;
    },

    /* ------------------------------------------------------------ sync queue */

    async queueSync(store, action, recordId, summary = null) {
      return adapter.put(STORES.SYNC, {
        store,
        action,
        recordId,
        summary,
        status: 'pending',
        attempts: 0,
        createdAt: Date.now()
      });
    },

    async pendingSync() {
      const rows = await adapter.all(STORES.SYNC, { limit: 1000, descending: false });
      return rows.filter((r) => r.status === 'pending');
    },

    async markSynced(ids) {
      for (const id of ids) {
        const row = await adapter.get(STORES.SYNC, id);
        if (row) await adapter.put(STORES.SYNC, { ...row, status: 'synced', syncedAt: Date.now() });
      }
    },

    /**
     * Attempt a flush to the configured endpoint. Offline-first: any failure is
     * non-fatal and simply leaves rows pending (the UI shows "QUEUED").
     */
    async flushSync(endpoint) {
      const pending = await this.pendingSync();
      if (!pending.length) return { pushed: 0, pending: 0, online: true };
      if (!endpoint || typeof navigator === 'undefined' || !navigator.onLine) {
        return { pushed: 0, pending: pending.length, online: false };
      }
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ops: pending })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await this.markSynced(pending.map((p) => p.id));
        return { pushed: pending.length, pending: 0, online: true };
      } catch (err) {
        return { pushed: 0, pending: pending.length, online: false, error: String(err) };
      }
    },

    /* --------------------------------------------------------------- exports */

    async exportJson() {
      const dump = await adapter.dump();
      return {
        app: 'DERMA-SHIELD',
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        storageMode: session.storageMode,
        locked: !session.key,
        encrypted: true,
        records: dump
      };
    },

    /** Flatten scans + lesions + exposures into CSV rows for the Admin exporter. */
    async exportCsv() {
      // Exports need the decrypted payloads, so they require an unlocked vault.
      if (!session.key) throw new Error('Vault is locked — unlock to export telemetry');
      const scans = await this.secureList(STORES.SCANS, { limit: 5000, descending: false });
      const lesions = await this.secureList(STORES.LESIONS, { limit: 5000, descending: false });
      const exposures = await this.secureList(STORES.EXPOSURES, { limit: 5000, descending: false });
      const audits = await this.secureList(STORES.AUDITS, { limit: 5000, descending: false });
      const lines = [
        'record_type,timestamp,ita_deg,erythema_index,phototype,med_jm2,lesion_mm,border_index,asymmetry_pct,colors,uv_index,minutes_to_med,spf,score,summary'
      ];
      const q = (v) => (v == null ? '' : String(v).includes(',') ? `"${v}"` : String(v));
      for (const s of scans) {
        lines.push(
          [
            'scan',
            new Date(s.createdAt).toISOString(),
            s.ita ?? s.summary?.ita ?? '',
            s.erythemaIndex ?? s.summary?.erythemaIndex ?? '',
            s.phototype?.type ?? s.summary?.phototype ?? '',
            s.med ?? s.summary?.med ?? '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            q(s.summary?.label ?? s.kind ?? '')
          ].join(',')
        );
      }
      for (const l of lesions) {
        lines.push(
          [
            'lesion',
            new Date(l.createdAt).toISOString(),
            '',
            '',
            '',
            '',
            l.D?.maxMm ?? l.summary?.diameterMm ?? '',
            l.B?.index ?? '',
            l.A?.score ?? '',
            l.C?.colorsPresent ?? '',
            '',
            '',
            '',
            '',
            q(l.summary?.label ?? '')
          ].join(',')
        );
      }
      for (const e of exposures) {
        lines.push(
          [
            'exposure',
            new Date(e.createdAt).toISOString(),
            e.ita ?? '',
            '',
            '',
            e.med ?? '',
            '',
            '',
            '',
            '',
            e.uvIndex ?? e.summary?.uvIndex ?? '',
            e.minutesToMed ?? e.summary?.minutesToMed ?? '',
            e.spf ?? e.summary?.spf ?? '',
            '',
            q(e.summary?.label ?? '')
          ].join(',')
        );
      }
      for (const a of audits) {
        lines.push(
          [
            'audit',
            new Date(a.createdAt).toISOString(),
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            a.score ?? a.summary?.score ?? '',
            q(a.summary?.label ?? '')
          ].join(',')
        );
      }
      return lines.join('\n');
    },

    async clearAll() {
      for (const store of Object.values(STORES)) {
        if (store === STORES.META) continue;
        await adapter.clear(store);
      }
      return true;
    }
  };
}

/** Trigger a browser download of a text blob. */
export function downloadText(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
