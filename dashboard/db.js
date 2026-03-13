/**
 * db.js — SQLite database module
 */

import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Encryption helpers (AES-256-GCM)
// ---------------------------------------------------------------------------
function getEncKey() {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-char hex string (32 bytes). Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }
  return Buffer.from(hex, 'hex');
}

export function encrypt(plaintext) {
  const key = getEncKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    enc: enc.toString('base64'),
    iv:  iv.toString('hex'),
    tag: tag.toString('hex'),
  };
}

export function decrypt(enc, iv, tag) {
  const key = getEncKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  const dec = Buffer.concat([decipher.update(Buffer.from(enc, 'base64')), decipher.final()]);
  return dec.toString('utf8');
}

// ---------------------------------------------------------------------------
// DB singleton
// ---------------------------------------------------------------------------
let _db = null;

export function getDb() {
  if (_db) return _db;

  const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'app.db');
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      username            TEXT    NOT NULL UNIQUE,
      email               TEXT    NOT NULL UNIQUE,
      password_hash       TEXT    NOT NULL,
      role                TEXT    NOT NULL DEFAULT 'user',
      meta_token_enc      TEXT    DEFAULT NULL,
      meta_token_iv       TEXT    DEFAULT NULL,
      meta_token_tag      TEXT    DEFAULT NULL,
      created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at          INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT    PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_datasources (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      datasource_id TEXT    NOT NULL,
      UNIQUE(user_id, datasource_id)
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user_id    ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires    ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_user_ds_user_id     ON user_datasources(user_id);
  `);

  // Migrate: add legacy columns if they don't exist yet
  const existingCols = db.prepare('PRAGMA table_info(users)').all().map(r => r.name);
  const newCols = [
    'meta_app_id_enc', 'meta_app_id_iv', 'meta_app_id_tag',
    'meta_app_secret_enc', 'meta_app_secret_iv', 'meta_app_secret_tag',
    'windsor_datasource_id',
  ];
  for (const col of newCols) {
    if (!existingCols.includes(col)) {
      db.exec(`ALTER TABLE users ADD COLUMN ${col} TEXT DEFAULT NULL`);
    }
  }

  // Migrate: copy existing windsor_datasource_id → user_datasources table
  db.exec(`
    INSERT OR IGNORE INTO user_datasources (user_id, datasource_id)
    SELECT id, windsor_datasource_id FROM users
    WHERE windsor_datasource_id IS NOT NULL AND windsor_datasource_id != ''
  `);

  // Purge expired sessions on startup
  db.prepare('DELETE FROM sessions WHERE expires_at < unixepoch()').run();

  _db = db;
  return db;
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export function getUserById(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export function getUserByUsername(username) {
  return getDb().prepare('SELECT * FROM users WHERE username = ?').get(username);
}

export function getAllUsers() {
  return getDb().prepare(`
    SELECT id, username, email, role, windsor_datasource_id, created_at
    FROM users ORDER BY id
  `).all();
}

// ---------------------------------------------------------------------------
// Multi-datasource management
// ---------------------------------------------------------------------------
export function getUserDatasources(userId) {
  return getDb().prepare(
    'SELECT datasource_id FROM user_datasources WHERE user_id = ? ORDER BY id'
  ).all(userId).map(r => r.datasource_id);
}

export function addUserDatasource(userId, datasourceId) {
  return getDb().prepare(
    'INSERT OR IGNORE INTO user_datasources (user_id, datasource_id) VALUES (?, ?)'
  ).run(userId, datasourceId);
}

export function removeUserDatasource(userId, datasourceId) {
  return getDb().prepare(
    'DELETE FROM user_datasources WHERE user_id = ? AND datasource_id = ?'
  ).run(userId, datasourceId);
}

export function setUserDatasources(userId, datasourceIds) {
  const db = getDb();
  db.prepare('DELETE FROM user_datasources WHERE user_id = ?').run(userId);
  const insert = db.prepare('INSERT INTO user_datasources (user_id, datasource_id) VALUES (?, ?)');
  for (const dsId of datasourceIds) insert.run(userId, dsId);
}

// Returns { userId: [datasourceId, ...] } for all users that have datasources
export function getAllUserDatasourcesMap() {
  const rows = getDb().prepare('SELECT user_id, datasource_id FROM user_datasources').all();
  const map = {};
  for (const r of rows) {
    if (!map[r.user_id]) map[r.user_id] = [];
    map[r.user_id].push(r.datasource_id);
  }
  return map;
}

// Legacy single-value helpers kept for migration compatibility
export function updateUserWindsorDatasource(userId, datasourceId) {
  addUserDatasource(userId, datasourceId);
  return getDb().prepare(
    'UPDATE users SET windsor_datasource_id = ?, updated_at = unixepoch() WHERE id = ?'
  ).run(datasourceId, userId);
}

export function clearUserWindsorDatasource(userId) {
  setUserDatasources(userId, []);
  return getDb().prepare(
    'UPDATE users SET windsor_datasource_id = NULL, updated_at = unixepoch() WHERE id = ?'
  ).run(userId);
}

export function createUser({ username, email, passwordHash, role = 'user' }) {
  return getDb().prepare(`
    INSERT INTO users (username, email, password_hash, role)
    VALUES (?, ?, ?, ?)
  `).run(username, email, passwordHash, role);
}

export function updateUserPassword(id, passwordHash) {
  return getDb().prepare(`
    UPDATE users SET password_hash = ?, updated_at = unixepoch() WHERE id = ?
  `).run(passwordHash, id);
}

export function updateUserMetaToken(id, enc, iv, tag) {
  return getDb().prepare(`
    UPDATE users SET meta_token_enc = ?, meta_token_iv = ?, meta_token_tag = ?,
                    updated_at = unixepoch()
    WHERE id = ?
  `).run(enc, iv, tag, id);
}

export function updateUserMetaAppId(id, enc, iv, tag) {
  return getDb().prepare(`
    UPDATE users SET meta_app_id_enc = ?, meta_app_id_iv = ?, meta_app_id_tag = ?,
                    updated_at = unixepoch()
    WHERE id = ?
  `).run(enc, iv, tag, id);
}

export function updateUserMetaAppSecret(id, enc, iv, tag) {
  return getDb().prepare(`
    UPDATE users SET meta_app_secret_enc = ?, meta_app_secret_iv = ?, meta_app_secret_tag = ?,
                    updated_at = unixepoch()
    WHERE id = ?
  `).run(enc, iv, tag, id);
}

// Clear a credential field (set to NULL)
export function clearUserMetaField(id, field) {
  const allowed = ['meta_token', 'meta_app_id', 'meta_app_secret'];
  if (!allowed.includes(field)) throw new Error('Invalid field');
  return getDb().prepare(`
    UPDATE users SET ${field}_enc = NULL, ${field}_iv = NULL, ${field}_tag = NULL,
                    updated_at = unixepoch()
    WHERE id = ?
  `).run(id);
}

export function deleteUser(id) {
  return getDb().prepare('DELETE FROM users WHERE id = ?').run(id);
}

// ---------------------------------------------------------------------------
// Sessions (30-day expiry)
// ---------------------------------------------------------------------------
export function createSession(userId) {
  const id = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
  getDb().prepare(`
    INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)
  `).run(id, userId, expiresAt);
  return id;
}

export function getSession(id) {
  return getDb().prepare(`
    SELECT * FROM sessions WHERE id = ? AND expires_at > unixepoch()
  `).get(id);
}

export function deleteSession(id) {
  return getDb().prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

export function deleteAllUserSessions(userId) {
  return getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}
