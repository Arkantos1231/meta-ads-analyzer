#!/usr/bin/env node
/**
 * Meta Ads Dashboard — proxy server (multi-tenant)
 *
 * Uses only Node.js 18+ built-ins + better-sqlite3 + bcryptjs.
 * Reads credentials from .env.meta-ads.
 * Serves dashboard/public/ as static files on port 3000.
 * Data source: windsor.ai (instead of Meta Graph API directly).
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
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
  updateUserWindsorDatasource,
  clearUserWindsorDatasource,
  deleteAllUserSessions,
  createSession,
  deleteSession,
} from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Load credentials
// Priority: process.env (Railway / any host) → .env.meta-ads file (local dev)
// ---------------------------------------------------------------------------
const ENV_FILE = path.resolve(__dirname, '.env.meta-ads');

if (fs.existsSync(ENV_FILE)) {
  const lines = fs.readFileSync(ENV_FILE, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    let key = trimmed.slice(0, idx).trim();
    if (key.startsWith('export ')) key = key.slice(7).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
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

const OPENAI_API_KEY  = process.env.OPENAI_API_KEY  || null;
const WINDSOR_API_KEY = process.env.WINDSOR_API_KEY || null;

if (!OPENAI_API_KEY)  console.warn('⚠️  OPENAI_API_KEY missing — AI recommendations disabled');
if (!WINDSOR_API_KEY) console.warn('⚠️  WINDSOR_API_KEY missing — data API disabled');
else                   console.log('✅  Windsor.ai enabled');

const WINDSOR_BASE = 'https://connectors.windsor.ai/facebook';

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

  return {
    id: user.id, username: user.username, email: user.email, role: user.role,
    windsorDatasourceId: user.windsor_datasource_id || null,
  };
}

function requireAdmin(req) {
  const user = requireAuth(req);
  if (user.role !== 'admin') throw Object.assign(new Error('Forbidden'), { status: 403 });
  return user;
}

function requireWindsorDatasource(user) {
  if (!WINDSOR_API_KEY) throw Object.assign(new Error('WINDSOR_API_KEY not configured on server'), { status: 500 });
  if (!user.windsorDatasourceId) throw Object.assign(new Error('No Windsor account configured — ask your admin to assign your account'), { status: 400 });
}

function sessionCookie(token) {
  return `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${30 * 24 * 60 * 60}`;
}

function clearSessionCookie() {
  return 'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0';
}

// ---------------------------------------------------------------------------
// Windsor API helper
// ---------------------------------------------------------------------------
async function windsorGet(datasourceId, fields, params = {}) {
  const qs = new URLSearchParams({
    api_key:    WINDSOR_API_KEY,
    datasource: datasourceId,
    fields:     fields.join(','),
    ...params,
  });
  const res  = await fetch(`${WINDSOR_BASE}?${qs}`);
  const json = await res.json();
  if (json.error) throw Object.assign(new Error(json.error), { status: 400 });
  return json.data || [];
}

function datePresetToParams(preset) {
  if (!preset || preset === 'maximum') {
    const today = new Date().toISOString().slice(0, 10);
    return { date_from: '2015-01-01', date_to: today };
  }
  return { date_preset: preset };
}

// Transform flat Windsor rows → Meta-format aggregated by key field
function aggregateRows(rows, keyField, extraFields) {
  const map = {};
  for (const row of rows) {
    const key = row[keyField];
    if (!key) continue;
    if (!map[key]) {
      map[key] = { ...extraFields(row), spend: 0, impressions: 0, clicks: 0, reach: 0, purchases: 0, purchase_value: 0, roas_numer: 0, roas_denom: 0 };
    }
    const m     = map[key];
    const spend = parseFloat(row.spend) || 0;
    m.spend          += spend;
    m.impressions    += parseInt(row.impressions)    || 0;
    m.clicks         += parseInt(row.clicks)         || 0;
    m.reach          += parseInt(row.reach)          || 0;
    m.purchases      += parseFloat(row.purchases)    || 0;
    m.purchase_value += parseFloat(row.purchase_value) || 0;
    const roas = parseFloat(row.purchase_roas) || parseFloat(row.roas) || 0;
    if (roas > 0) { m.roas_numer += roas * spend; m.roas_denom += spend; }
  }
  return Object.values(map);
}

function metaMetrics(m) {
  const imp  = m.impressions;
  const clk  = m.clicks;
  const cpm  = imp  > 0 ? (m.spend / imp)  * 1000 : 0;
  const cpc  = clk  > 0 ?  m.spend / clk          : 0;
  const ctr  = imp  > 0 ? (clk     / imp)  * 100   : 0;
  const roas = m.roas_denom > 0 ? m.roas_numer / m.roas_denom : null;
  return {
    spend:        m.spend.toFixed(2),
    impressions:  m.impressions.toString(),
    clicks:       m.clicks.toString(),
    reach:        m.reach.toString(),
    cpm:          cpm.toFixed(2),
    cpc:          cpc.toFixed(2),
    ctr:          ctr.toFixed(4),
    actions:      m.purchases > 0      ? [{ action_type: 'purchase', value: m.purchases.toFixed(0) }]      : [],
    action_values: m.purchase_value > 0 ? [{ action_type: 'purchase', value: m.purchase_value.toFixed(2) }] : [],
    purchase_roas: roas !== null        ? [{ value: roas.toFixed(4) }]                                       : [],
  };
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
        const adRoas  = Array.isArray(ad.purchase_roas) && ad.purchase_roas[0] ? parseFloat(ad.purchase_roas[0].value).toFixed(2) + 'x' : 'N/A';
        const adPurch = (Array.isArray(ad.actions) ? ad.actions.find(a => a.action_type === 'purchase') : null)?.value || '0';
        return `| ${ad.ad_name || 'Unknown'} | $${parseFloat(ad.spend || 0).toFixed(2)} | ${adRoas} | ${parseFloat(ad.ctr || 0).toFixed(2)}% | $${parseFloat(ad.cpm || 0).toFixed(2)} | ${adPurch} |`;
      }).join('\n')
    : 'No ad-level data available';

  const adsetsText = (adsets || []).map(as => `${as.name}: ${as.effective_status || as.status || 'N/A'}`).join('\n') || 'No ad set data';

  const userMessage =
`Campaign: ${campaignName} | Objective: ${campaignObjective || 'N/A'} | Status: ${campaignStatus || 'N/A'}

METRICS (${datePreset || 'selected period'}):
Spend: $${spend} | ROAS: ${roas} | Purchases: ${purchases} | Revenue: $${revenue}
CTR: ${ctr}% | CPM: $${cpm} | CPC: $${cpc} | Impressions: ${impressions} | Reach: ${reach}

TOP ADS (by spend):
${adsTable}

AD SETS:
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
    ? (adsets || []).map(as => `- ${as.name} | Status: ${as.effective_status || as.status || 'N/A'}`).join('\n')
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
## Ad Set Status
## Strategic Action Plan

For each metric section: (1) state the current value, (2) compare to typical Meta Ads benchmarks, (3) diagnose what it means for this campaign, (4) give 1–2 specific, actionable improvement steps.
In "Ad Creative Performance": identify top performers and underperformers from the ad data.
In "Ad Set Status": review each ad set's status and recommend actions.
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
// Windsor-backed API routes
// ---------------------------------------------------------------------------
const routes = {
  '/api/accounts': async (_query, user) => {
    requireWindsorDatasource(user);
    const today = new Date().toISOString().slice(0, 10);
    const rows  = await windsorGet(user.windsorDatasourceId,
      ['account_id', 'account_name'],
      { date_from: '2024-01-01', date_to: today }
    );
    const seen = new Set();
    const accounts = [];
    for (const row of rows) {
      if (row.account_id && !seen.has(row.account_id)) {
        seen.add(row.account_id);
        accounts.push({ account_id: row.account_id, name: row.account_name || row.account_id, account_status: 1 });
      }
    }
    return { data: accounts };
  },

  '/api/campaigns': async (query, user) => {
    requireWindsorDatasource(user);
    const { date_preset = 'last_30d' } = query;
    const rows = await windsorGet(user.windsorDatasourceId,
      ['campaign_id', 'campaign_name', 'campaign_status', 'objective'],
      datePresetToParams(date_preset)
    );
    const seen = new Set();
    const campaigns = [];
    for (const row of rows) {
      if (row.campaign_id && !seen.has(row.campaign_id)) {
        seen.add(row.campaign_id);
        campaigns.push({
          id:               row.campaign_id,
          name:             row.campaign_name || row.campaign_id,
          status:           (row.campaign_status || 'UNKNOWN').toUpperCase(),
          effective_status: (row.campaign_status || 'UNKNOWN').toUpperCase(),
          objective:        row.objective || '',
        });
      }
    }
    return { data: campaigns };
  },

  '/api/insights': async (query, user) => {
    requireWindsorDatasource(user);
    const { date_preset = 'last_30d' } = query;
    const rows = await windsorGet(user.windsorDatasourceId,
      ['campaign_name', 'campaign_id', 'spend', 'impressions', 'clicks', 'reach', 'purchases', 'purchase_value', 'purchase_roas'],
      datePresetToParams(date_preset)
    );
    const aggregated = aggregateRows(rows, 'campaign_name', r => ({ campaign_name: r.campaign_name, campaign_id: r.campaign_id }));
    const result = aggregated.map(m => ({ campaign_name: m.campaign_name, ...metaMetrics(m) }));
    return { data: result };
  },

  '/api/ads': async (query, user) => {
    requireWindsorDatasource(user);
    const { date_preset = 'last_30d' } = query;
    const rows = await windsorGet(user.windsorDatasourceId,
      ['ad_id', 'ad_name', 'adset_name', 'campaign_name', 'spend', 'impressions', 'clicks', 'reach', 'purchases', 'purchase_value', 'purchase_roas'],
      datePresetToParams(date_preset)
    );
    const aggregated = aggregateRows(rows, 'ad_id', r => ({ ad_id: r.ad_id, ad_name: r.ad_name, adset_name: r.adset_name, campaign_name: r.campaign_name }));
    const result = aggregated.map(m => ({ ad_id: m.ad_id, ad_name: m.ad_name, adset_name: m.adset_name, campaign_name: m.campaign_name, ...metaMetrics(m) }));
    return { data: result };
  },

  '/api/adsets': async (query, user) => {
    requireWindsorDatasource(user);
    const { date_preset = 'last_30d' } = query;
    const rows = await windsorGet(user.windsorDatasourceId,
      ['adset_id', 'adset_name', 'campaign_id', 'adset_status'],
      datePresetToParams(date_preset)
    );
    const seen = new Set();
    const adsets = [];
    for (const row of rows) {
      if (row.adset_id && !seen.has(row.adset_id)) {
        seen.add(row.adset_id);
        adsets.push({
          id:               row.adset_id,
          name:             row.adset_name || row.adset_id,
          campaign_id:      row.campaign_id,
          status:           (row.adset_status || 'UNKNOWN').toUpperCase(),
          effective_status: (row.adset_status || 'UNKNOWN').toUpperCase(),
        });
      }
    }
    return { data: adsets };
  },

  '/api/placements': async (query, user) => {
    requireWindsorDatasource(user);
    const { date_preset = 'last_30d' } = query;
    const rows = await windsorGet(user.windsorDatasourceId,
      ['publisher_platform', 'placement', 'spend', 'impressions', 'clicks', 'purchases', 'purchase_roas'],
      datePresetToParams(date_preset)
    );
    const map = {};
    for (const row of rows) {
      const key = `${row.publisher_platform}||${row.placement}`;
      if (!map[key]) {
        map[key] = { publisher_platform: row.publisher_platform, placement: row.placement, spend: 0, impressions: 0, clicks: 0, purchases: 0, roas_numer: 0, roas_denom: 0 };
      }
      const p     = map[key];
      const spend = parseFloat(row.spend) || 0;
      p.spend       += spend;
      p.impressions += parseInt(row.impressions) || 0;
      p.clicks      += parseInt(row.clicks)      || 0;
      p.purchases   += parseFloat(row.purchases) || 0;
      const roas = parseFloat(row.purchase_roas) || 0;
      if (roas > 0) { p.roas_numer += roas * spend; p.roas_denom += spend; }
    }
    const result = Object.values(map).map(p => {
      const imp  = p.impressions;
      const clk  = p.clicks;
      const cpm  = imp > 0 ? (p.spend / imp) * 1000 : 0;
      const cpc  = clk > 0 ?  p.spend / clk         : 0;
      const roas = p.roas_denom > 0 ? p.roas_numer / p.roas_denom : null;
      return {
        publisher_platform: p.publisher_platform,
        placement:          p.placement,
        spend:              p.spend.toFixed(2),
        impressions:        p.impressions.toString(),
        clicks:             p.clicks.toString(),
        cpm:                cpm.toFixed(2),
        cpc:                cpc.toFixed(2),
        actions:       p.purchases > 0 ? [{ action_type: 'purchase', value: p.purchases.toFixed(0) }] : [],
        purchase_roas: roas !== null    ? [{ value: roas.toFixed(4) }]                                 : [],
      };
    });
    return { data: result };
  },

  '/api/ad-creatives': async () => ({ data: [] }),
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
        username:             user.username,
        email:                user.email,
        role:                 user.role,
        hasWindsorDatasource: !!user.windsorDatasourceId,
        windsorDatasourceId:  user.windsorDatasourceId,
      });
    } catch (err) {
      sendJson(res, err.status || 401, { error: err.message });
    }
    return;
  }

  // ------------------------------------------------------------------
  // Settings endpoints
  // ------------------------------------------------------------------

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

  // PUT /admin/users/:id/windsor-datasource
  const windsorDsMatch = pathname.match(/^\/admin\/users\/(\d+)\/windsor-datasource$/);
  if (method === 'PUT' && windsorDsMatch) {
    try {
      requireAdmin(req);
      const targetId = parseInt(windsorDsMatch[1], 10);
      const body = await readBody(req);
      const { datasourceId } = JSON.parse(body);
      if (datasourceId) {
        updateUserWindsorDatasource(targetId, datasourceId);
      } else {
        clearUserWindsorDatasource(targetId);
      }
      sendJson(res, 200, { ok: true });
    } catch (err) {
      sendJson(res, err.status || 500, { error: err.message });
    }
    return;
  }

  // ------------------------------------------------------------------
  // Windsor admin endpoints
  // ------------------------------------------------------------------

  // GET /api/windsor/datasources — list all datasources connected to the Windsor account
  if (method === 'GET' && pathname === '/api/windsor/datasources') {
    try {
      requireAdmin(req);
      if (!WINDSOR_API_KEY) return sendJson(res, 400, { error: 'WINDSOR_API_KEY not configured' });

      const today = new Date().toISOString().slice(0, 10);
      const qs    = new URLSearchParams({
        api_key:   WINDSOR_API_KEY,
        fields:    'datasource,account_name',
        date_from: '2024-01-01',
        date_to:   today,
      });
      const resp = await fetch(`${WINDSOR_BASE}?${qs}`);
      const json = await resp.json();
      if (json.error) return sendJson(res, 400, { error: json.error });

      const seen        = new Set();
      const datasources = [];
      for (const row of (json.data || [])) {
        if (row.datasource && !seen.has(row.datasource)) {
          seen.add(row.datasource);
          datasources.push({ id: row.datasource, account_name: row.account_name || row.datasource });
        }
      }
      sendJson(res, 200, { datasources });
    } catch (err) {
      sendJson(res, err.status || 500, { error: err.message });
    }
    return;
  }

  // POST /api/windsor/generate-link — generate a co-user connection URL
  if (method === 'POST' && pathname === '/api/windsor/generate-link') {
    try {
      requireAdmin(req);
      if (!WINDSOR_API_KEY) return sendJson(res, 400, { error: 'WINDSOR_API_KEY not configured' });

      const url  = `https://onboard.windsor.ai/api/team/generate-co-user-url/?allowed_sources=facebook&api_key=${encodeURIComponent(WINDSOR_API_KEY)}`;
      const resp = await fetch(url);
      const json = await resp.json();
      if (json.error) return sendJson(res, 400, { error: json.error });

      const connectionUrl = json.url || json.connection_url || (typeof json === 'string' ? json : null);
      if (!connectionUrl) return sendJson(res, 500, { error: 'Unexpected response from Windsor', raw: json });
      sendJson(res, 200, { url: connectionUrl });
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
  // Windsor API routes (auth required, per-user datasource)
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
      sendJson(res, err.status || 500, { error: err.message });
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
