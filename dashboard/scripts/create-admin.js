#!/usr/bin/env node
/**
 * create-admin.js — seed the first admin user
 *
 * Usage:
 *   node scripts/create-admin.js --username admin --email you@company.com --password yourpassword
 *
 * Run from the dashboard/ directory.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { createUser, getUserByUsername } from '../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Load .env.meta-ads so DB_PATH and ENCRYPTION_KEY are available to db.js
// ---------------------------------------------------------------------------
const envFile = path.resolve(__dirname, '..', '.env.meta-ads');
if (fs.existsSync(envFile)) {
  const lines = fs.readFileSync(envFile, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    let key = trimmed.slice(0, idx).trim();
    if (key.startsWith('export ')) key = key.slice(7).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    process.env[key] = val;
  }
}

// ---------------------------------------------------------------------------
// Parse CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const get = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
};

const username = get('--username');
const email    = get('--email');
const password = get('--password');

if (!username || !email || !password) {
  console.error('Usage: node scripts/create-admin.js --username <u> --email <e> --password <p>');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Create user
// ---------------------------------------------------------------------------
const existing = getUserByUsername(username);
if (existing) {
  console.error(`❌  User "${username}" already exists.`);
  process.exit(1);
}

const passwordHash = await bcrypt.hash(password, 12);
createUser({ username, email, passwordHash, role: 'admin' });
console.log(`✅  Admin user "${username}" created successfully.`);
console.log(`    Login at http://localhost:3000`);
