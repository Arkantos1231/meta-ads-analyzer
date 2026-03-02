#!/usr/bin/env node
/**
 * Meta Ads Dashboard — proxy server (multi-tenant)
 *
 * Uses only Node.js 18+ built-ins + better-sqlite3 + bcryptjs.
 * Reads credentials from .env.meta-ads.
 * Serves dashboard/public/ as static files on port 3000.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import {
  getSession,
  getUserById,
  getUserByUsername,
  getAllUsers,
  createUser,
  deleteUser,
  updateUserPassword,
  updateUserMetaToken,
  updateUserMetaAppId,
  updateUserMetaAppSecret,
  clearUserMetaField,
  deleteAllUserSessions,
  createSession,
  deleteSession,
  encrypt,
  decrypt,
} from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Load credentials
// Priority: process.env (Railway / any host) → .env.meta-ads file (local dev)
// ---------------------------------------------------------------------------
const ENV_FILE = path.resolve(__dirname, '.env.meta-ads');

if (fs.existsSync(ENV_FILE)) {
  // Local dev: load file and set any missing env vars from it
  const lines = fs.readFileSync(ENV_FILE, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    let key = trimmed.slice(0, idx).trim();
    if (key.startsWith('export ')) key = key.slice(7).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    // Don't overwrite vars already set in the environment
    if (!process.env[key]) process.env[key] = val;
  }
  console.log('📄  Loaded .env.meta-ads');
} else {
  console.log('ℹ️   No .env.meta-ads file — using environment variables');
}

if (!process.env.ENCRYPTION_KEY) {
  console.error('❌  ENCRYPTION_KEY is not set.');
  console.error('   Railway: add it in the Variables tab.');
  console.error('   Local:   add it to dashboard/.env.meta-ads');
  console.error('   Generate: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || null;
if (!OPENAI_API_KEY) console.warn('⚠️  OPENAI_API_KEY missing — AI recommendations disabled');

const GRAPH_BASE = 'https://graph.facebook.com/v21.0';

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------
function requireAuth(req) {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/(?:^|;\s*)session=([^;]+)/);
  if (!match) throw Object.assign(new Error('Unauthorized'), { status: 401 });
  const session = getSession(match[1]);
  if (!session) throw Object.assign(new Error('Session expired'), { status: 401 });
  const user = getUserById(session.user_id);
  if (!user) throw Object.assign(new Error('Unauthorized'), { status: 401 });

  const metaToken    = user.meta_token_enc      ? decrypt(user.meta_token_enc,      user.meta_token_iv,      user.meta_token_tag)      : null;
  const metaAppId    = user.meta_app_id_enc     ? decrypt(user.meta_app_id_enc,     user.meta_app_id_iv,     user.meta_app_id_tag)     : null;
  const metaAppSecret= user.meta_app_secret_enc ? decrypt(user.meta_app_secret_enc, user.meta_app_secret_iv, user.meta_app_secret_tag) : null;

  return {
    id: user.id, username: user.username, email: user.email, role: user.role,
    metaToken, metaAppId, metaAppSecret,
    meta_token_enc: user.meta_token_enc,
    meta_app_id_enc: user.meta_app_id_enc,
    meta_app_secret_enc: user.meta_app_secret_enc,
  };
}

function requireAdmin(req) {
  const user = requireAuth(req);
  if (user.role !== 'admin') throw Object.assign(new Error('Forbidden'), { status: 403 });
  return user;
}

function sessionCookie(token) {
  return `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${30 * 24 * 60 * 60}`;
}

function clearSessionCookie() {
  return 'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0';
}

// ---------------------------------------------------------------------------
// Meta API helper
// ---------------------------------------------------------------------------
async function metaGet(path, params = {}, accessToken, appSecret = null) {
  const extra = {};
  if (appSecret) {
    // appsecret_proof adds server-side validation — Meta recommends it for server calls
    extra.appsecret_proof = crypto.createHmac('sha256', appSecret).update(accessToken).digest('hex');
  }
  const qs = new URLSearchParams({ access_token: accessToken, ...extra, ...params });
  const url = `${GRAPH_BASE}${path}?${qs}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) {
    const err = new Error(json.error.message);
    err.status = res.status;
    err.meta = json.error;
    throw err;
  }
  return json;
}

// ---------------------------------------------------------------------------
// POST body reader
// ---------------------------------------------------------------------------
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// JSON response helpers
// ---------------------------------------------------------------------------
function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

// ---------------------------------------------------------------------------
// AI recommendations via OpenAI
// ---------------------------------------------------------------------------
async function getAiRecommendations(payload) {
  if (!OPENAI_API_KEY) {
    return { error: 'AI not configured — add OPENAI_API_KEY to .env.meta-ads and restart the server' };
  }

  const { campaignName, campaignObjective, campaignStatus, campaignInsight, ads, adsets, datePreset } = payload;
  const ins = campaignInsight || {};

  const spend      = parseFloat(ins.spend || 0).toFixed(2);
  const roasRaw    = Array.isArray(ins.purchase_roas) && ins.purchase_roas[0] ? parseFloat(ins.purchase_roas[0].value).toFixed(2) : 'N/A';
  const roas       = roasRaw === 'N/A' ? 'N/A' : roasRaw + 'x';
  const purchases  = (Array.isArray(ins.actions)      ? ins.actions.find(a => a.action_type === 'purchase')       : null)?.value || '0';
  const revenue    = (Array.isArray(ins.action_values) ? ins.action_values.find(a => a.action_type === 'purchase') : null)?.value || '0';
  const ctr        = parseFloat(ins.ctr  || 0).toFixed(2);
  const cpm        = parseFloat(ins.cpm  || 0).toFixed(2);
  const cpc        = parseFloat(ins.cpc  || 0).toFixed(2);
  const impressions = parseInt(ins.impressions || 0).toLocaleString('en-US');
  const reach       = parseInt(ins.reach       || 0).toLocaleString('en-US');

  const topAds = [...(ads || [])].sort((a, b) => parseFloat(b.spend || 0) - parseFloat(a.spend || 0)).slice(0, 5);
  const adsTable = topAds.length > 0
    ? '| Ad | Spend | ROAS | CTR | CPM | Purchases |\n' +
      topAds.map(ad => {
        const adRoas = Array.isArray(ad.purchase_roas) && ad.purchase_roas[0]
          ? parseFloat(ad.purchase_roas[0].value).toFixed(2) + 'x' : 'N/A';
        const adPurch = (Array.isArray(ad.actions) ? ad.actions.find(a => a.action_type === 'purchase') : null)?.value || '0';
        return `| ${ad.ad_name || 'Unknown'} | $${parseFloat(ad.spend || 0).toFixed(2)} | ${adRoas} | ${parseFloat(ad.ctr || 0).toFixed(2)}% | $${parseFloat(ad.cpm || 0).toFixed(2)} | ${adPurch} |`;
      }).join('\n')
    : 'No ad-level data available';

  const adsetsText = (adsets || []).map(as => {
    const stage = as.learning_stage_info?.status || 'N/A';
    return `${as.name}: ${stage} — ${as.effective_status || as.status || 'N/A'}`;
  }).join('\n') || 'No ad set data';

  const userMessage =
`Campaign: ${campaignName} | Objective: ${campaignObjective || 'N/A'} | Status: ${campaignStatus || 'N/A'}

METRICS (${datePreset || 'selected period'}):
Spend: $${spend} | ROAS: ${roas} | Purchases: ${purchases} | Revenue: $${revenue}
CTR: ${ctr}% | CPM: $${cpm} | CPC: $${cpc} | Impressions: ${impressions} | Reach: ${reach}

TOP ADS (by spend):
${adsTable}

AD SETS — LEARNING STATUS:
${adsetsText}

Provide 3–5 specific recommendations.`;

  const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      max_tokens: 800,
      temperature: 0.4,
      messages: [
        {
          role: 'system',
          content: 'You are a Meta Ads performance analyst. Analyze the campaign data and give 3–5 specific, actionable recommendations to improve ROAS, reduce CPM, or fix underperforming ads. Be concise and direct. Format as a numbered list. Each item: one bold title line + 1–2 sentences of explanation.',
        },
        { role: 'user', content: userMessage },
      ],
    }),
  });

  const json = await openaiRes.json();
  if (json.error) {
    const err = new Error(json.error.message);
    err.status = openaiRes.status;
    throw err;
  }
  return { recommendations: json.choices[0].message.content };
}

// ---------------------------------------------------------------------------
// AI full report via OpenAI
// ---------------------------------------------------------------------------
async function getAiReport(payload) {
  if (!OPENAI_API_KEY) {
    return { error: 'AI not configured — add OPENAI_API_KEY to .env.meta-ads and restart the server' };
  }

  const { campaignName, campaignObjective, campaignStatus, campaignInsight, ads, adsets, datePreset } = payload;
  const ins = campaignInsight || {};

  const spend      = parseFloat(ins.spend || 0).toFixed(2);
  const roasRaw    = Array.isArray(ins.purchase_roas) && ins.purchase_roas[0] ? parseFloat(ins.purchase_roas[0].value).toFixed(2) : 'N/A';
  const roas       = roasRaw === 'N/A' ? 'N/A' : roasRaw + 'x';
  const purchases  = (Array.isArray(ins.actions)      ? ins.actions.find(a => a.action_type === 'purchase')       : null)?.value || '0';
  const revenue    = (Array.isArray(ins.action_values) ? ins.action_values.find(a => a.action_type === 'purchase') : null)?.value || '0';
  const ctr        = parseFloat(ins.ctr  || 0).toFixed(2);
  const cpm        = parseFloat(ins.cpm  || 0).toFixed(2);
  const cpc        = parseFloat(ins.cpc  || 0).toFixed(2);
  const impressions = parseInt(ins.impressions || 0).toLocaleString('en-US');
  const reach       = parseInt(ins.reach       || 0).toLocaleString('en-US');
  const frequency   = parseFloat(ins.frequency || 0).toFixed(2);
  const clicks      = parseInt(ins.clicks      || 0).toLocaleString('en-US');

  const allAds = [...(ads || [])].sort((a, b) => parseFloat(b.spend || 0) - parseFloat(a.spend || 0));
  const adsTable = allAds.length > 0
    ? '| Ad | Spend | ROAS | CTR | CPM | CPC | Purchases |\n|---|---|---|---|---|---|---|\n' +
      allAds.slice(0, 10).map(ad => {
        const adRoas  = Array.isArray(ad.purchase_roas) && ad.purchase_roas[0] ? parseFloat(ad.purchase_roas[0].value).toFixed(2) + 'x' : 'N/A';
        const adPurch = (Array.isArray(ad.actions) ? ad.actions.find(a => a.action_type === 'purchase') : null)?.value || '0';
        return `| ${ad.ad_name || 'Unknown'} | $${parseFloat(ad.spend || 0).toFixed(2)} | ${adRoas} | ${parseFloat(ad.ctr || 0).toFixed(2)}% | $${parseFloat(ad.cpm || 0).toFixed(2)} | $${parseFloat(ad.cpc || 0).toFixed(2)} | ${adPurch} |`;
      }).join('\n')
    : 'No ad-level data available';

  const adsetsTable = (adsets || []).length > 0
    ? (adsets || []).map(as => {
        const stage = as.learning_stage_info?.status || 'N/A';
        const days  = as.learning_stage_info?.attribution_window_size_unit || '';
        return `- ${as.name} | Status: ${as.effective_status || as.status || 'N/A'} | Learning: ${stage}${days ? ' (' + days + ')' : ''}`;
      }).join('\n')
    : 'No ad set data';

  const userMessage =
`Campaign: ${campaignName}
Objective: ${campaignObjective || 'N/A'} | Status: ${campaignStatus || 'N/A'} | Period: ${datePreset || 'selected period'}

CAMPAIGN METRICS:
- Spend: $${spend}
- ROAS: ${roas}
- Purchases: ${purchases} | Revenue: $${revenue}
- CTR: ${ctr}% | Clicks: ${clicks}
- CPM: $${cpm} | CPC: $${cpc}
- Impressions: ${impressions} | Reach: ${reach} | Frequency: ${frequency}

ADS (by spend):
${adsTable}

AD SETS:
${adsetsTable}`;

  const systemPrompt = `You are a senior Meta Ads performance analyst. Write a comprehensive campaign performance report in Markdown. Use exactly this structure:

## Executive Summary
## Metric-by-Metric Analysis
### Spend
### ROAS (Return on Ad Spend)
### CTR (Click-Through Rate)
### CPM (Cost Per Mille)
### CPC (Cost Per Click)
### Reach & Impressions
### Purchases & Revenue
## Ad Creative Performance
## Ad Set Learning Phase
## Strategic Action Plan

For each metric section: (1) state the current value, (2) compare to typical Meta Ads benchmarks, (3) diagnose what it means for this campaign, (4) give 1–2 specific, actionable improvement steps.
In "Ad Creative Performance": identify top performers and underperformers from the ad data, explain why each is working or not.
In "Ad Set Learning Phase": assess each ad set's learning status and what actions to take.
In "Strategic Action Plan": write 5–7 prioritized, numbered action items with clear expected impact.
Use the exact numbers from the data. Be direct and specific.`;

  const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      max_tokens: 2000,
      temperature: 0.3,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMessage  },
      ],
    }),
  });

  const json = await openaiRes.json();
  if (json.error) {
    const err = new Error(json.error.message);
    err.status = openaiRes.status;
    throw err;
  }
  return { report: json.choices[0].message.content };
}

// ---------------------------------------------------------------------------
// Route handlers (all receive user object with metaToken)
// ---------------------------------------------------------------------------
function requireMetaToken(user) {
  if (!user.metaToken) throw Object.assign(new Error('Meta Access Token no configurado — ve a Configuración → Credenciales Meta'), { status: 400 });
}

const routes = {
  '/api/accounts': async (_query, user) => {
    requireMetaToken(user);
    return metaGet('/me/adaccounts', {
      fields: 'name,account_id,account_status,currency',
      limit: 100,
    }, user.metaToken, user.metaAppSecret);
  },

  '/api/campaigns': async (query, user) => {
    requireMetaToken(user);
    const { account_id } = query;
    if (!account_id) throw Object.assign(new Error('account_id required'), { status: 400 });
    return metaGet(`/act_${account_id}/campaigns`, {
      fields: 'id,name,status,objective,daily_budget,lifetime_budget,effective_status',
      limit: 100,
    }, user.metaToken, user.metaAppSecret);
  },

  '/api/insights': async (query, user) => {
    requireMetaToken(user);
    const { account_id, date_preset = 'last_30d' } = query;
    if (!account_id) throw Object.assign(new Error('account_id required'), { status: 400 });
    return metaGet(`/act_${account_id}/insights`, {
      level: 'campaign',
      date_preset,
      fields: [
        'campaign_name',
        'spend',
        'impressions',
        'clicks',
        'cpm',
        'cpc',
        'ctr',
        'purchase_roas',
        'actions',
        'action_values',
        'reach',
        'frequency',
      ].join(','),
      limit: 100,
    }, user.metaToken, user.metaAppSecret);
  },

  '/api/adsets': async (query, user) => {
    requireMetaToken(user);
    const { account_id } = query;
    if (!account_id) throw Object.assign(new Error('account_id required'), { status: 400 });
    return metaGet(`/act_${account_id}/adsets`, {
      fields: 'name,status,effective_status,learning_stage_info,campaign_id,daily_budget,bid_strategy',
      limit: 200,
    }, user.metaToken, user.metaAppSecret);
  },

  '/api/ad-creatives': async (query, user) => {
    requireMetaToken(user);
    const { account_id } = query;
    if (!account_id) throw Object.assign(new Error('account_id required'), { status: 400 });
    return metaGet(`/act_${account_id}/ads`, {
      fields: 'id,name,creative{id,thumbnail_url,image_url}',
      limit: 500,
    }, user.metaToken, user.metaAppSecret);
  },

  '/api/ads': async (query, user) => {
    requireMetaToken(user);
    const { account_id, date_preset = 'last_30d' } = query;
    if (!account_id) throw Object.assign(new Error('account_id required'), { status: 400 });
    return metaGet(`/act_${account_id}/insights`, {
      level: 'ad',
      date_preset,
      fields: [
        'ad_id',
        'ad_name',
        'adset_name',
        'campaign_name',
        'spend',
        'impressions',
        'clicks',
        'cpm',
        'cpc',
        'ctr',
        'purchase_roas',
        'actions',
        'action_values',
        'reach',
        'frequency',
      ].join(','),
      limit: 500,
    }, user.metaToken, user.metaAppSecret);
  },

  '/api/placements': async (query, user) => {
    requireMetaToken(user);
    const { account_id, date_preset = 'last_30d' } = query;
    if (!account_id) throw Object.assign(new Error('account_id required'), { status: 400 });
    return metaGet(`/act_${account_id}/insights`, {
      level: 'adset',
      date_preset,
      breakdowns: 'publisher_platform,placement',
      fields: [
        'spend',
        'impressions',
        'clicks',
        'cpm',
        'cpc',
        'purchase_roas',
        'actions',
      ].join(','),
      limit: 200,
    }, user.metaToken, user.metaAppSecret);
  },
};

// ---------------------------------------------------------------------------
// Static file server
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
};

const PUBLIC_DIR = path.join(__dirname, 'public');

function serveStatic(req, res) {
  let urlPath = new URL(req.url, 'http://x').pathname;

  // Protect the root/index — redirect unauthenticated users to login
  if (urlPath === '/' || urlPath === '/index.html') {
    try {
      requireAuth(req);
    } catch {
      res.writeHead(302, { Location: '/login.html' });
      res.end();
      return;
    }
    urlPath = '/index.html';
  }

  const filePath = path.join(PUBLIC_DIR, urlPath);

  // Prevent path traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const pathname  = parsedUrl.pathname;
  const method    = req.method;

  // ------------------------------------------------------------------
  // Auth endpoints
  // ------------------------------------------------------------------

  // POST /auth/login
  if (method === 'POST' && pathname === '/auth/login') {
    try {
      const body = await readBody(req);
      const { username, password } = JSON.parse(body);
      if (!username || !password) return sendJson(res, 400, { error: 'username and password required' });

      const user = getUserByUsername(username);
      if (!user) return sendJson(res, 401, { error: 'Invalid username or password' });

      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) return sendJson(res, 401, { error: 'Invalid username or password' });

      const token = createSession(user.id);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Set-Cookie': sessionCookie(token),
      });
      res.end(JSON.stringify({ ok: true, username: user.username, role: user.role }));
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  // POST /auth/logout
  if (method === 'POST' && pathname === '/auth/logout') {
    const cookieHeader = req.headers.cookie || '';
    const match = cookieHeader.match(/(?:^|;\s*)session=([^;]+)/);
    if (match) deleteSession(match[1]);
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': clearSessionCookie(),
    });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // GET /auth/me
  if (method === 'GET' && pathname === '/auth/me') {
    try {
      const user = requireAuth(req);
      sendJson(res, 200, {
        username:     user.username,
        email:        user.email,
        role:         user.role,
        hasToken:     !!user.meta_token_enc,
        hasAppId:     !!user.meta_app_id_enc,
        hasAppSecret: !!user.meta_app_secret_enc,
      });
    } catch (err) {
      sendJson(res, err.status || 401, { error: err.message });
    }
    return;
  }

  // ------------------------------------------------------------------
  // Settings endpoints
  // ------------------------------------------------------------------

  // PUT /settings/meta-credentials  { token?, appId?, appSecret? }
  // Each field is independent: non-empty string = save; empty string = clear; absent = leave unchanged
  if (method === 'PUT' && pathname === '/settings/meta-credentials') {
    try {
      const user = requireAuth(req);
      const body = await readBody(req);
      const { token, appId, appSecret } = JSON.parse(body);

      if (token !== undefined) {
        if (token.trim()) {
          const r = encrypt(token.trim());
          updateUserMetaToken(user.id, r.enc, r.iv, r.tag);
        } else {
          clearUserMetaField(user.id, 'meta_token');
        }
      }
      if (appId !== undefined) {
        if (appId.trim()) {
          const r = encrypt(appId.trim());
          updateUserMetaAppId(user.id, r.enc, r.iv, r.tag);
        } else {
          clearUserMetaField(user.id, 'meta_app_id');
        }
      }
      if (appSecret !== undefined) {
        if (appSecret.trim()) {
          const r = encrypt(appSecret.trim());
          updateUserMetaAppSecret(user.id, r.enc, r.iv, r.tag);
        } else {
          clearUserMetaField(user.id, 'meta_app_secret');
        }
      }
      sendJson(res, 200, { ok: true });
    } catch (err) {
      sendJson(res, err.status || 500, { error: err.message });
    }
    return;
  }

  // GET /settings/meta-credentials-status
  if (method === 'GET' && pathname === '/settings/meta-credentials-status') {
    try {
      const user = requireAuth(req);
      sendJson(res, 200, {
        hasToken:     !!user.meta_token_enc,
        hasAppId:     !!user.meta_app_id_enc,
        hasAppSecret: !!user.meta_app_secret_enc,
      });
    } catch (err) {
      sendJson(res, err.status || 401, { error: err.message });
    }
    return;
  }

  // PUT /settings/password
  if (method === 'PUT' && pathname === '/settings/password') {
    try {
      const user = requireAuth(req);
      const body = await readBody(req);
      const { currentPassword, newPassword } = JSON.parse(body);
      if (!currentPassword || !newPassword) return sendJson(res, 400, { error: 'currentPassword and newPassword required' });
      if (newPassword.length < 8) return sendJson(res, 400, { error: 'New password must be at least 8 characters' });

      const dbUser = getUserById(user.id);
      const ok = await bcrypt.compare(currentPassword, dbUser.password_hash);
      if (!ok) return sendJson(res, 401, { error: 'Current password is incorrect' });

      const hash = await bcrypt.hash(newPassword, 12);
      updateUserPassword(user.id, hash);
      sendJson(res, 200, { ok: true });
    } catch (err) {
      sendJson(res, err.status || 500, { error: err.message });
    }
    return;
  }

  // ------------------------------------------------------------------
  // Admin endpoints
  // ------------------------------------------------------------------

  // GET /admin/users
  if (method === 'GET' && pathname === '/admin/users') {
    try {
      requireAdmin(req);
      sendJson(res, 200, { users: getAllUsers() });
    } catch (err) {
      sendJson(res, err.status || 500, { error: err.message });
    }
    return;
  }

  // POST /admin/users
  if (method === 'POST' && pathname === '/admin/users') {
    try {
      requireAdmin(req);
      const body = await readBody(req);
      const { username, email, password, role = 'user' } = JSON.parse(body);
      if (!username || !email || !password) return sendJson(res, 400, { error: 'username, email, and password are required' });
      if (password.length < 8) return sendJson(res, 400, { error: 'Password must be at least 8 characters' });
      if (!['admin', 'user'].includes(role)) return sendJson(res, 400, { error: 'role must be "admin" or "user"' });

      const passwordHash = await bcrypt.hash(password, 12);
      createUser({ username, email, passwordHash, role });
      sendJson(res, 201, { ok: true });
    } catch (err) {
      if (err.message && err.message.includes('UNIQUE')) {
        return sendJson(res, 409, { error: 'Username or email already exists' });
      }
      sendJson(res, err.status || 500, { error: err.message });
    }
    return;
  }

  // DELETE /admin/users/:id
  const deleteUserMatch = pathname.match(/^\/admin\/users\/(\d+)$/);
  if (method === 'DELETE' && deleteUserMatch) {
    try {
      const admin = requireAdmin(req);
      const targetId = parseInt(deleteUserMatch[1], 10);
      if (targetId === admin.id) return sendJson(res, 400, { error: 'Cannot delete your own account' });
      deleteUser(targetId);
      sendJson(res, 200, { ok: true });
    } catch (err) {
      sendJson(res, err.status || 500, { error: err.message });
    }
    return;
  }

  // PUT /admin/users/:id/password
  const resetPwdMatch = pathname.match(/^\/admin\/users\/(\d+)\/password$/);
  if (method === 'PUT' && resetPwdMatch) {
    try {
      requireAdmin(req);
      const targetId = parseInt(resetPwdMatch[1], 10);
      const body = await readBody(req);
      const { newPassword } = JSON.parse(body);
      if (!newPassword || newPassword.length < 8) return sendJson(res, 400, { error: 'newPassword must be at least 8 characters' });

      const hash = await bcrypt.hash(newPassword, 12);
      updateUserPassword(targetId, hash);
      deleteAllUserSessions(targetId);
      sendJson(res, 200, { ok: true });
    } catch (err) {
      sendJson(res, err.status || 500, { error: err.message });
    }
    return;
  }

  // ------------------------------------------------------------------
  // POST: AI endpoints (auth required)
  // ------------------------------------------------------------------
  if (method === 'POST' && pathname === '/api/ai-report') {
    try {
      requireAuth(req);
      const body = await readBody(req);
      const payload = JSON.parse(body);
      const result = await getAiReport(payload);
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, err.status || 500, { error: err.message });
    }
    return;
  }

  if (method === 'POST' && pathname === '/api/ai-recommend') {
    try {
      requireAuth(req);
      const body = await readBody(req);
      const payload = JSON.parse(body);
      const result = await getAiRecommendations(payload);
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, err.status || 500, { error: err.message });
    }
    return;
  }

  // ------------------------------------------------------------------
  // Meta API routes (auth required, per-user token)
  // ------------------------------------------------------------------
  if (pathname.startsWith('/api/')) {
    let user;
    try {
      user = requireAuth(req);
    } catch (err) {
      sendJson(res, err.status || 401, { error: err.message });
      return;
    }

    const handler = routes[pathname];
    if (!handler) {
      sendJson(res, 404, { error: 'Unknown endpoint' });
      return;
    }

    const query = Object.fromEntries(parsedUrl.searchParams.entries());
    try {
      const data = await handler(query, user);
      sendJson(res, 200, data);
    } catch (err) {
      sendJson(res, err.status || 500, { error: err.message, detail: err.meta });
    }
    return;
  }

  // ------------------------------------------------------------------
  // Static files
  // ------------------------------------------------------------------
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`\n✅  Meta Ads Dashboard running at http://localhost:${PORT}\n`);
});
