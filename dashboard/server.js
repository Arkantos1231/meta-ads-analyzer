#!/usr/bin/env node
/**
 * Meta Ads Dashboard — proxy server
 *
 * Uses only Node.js 18+ built-ins (http, fs, path, url).
 * Reads credentials from ../.env.meta-ads.
 * Serves dashboard/public/ as static files on port 3000.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Load credentials
// ---------------------------------------------------------------------------
const ENV_FILE = path.resolve(__dirname, '.env.meta-ads');

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`\n❌  Credentials file not found: ${filePath}`);
    console.error('   Create the file manually in the dashboard/ folder.\n');
    process.exit(1);
  }
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    let key = trimmed.slice(0, idx).trim();
    if (key.startsWith('export ')) key = key.slice(7).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    env[key] = val;
  }
  return env;
}

const env = loadEnv(ENV_FILE);
const ACCESS_TOKEN = env.META_ACCESS_TOKEN;

if (!ACCESS_TOKEN) {
  console.error('❌  META_ACCESS_TOKEN is missing from .env.meta-ads');
  process.exit(1);
}

const OPENAI_API_KEY = env.OPENAI_API_KEY || null;
if (!OPENAI_API_KEY) console.warn('⚠️  OPENAI_API_KEY missing — AI recommendations disabled');

const GRAPH_BASE = 'https://graph.facebook.com/v21.0';

// ---------------------------------------------------------------------------
// Meta API helper
// ---------------------------------------------------------------------------
async function metaGet(path, params = {}) {
  const qs = new URLSearchParams({ access_token: ACCESS_TOKEN, ...params });
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

  // Top 5 ads by spend
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
        const adRev   = (Array.isArray(ad.action_values) ? ad.action_values.find(a => a.action_type === 'purchase') : null)?.value || '0';
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
// Route handlers
// ---------------------------------------------------------------------------
const routes = {
  '/api/accounts': async (_query) => {
    return metaGet('/me/adaccounts', {
      fields: 'name,account_id,account_status,currency',
      limit: 100,
    });
  },

  '/api/campaigns': async (query) => {
    const { account_id } = query;
    if (!account_id) throw Object.assign(new Error('account_id required'), { status: 400 });
    return metaGet(`/act_${account_id}/campaigns`, {
      fields: 'id,name,status,objective,daily_budget,lifetime_budget,effective_status',
      limit: 100,
    });
  },

  '/api/insights': async (query) => {
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
    });
  },

  '/api/adsets': async (query) => {
    const { account_id } = query;
    if (!account_id) throw Object.assign(new Error('account_id required'), { status: 400 });
    return metaGet(`/act_${account_id}/adsets`, {
      fields: 'name,status,effective_status,learning_stage_info,campaign_id,daily_budget,bid_strategy',
      limit: 200,
    });
  },

  '/api/ad-creatives': async (query) => {
    const { account_id } = query;
    if (!account_id) throw Object.assign(new Error('account_id required'), { status: 400 });
    return metaGet(`/act_${account_id}/ads`, {
      fields: 'id,name,creative{id,thumbnail_url,image_url}',
      limit: 500,
    });
  },

  '/api/ads': async (query) => {
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
    });
  },

  '/api/placements': async (query) => {
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
    });
  },
};

// ---------------------------------------------------------------------------
// Static file server
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const PUBLIC_DIR = path.join(__dirname, 'public');

function serveStatic(req, res) {
  let urlPath = new URL(req.url, 'http://x').pathname;
  if (urlPath === '/') urlPath = '/index.html';
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
  const pathname = parsedUrl.pathname;

  // CORS for local dev
  res.setHeader('Access-Control-Allow-Origin', '*');

  // POST: AI endpoints
  if (req.method === 'POST' && pathname === '/api/ai-report') {
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body);
      const result = await getAiReport(payload);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      const status = err.status || 500;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/ai-recommend') {
    try {
      const body = await readBody(req);
      const payload = JSON.parse(body);
      const result = await getAiRecommendations(payload);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      const status = err.status || 500;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // API routes
  if (pathname.startsWith('/api/')) {
    const handler = routes[pathname];
    if (!handler) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unknown endpoint' }));
      return;
    }
    const query = Object.fromEntries(parsedUrl.searchParams.entries());
    try {
      const data = await handler(query);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (err) {
      const status = err.status || 500;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message, detail: err.meta }));
    }
    return;
  }

  // Static files
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`\n✅  Meta Ads Dashboard running at http://localhost:${PORT}\n`);
});
