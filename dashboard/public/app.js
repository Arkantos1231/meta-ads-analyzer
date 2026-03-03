/**
 * Meta Ads Dashboard — frontend logic
 *
 * Pure vanilla JS (ES modules). No frameworks.
 * Communicates only with the local proxy server on port 3000.
 */

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const accountSelect  = document.getElementById('accountSelect');
const dateSelect     = document.getElementById('dateSelect');
const refreshBtn     = document.getElementById('refreshBtn');
const errorBanner    = document.getElementById('errorBanner');
const lastRefreshEl  = document.getElementById('lastRefresh');

// Summary card value els
const valSpend     = document.getElementById('val-spend');
const valRoas      = document.getElementById('val-roas');
const valPurchases = document.getElementById('val-purchases');
const valCpm       = document.getElementById('val-cpm');
const valCtr       = document.getElementById('val-ctr');
const subSpend     = document.getElementById('sub-spend');
const subRoas      = document.getElementById('sub-roas');
const subPurchases = document.getElementById('sub-purchases');
const subCpm       = document.getElementById('sub-cpm');
const subCtr       = document.getElementById('sub-ctr');

// Table bodies
const campaignBody   = document.getElementById('campaignBody');
const adBody         = document.getElementById('adBody');
const adsetBody      = document.getElementById('adsetBody');
const placementBody  = document.getElementById('placementBody');

// Badges
const campaignCount  = document.getElementById('campaignCount');
const adCount        = document.getElementById('adCount');
const adsetCount     = document.getElementById('adsetCount');
const placementCount = document.getElementById('placementCount');

// Filter tags
const adFilterTag    = document.getElementById('adFilterTag');
const adsetFilterTag = document.getElementById('adsetFilterTag');
const themeBtn       = document.getElementById('themeBtn');

// Header user area
const headerUsername = document.getElementById('headerUsername');
const settingsBtn    = document.getElementById('settingsBtn');
const logoutBtn      = document.getElementById('logoutBtn');

// ---------------------------------------------------------------------------
// Theme toggle
// ---------------------------------------------------------------------------
function applyTheme(theme) {
  if (theme === 'light') {
    document.documentElement.classList.add('light');
    themeBtn.textContent = '🌙';
    themeBtn.title = 'Switch to dark theme';
  } else {
    document.documentElement.classList.remove('light');
    themeBtn.textContent = '☀';
    themeBtn.title = 'Switch to light theme';
  }
}

const savedTheme = localStorage.getItem('dashboard-theme') || 'dark';
applyTheme(savedTheme);

themeBtn.addEventListener('click', () => {
  const next = document.documentElement.classList.contains('light') ? 'dark' : 'light';
  localStorage.setItem('dashboard-theme', next);
  applyTheme(next);
});

// ---------------------------------------------------------------------------
// Module-level data state (for click-to-filter + AI)
// ---------------------------------------------------------------------------
let allAdRows      = [];
let allAdsetRows   = [];
let allCreativeMap = {};
let allInsightRows  = {};   // keyed by campaign_name
let allCampaignRows = [];   // full campaign objects (for objective/status)
let selectedCampaign = null;  // campaign name currently selected

// AI section DOM refs
const aiSection       = document.getElementById('aiSection');
const aiBody          = document.getElementById('aiBody');
const aiCampaignLabel = document.getElementById('aiCampaignLabel');
const btnAiRecommend  = document.getElementById('btnAiRecommend');
const btnAiReport     = document.getElementById('btnAiReport');

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------
async function apiFetch(path, options = {}) {
  const res = await fetch(path, { credentials: 'include', ...options });
  const json = await res.json();
  if (res.status === 401) {
    window.location.href = '/login.html';
    throw new Error('Session expired');
  }
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

function showError(msg) {
  errorBanner.textContent = `Error: ${msg}`;
  errorBanner.classList.remove('hidden');
}

function clearError() {
  errorBanner.textContent = '';
  errorBanner.classList.add('hidden');
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------
function fmtCurrency(val, decimals = 0) {
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtNumber(val, decimals = 0) {
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtPct(val) {
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  return n.toFixed(2) + '%';
}

function fmtRoas(val) {
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  return n.toFixed(2) + 'x';
}

// Extract a specific action value from the actions array
function getAction(actions, type) {
  if (!Array.isArray(actions)) return null;
  const found = actions.find(a => a.action_type === type);
  return found ? parseFloat(found.value) : null;
}

function extractRoas(purchase_roas) {
  if (Array.isArray(purchase_roas) && purchase_roas.length > 0) {
    return parseFloat(purchase_roas[0].value);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Status badge HTML
// ---------------------------------------------------------------------------
function statusBadge(status = '') {
  const s = status.toLowerCase();
  if (s === 'active')              return `<span class="badge badge-active">Active</span>`;
  if (s === 'paused')              return `<span class="badge badge-paused">Paused</span>`;
  if (s === 'learning')            return `<span class="badge badge-learning">Learning</span>`;
  if (s === 'learning_limited')    return `<span class="badge badge-limited">Learning Limited</span>`;
  if (s === 'deleted' || s === 'archived') return `<span class="badge badge-paused">${status}</span>`;
  return `<span class="badge badge-unknown">${status || '—'}</span>`;
}

function learnBadge(stageInfo) {
  if (!stageInfo) return `<span class="badge badge-success">Out of Learning</span>`;
  const status = (stageInfo.status || '').toLowerCase();
  if (status === 'learning')         return `<span class="badge badge-learning">Learning</span>`;
  if (status === 'learning_limited') return `<span class="badge badge-limited">Learning Limited</span>`;
  if (status === 'success')          return `<span class="badge badge-success">Graduated</span>`;
  return `<span class="badge badge-unknown">${stageInfo.status || '—'}</span>`;
}

// ---------------------------------------------------------------------------
// Loading placeholder rows
// ---------------------------------------------------------------------------
function loadingRow(cols) {
  return `<tr class="loading-row"><td colspan="${cols}"><span class="spinner"></span> Loading…</td></tr>`;
}

// ---------------------------------------------------------------------------
// Render: Summary Cards
// ---------------------------------------------------------------------------
function renderSummary(insightRows) {
  let totalSpend = 0, totalImpressions = 0, totalClicks = 0;
  let totalCpmNumer = 0, totalPurchases = 0, totalRoasNumer = 0, roasRowCount = 0;

  for (const row of insightRows) {
    const spend       = parseFloat(row.spend) || 0;
    const impressions = parseFloat(row.impressions) || 0;
    const clicks      = parseFloat(row.clicks) || 0;
    const cpm         = parseFloat(row.cpm) || 0;
    const purchases   = getAction(row.actions, 'purchase') || 0;
    const roas        = extractRoas(row.purchase_roas);

    totalSpend       += spend;
    totalImpressions += impressions;
    totalClicks      += clicks;
    totalCpmNumer    += cpm * impressions;
    totalPurchases   += purchases;
    if (roas !== null) { totalRoasNumer += roas * spend; roasRowCount += spend; }
  }

  const avgCpm  = totalImpressions > 0 ? totalCpmNumer / totalImpressions : null;
  const avgRoas = roasRowCount > 0 ? totalRoasNumer / roasRowCount : null;
  const avgCtr  = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : null;

  valSpend.textContent     = fmtCurrency(totalSpend, 2);
  valRoas.textContent      = avgRoas !== null ? fmtRoas(avgRoas) : '—';
  valPurchases.textContent = fmtNumber(totalPurchases);
  valCpm.textContent       = avgCpm !== null ? fmtCurrency(avgCpm, 2) : '—';
  valCtr.textContent       = avgCtr !== null ? fmtPct(avgCtr) : '—';

  subSpend.textContent     = `${fmtNumber(totalImpressions)} impressions`;
  subRoas.textContent      = `Weighted by spend`;
  subPurchases.textContent = `${fmtNumber(totalClicks)} clicks`;
  subCpm.textContent       = `Weighted avg CPM`;
  subCtr.textContent       = `${fmtNumber(totalClicks)} clicks`;
}

function resetSummary() {
  for (const el of [valSpend, valRoas, valPurchases, valCpm, valCtr]) el.textContent = '—';
  for (const el of [subSpend, subRoas, subPurchases, subCpm, subCtr]) el.textContent = '';
}

// ---------------------------------------------------------------------------
// Render: Campaign Table
// ---------------------------------------------------------------------------
function escapeAttr(str) {
  return (str || '').replace(/"/g, '&quot;');
}

function renderCampaigns(campaignRows, insightRows) {
  const insightMap = {};
  for (const row of (insightRows || [])) {
    insightMap[row.campaign_name] = row;
  }

  if (!campaignRows || campaignRows.length === 0) {
    campaignBody.innerHTML = `<tr><td colspan="10" class="empty-row">No campaigns found.</td></tr>`;
    campaignCount.textContent = '0';
    return;
  }

  const sorted = [...campaignRows].sort((a, b) => {
    const aSpend = parseFloat(insightMap[a.name]?.spend) || 0;
    const bSpend = parseFloat(insightMap[b.name]?.spend) || 0;
    if (bSpend !== aSpend) return bSpend - aSpend;
    return (a.name || '').localeCompare(b.name || '');
  });

  campaignBody.innerHTML = sorted.map(campaign => {
    const ins       = insightMap[campaign.name];
    const status    = campaign.effective_status || campaign.status || '';
    const objective = (campaign.objective || '').replace(/_/g, ' ');
    const purchases = ins ? getAction(ins.actions, 'purchase') : null;
    const roas      = ins ? extractRoas(ins.purchase_roas) : null;
    const isSelected = selectedCampaign === campaign.name;

    return `<tr class="campaign-row${isSelected ? ' row-selected' : ''}" data-campaign="${escapeAttr(campaign.name)}" data-campaign-id="${escapeAttr(campaign.id)}" title="Click to filter Ads and Ad Sets">
      <td title="${escapeAttr(campaign.name)}">${truncate(campaign.name, 40)}</td>
      <td>${statusBadge(status)}</td>
      <td style="color:var(--text-muted);font-size:0.78rem">${objective || '—'}</td>
      <td class="num">${ins ? fmtCurrency(ins.spend, 2) : '—'}</td>
      <td class="num">${ins ? fmtNumber(ins.impressions) : '—'}</td>
      <td class="num">${ins ? fmtNumber(ins.clicks) : '—'}</td>
      <td class="num">${ins ? fmtPct(ins.ctr) : '—'}</td>
      <td class="num">${ins ? fmtCurrency(ins.cpm, 2) : '—'}</td>
      <td class="num">${roas !== null ? fmtRoas(roas) : '—'}</td>
      <td class="num">${purchases !== null ? fmtNumber(purchases) : '—'}</td>
    </tr>`;
  }).join('');

  campaignCount.textContent = sorted.length;

  campaignBody.querySelectorAll('.campaign-row').forEach(row => {
    row.addEventListener('click', () => onCampaignClick(row.dataset.campaign, row.dataset.campaignId));
  });
}

// ---------------------------------------------------------------------------
// Campaign click → filter Ads & Ad Sets
// ---------------------------------------------------------------------------
function onCampaignClick(campaignName, campaignId) {
  if (selectedCampaign === campaignName) {
    selectedCampaign = null;
    campaignBody.querySelectorAll('.campaign-row').forEach(r => r.classList.remove('row-selected'));
    setFilterTag(adFilterTag, null);
    setFilterTag(adsetFilterTag, null);
    renderAds(allAdRows, allCreativeMap);
    renderAdsets(allAdsetRows);
    aiBody.innerHTML = '<p class="ai-placeholder">Select a campaign, then click a button above.</p>';
    aiCampaignLabel.textContent = '';
    btnAiRecommend.disabled = true;
    btnAiReport.disabled    = true;
  } else {
    selectedCampaign = campaignName;
    campaignBody.querySelectorAll('.campaign-row').forEach(r => {
      r.classList.toggle('row-selected', r.dataset.campaign === campaignName);
    });
    const label = truncate(campaignName, 40);
    setFilterTag(adFilterTag, label);
    setFilterTag(adsetFilterTag, label);
    const filteredAds    = allAdRows.filter(r => r.campaign_name === campaignName);
    const filteredAdsets = allAdsetRows.filter(r => r.campaign_id === campaignId);
    renderAds(filteredAds, allCreativeMap);
    renderAdsets(filteredAdsets);
    aiCampaignLabel.textContent = truncate(campaignName, 50);
    aiBody.innerHTML = '<p class="ai-placeholder">Campaign selected — use a button above to generate AI analysis.</p>';
    btnAiRecommend.disabled = false;
    btnAiReport.disabled    = false;
    btnAiRecommend.dataset.campaignName = campaignName;
    btnAiRecommend.dataset.campaignId   = campaignId;
    btnAiReport.dataset.campaignName    = campaignName;
    btnAiReport.dataset.campaignId      = campaignId;
  }
}

// ---------------------------------------------------------------------------
// AI Recommendations
// ---------------------------------------------------------------------------
function renderMarkdown(text) {
  const safe = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const withBold = safe.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  const chunks = withBold.split(/\n(?=\d+\.\s)/);

  if (chunks.length > 1) {
    return chunks
      .map(chunk => {
        const trimmed = chunk.trim();
        if (!trimmed) return '';
        return `<div class="ai-rec-item">${trimmed.replace(/\n/g, '<br>')}</div>`;
      })
      .filter(Boolean)
      .join('');
  }

  return `<div class="ai-rec-text">${withBold.replace(/\n/g, '<br>')}</div>`;
}

function buildAiPayload(campaignName, campaignId) {
  const campaignInsight = allInsightRows[campaignName] || null;
  const campaignData    = allCampaignRows.find(c => c.id === campaignId) || {};
  const filteredAds     = allAdRows.filter(r => r.campaign_name === campaignName);
  const filteredAdsets  = allAdsetRows.filter(r => r.campaign_id === campaignId);
  return {
    campaignName,
    campaignObjective: (campaignData.objective || '').replace(/_/g, ' '),
    campaignStatus:    campaignData.effective_status || campaignData.status || '',
    campaignInsight,
    ads:       filteredAds,
    adsets:    filteredAdsets,
    datePreset: dateSelect.value,
  };
}

async function fetchAiRecommendations(campaignName, campaignId) {
  aiBody.innerHTML = `<div class="ai-loading">
    <div class="ai-dots"><span></span><span></span><span></span></div>
    Analyzing campaign performance…
  </div>`;
  btnAiRecommend.disabled = true;
  btnAiReport.disabled    = true;

  try {
    const json = await apiFetch('/api/ai-recommend', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(buildAiPayload(campaignName, campaignId)),
    });
    aiBody.innerHTML = json.error
      ? `<div class="ai-error">⚠ ${json.error}</div>`
      : renderMarkdown(json.recommendations);
  } catch (err) {
    aiBody.innerHTML = `<div class="ai-error">⚠ ${err.message}</div>`;
  } finally {
    btnAiRecommend.disabled = false;
    btnAiReport.disabled    = false;
  }
}

async function generatePdfReport(campaignName, campaignId) {
  const origLabel = btnAiReport.textContent;
  btnAiReport.textContent  = '⏳ Generating report…';
  btnAiReport.disabled     = true;
  btnAiRecommend.disabled  = true;

  try {
    const json = await apiFetch('/api/ai-report', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(buildAiPayload(campaignName, campaignId)),
    });
    if (json.error) {
      aiBody.innerHTML = `<div class="ai-error">⚠ Report error: ${json.error}</div>`;
      return;
    }
    openReportWindow(campaignName, json.report, dateSelect.value);
  } catch (err) {
    aiBody.innerHTML = `<div class="ai-error">⚠ ${err.message}</div>`;
  } finally {
    btnAiReport.textContent  = origLabel;
    btnAiReport.disabled     = false;
    btnAiRecommend.disabled  = false;
  }
}

// ---------------------------------------------------------------------------
// PDF report window
// ---------------------------------------------------------------------------
function reportMarkdownToHtml(md) {
  const lines = md.split('\n');
  const out   = [];
  let inUl = false, inOl = false;

  function closeLists() {
    if (inUl) { out.push('</ul>'); inUl = false; }
    if (inOl) { out.push('</ol>'); inOl = false; }
  }

  function esc(s) {
    return s
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  }

  for (const raw of lines) {
    const line = esc(raw);
    if (/^## /.test(line)) {
      closeLists(); out.push(`<h2>${line.slice(3)}</h2>`);
    } else if (/^### /.test(line)) {
      closeLists(); out.push(`<h3>${line.slice(4)}</h3>`);
    } else if (/^- /.test(raw)) {
      if (inOl) { out.push('</ol>'); inOl = false; }
      if (!inUl) { out.push('<ul>'); inUl = true; }
      out.push(`<li>${esc(raw.slice(2))}</li>`);
    } else if (/^\d+\. /.test(raw)) {
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (!inOl) { out.push('<ol>'); inOl = true; }
      out.push(`<li>${esc(raw.replace(/^\d+\.\s/, ''))}</li>`);
    } else if (line.trim() === '') {
      closeLists(); out.push('');
    } else {
      closeLists(); out.push(`<p>${line}</p>`);
    }
  }
  closeLists();
  return out.join('\n');
}

function openReportWindow(campaignName, markdown, datePreset) {
  const bodyHtml = reportMarkdownToHtml(markdown);
  const now      = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const period   = datePreset.replace(/_/g, ' ');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Report — ${campaignName}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px; line-height: 1.65; color: #1f2937;
      padding: 2.5rem 3rem; max-width: 860px; margin: 0 auto;
    }
    .rpt-header {
      display: flex; justify-content: space-between; align-items: flex-start;
      border-bottom: 3px solid #4f7cf7; padding-bottom: 1rem; margin-bottom: 2rem;
    }
    .rpt-title { font-size: 1.35rem; font-weight: 700; color: #111827; }
    .rpt-campaign { font-size: 0.88rem; color: #4f7cf7; font-weight: 600; margin-top: 0.2rem; }
    .rpt-meta { font-size: 0.78rem; color: #6b7280; text-align: right; line-height: 1.8; }
    .print-btn {
      display: inline-block; margin-bottom: 1.5rem;
      padding: 0.45rem 1rem; background: #4f7cf7; color: #fff;
      border: none; border-radius: 6px; cursor: pointer; font-size: 0.82rem; font-weight: 600;
    }
    @media print { .print-btn { display: none; } }
    h2 {
      font-size: 1rem; font-weight: 700; color: #4f7cf7;
      margin: 2rem 0 0.5rem; padding-bottom: 0.3rem;
      border-bottom: 1px solid #e5e7eb;
      page-break-after: avoid;
    }
    h3 {
      font-size: 0.9rem; font-weight: 700; color: #374151;
      margin: 1.3rem 0 0.35rem; page-break-after: avoid;
    }
    p { margin-bottom: 0.55rem; }
    ul, ol { margin: 0.35rem 0 0.7rem 1.3rem; }
    li { margin-bottom: 0.28rem; }
    strong { color: #111827; }
    .rpt-footer {
      margin-top: 3rem; padding-top: 0.9rem;
      border-top: 1px solid #e5e7eb;
      font-size: 0.73rem; color: #9ca3af; text-align: center;
    }
    @media print {
      body { padding: 1cm 1.5cm; }
      h2 { page-break-before: auto; }
      p, li { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">🖨 Print / Save as PDF</button>
  <div class="rpt-header">
    <div>
      <div class="rpt-title">Campaign Performance Report</div>
      <div class="rpt-campaign">${campaignName}</div>
    </div>
    <div class="rpt-meta">
      Period: ${period}<br>
      Generated: ${now}<br>
      Meta Ads Dashboard
    </div>
  </div>
  ${bodyHtml}
  <div class="rpt-footer">Generated by Meta Ads Dashboard · Powered by AI · ${now}</div>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) {
    alert('Pop-up blocked. Please allow pop-ups for this page and try again.');
    return;
  }
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 800);
}

function setFilterTag(el, label) {
  if (!label) {
    el.classList.add('hidden');
    el.innerHTML = '';
  } else {
    el.classList.remove('hidden');
    el.innerHTML = `Filtered: ${label} <span class="clear-filter" title="Clear filter">✕</span>`;
    el.querySelector('.clear-filter').addEventListener('click', (e) => {
      e.stopPropagation();
      onCampaignClick(selectedCampaign, null);
    });
  }
}

// ---------------------------------------------------------------------------
// Render: Ads Table
// ---------------------------------------------------------------------------
function buildCreativeMap(creativeRows) {
  const map = {};
  for (const ad of creativeRows) {
    const thumb = ad.creative?.thumbnail_url || ad.creative?.image_url || null;
    if (thumb) map[ad.id] = thumb;
  }
  return map;
}

function renderAds(adRows, creativeMap = {}) {
  if (!adRows || adRows.length === 0) {
    adBody.innerHTML = `<tr><td colspan="14" class="empty-row">No ad data for selected period.</td></tr>`;
    adCount.textContent = '0';
    return;
  }

  const sorted = [...adRows].sort((a, b) => parseFloat(b.spend) - parseFloat(a.spend));

  adBody.innerHTML = sorted.map(row => {
    const purchases  = getAction(row.actions, 'purchase');
    const revenue    = getAction(row.action_values, 'purchase');
    const roas       = extractRoas(row.purchase_roas);
    const thumbUrl   = creativeMap[row.ad_id];
    const thumbHtml  = thumbUrl
      ? `<img class="ad-thumb" src="${thumbUrl}" alt="${row.ad_name}" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'ad-thumb-placeholder',textContent:'🖼'}))">`
      : `<div class="ad-thumb-placeholder">🖼</div>`;

    return `<tr>
      <td>${thumbHtml}</td>
      <td title="${row.ad_name}">${truncate(row.ad_name, 35)}</td>
      <td title="${row.adset_name}" style="color:var(--text-muted);font-size:0.78rem">${truncate(row.adset_name, 30)}</td>
      <td title="${row.campaign_name}" style="color:var(--text-muted);font-size:0.78rem">${truncate(row.campaign_name, 30)}</td>
      <td class="num">${fmtCurrency(row.spend, 2)}</td>
      <td class="num">${fmtNumber(row.impressions)}</td>
      <td class="num">${fmtNumber(row.reach)}</td>
      <td class="num">${fmtNumber(row.clicks)}</td>
      <td class="num">${fmtPct(row.ctr)}</td>
      <td class="num">${fmtCurrency(row.cpm, 2)}</td>
      <td class="num">${fmtCurrency(row.cpc, 2)}</td>
      <td class="num">${roas !== null ? fmtRoas(roas) : '—'}</td>
      <td class="num">${purchases !== null ? fmtNumber(purchases) : '—'}</td>
      <td class="num">${revenue !== null ? fmtCurrency(revenue, 2) : '—'}</td>
    </tr>`;
  }).join('');

  adCount.textContent = sorted.length;
}

// ---------------------------------------------------------------------------
// Render: Learning Phase
// ---------------------------------------------------------------------------
function renderAdsets(adsetRows) {
  if (!adsetRows || adsetRows.length === 0) {
    adsetBody.innerHTML = `<tr><td colspan="4" class="empty-row">No ad sets found.</td></tr>`;
    adsetCount.textContent = '0';
    return;
  }

  const priority = ['LEARNING', 'LEARNING_LIMITED'];
  const sorted = [...adsetRows].sort((a, b) => {
    const aStage = a.learning_stage_info?.status || '';
    const bStage = b.learning_stage_info?.status || '';
    const ai = priority.indexOf(aStage);
    const bi = priority.indexOf(bStage);
    if (ai !== bi) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    return (a.name || '').localeCompare(b.name || '');
  });

  adsetBody.innerHTML = sorted.map(row => {
    const stageInfo  = row.learning_stage_info;
    const stageLabel = stageInfo?.status?.replace(/_/g, ' ') || 'N/A';

    return `<tr>
      <td title="${row.name}">${truncate(row.name, 45)}</td>
      <td>${statusBadge(row.effective_status || row.status)}</td>
      <td>${learnBadge(stageInfo)}</td>
      <td style="color:var(--text-muted);font-size:0.78rem">${stageLabel}</td>
    </tr>`;
  }).join('');

  adsetCount.textContent = sorted.length;
}

// ---------------------------------------------------------------------------
// Render: Placement Breakdown
// ---------------------------------------------------------------------------
function renderPlacements(placementRows) {
  if (!placementRows || placementRows.length === 0) {
    placementBody.innerHTML = `<tr><td colspan="9" class="empty-row">No placement data for selected period.</td></tr>`;
    placementCount.textContent = '0';
    return;
  }

  const sorted = [...placementRows].sort((a, b) => parseFloat(b.spend) - parseFloat(a.spend));

  placementBody.innerHTML = sorted.map(row => {
    const purchases = getAction(row.actions, 'purchase');
    const roas      = extractRoas(row.purchase_roas);
    const platform  = formatPlatform(row.publisher_platform);
    const placement = formatPlacement(row.placement);

    return `<tr>
      <td>${platform}</td>
      <td>${placement}</td>
      <td class="num">${fmtCurrency(row.spend, 2)}</td>
      <td class="num">${fmtNumber(row.impressions)}</td>
      <td class="num">${fmtNumber(row.clicks)}</td>
      <td class="num">${fmtCurrency(row.cpm, 2)}</td>
      <td class="num">${fmtCurrency(row.cpc, 2)}</td>
      <td class="num">${roas !== null ? fmtRoas(roas) : '—'}</td>
      <td class="num">${purchases !== null ? fmtNumber(purchases) : '—'}</td>
    </tr>`;
  }).join('');

  placementCount.textContent = sorted.length;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function truncate(str, max) {
  if (!str) return '—';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

const PLATFORM_LABELS = {
  facebook:         'Facebook',
  instagram:        'Instagram',
  audience_network: 'Audience Network',
  messenger:        'Messenger',
};
function formatPlatform(p) {
  return PLATFORM_LABELS[p] || (p ? p.charAt(0).toUpperCase() + p.slice(1) : '—');
}

const PLACEMENT_LABELS = {
  feed:                  'Feed',
  right_hand_column:     'Right Column',
  story:                 'Stories',
  reels:                 'Reels',
  video_feeds:           'Video Feeds',
  search:                'Search',
  instant_article:       'Instant Articles',
  marketplace:           'Marketplace',
  instream_video:        'In-Stream Video',
  rewarded_video:        'Rewarded Video',
  an_classic:            'AN Classic',
  suggested_video:       'Suggested Video',
  explore:               'Explore',
  profile_feed:          'Profile Feed',
  biz_disco_feed:        'Business Explore',
};
function formatPlacement(p) {
  return PLACEMENT_LABELS[p] || (p ? p.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '—');
}

// ---------------------------------------------------------------------------
// Account dropdown
// ---------------------------------------------------------------------------
async function loadAccounts() {
  accountSelect.innerHTML = '<option value="">Loading…</option>';
  try {
    const data = await apiFetch('/api/accounts');
    const accounts = data.data || [];
    if (accounts.length === 0) {
      accountSelect.innerHTML = '<option value="">No accounts found</option>';
      return;
    }
    accountSelect.innerHTML = '<option value="">— Select account —</option>' +
      accounts.map(a => {
        const statusLabel = a.account_status === 1 ? '' : ' (inactive)';
        return `<option value="${a.account_id}">${a.name}${statusLabel} (${a.account_id})</option>`;
      }).join('');
  } catch (err) {
    accountSelect.innerHTML = '<option value="">Error loading accounts</option>';
    showError(err.message);
  }
}

// ---------------------------------------------------------------------------
// Main data load
// ---------------------------------------------------------------------------
async function loadDashboard() {
  const accountId  = accountSelect.value;
  const datePreset = dateSelect.value;

  if (!accountId) return;

  clearError();
  refreshBtn.disabled = true;
  selectedCampaign = null;
  setFilterTag(adFilterTag, null);
  setFilterTag(adsetFilterTag, null);

  aiBody.innerHTML = '<p class="ai-placeholder">Select a campaign, then click a button above.</p>';
  aiCampaignLabel.textContent = '';
  btnAiRecommend.disabled = true;
  btnAiReport.disabled    = true;

  campaignBody.innerHTML  = loadingRow(10);
  adBody.innerHTML        = loadingRow(14);
  adsetBody.innerHTML     = loadingRow(4);
  placementBody.innerHTML = loadingRow(9);
  resetSummary();

  const qs = `account_id=${encodeURIComponent(accountId)}&date_preset=${encodeURIComponent(datePreset)}`;

  const [insightsResult, campaignsResult, adsResult, adCreativesResult, adsetsResult, placementsResult] = await Promise.allSettled([
    apiFetch(`/api/insights?${qs}`),
    apiFetch(`/api/campaigns?account_id=${encodeURIComponent(accountId)}`),
    apiFetch(`/api/ads?${qs}`),
    apiFetch(`/api/ad-creatives?account_id=${encodeURIComponent(accountId)}`),
    apiFetch(`/api/adsets?account_id=${encodeURIComponent(accountId)}`),
    apiFetch(`/api/placements?${qs}`),
  ]);

  const insightRows  = insightsResult.status  === 'fulfilled' ? insightsResult.value.data  || [] : [];
  const campaignRows = campaignsResult.status === 'fulfilled' ? campaignsResult.value.data || [] : [];

  allInsightRows = {};
  for (const row of insightRows) allInsightRows[row.campaign_name] = row;
  allCampaignRows = campaignRows;

  if (insightsResult.status === 'fulfilled' || campaignsResult.status === 'fulfilled') {
    renderSummary(insightRows);
    renderCampaigns(campaignRows, insightRows);
  } else {
    campaignBody.innerHTML = `<tr><td colspan="10" class="empty-row">Failed to load campaigns: ${campaignsResult.reason?.message}</td></tr>`;
    showError(campaignsResult.reason?.message || 'Failed to load campaigns');
  }

  allCreativeMap = buildCreativeMap(
    adCreativesResult.status === 'fulfilled' ? adCreativesResult.value.data || [] : []
  );
  if (adsResult.status === 'fulfilled') {
    allAdRows = adsResult.value.data || [];
    renderAds(allAdRows, allCreativeMap);
  } else {
    allAdRows = [];
    adBody.innerHTML = `<tr><td colspan="14" class="empty-row">Failed to load ads: ${adsResult.reason?.message}</td></tr>`;
  }

  if (adsetsResult.status === 'fulfilled') {
    allAdsetRows = adsetsResult.value.data || [];
    renderAdsets(allAdsetRows);
  } else {
    allAdsetRows = [];
    adsetBody.innerHTML = `<tr><td colspan="4" class="empty-row">Failed to load ad sets: ${adsetsResult.reason?.message}</td></tr>`;
  }

  if (placementsResult.status === 'fulfilled') {
    renderPlacements(placementsResult.value.data || []);
  } else {
    placementBody.innerHTML = `<tr><td colspan="9" class="empty-row">Failed to load placement data: ${placementsResult.reason?.message}</td></tr>`;
  }

  lastRefreshEl.textContent = new Date().toLocaleTimeString();
  refreshBtn.disabled = false;
}

// ---------------------------------------------------------------------------
// Settings Modal
// ---------------------------------------------------------------------------
function initSettingsModal(me) {
  const overlay       = document.getElementById('settingsOverlay');
  const closeBtn      = document.getElementById('settingsClose');
  const tabs          = document.querySelectorAll('.modal-tab');
  const panes         = document.querySelectorAll('.modal-pane');

  // Show admin tab if admin
  if (me.role === 'admin') {
    document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
  }

  // Show OAuth button if server has Meta App credentials configured
  if (me.oauthAvailable) {
    const oauthSection = document.getElementById('oauthSection');
    if (oauthSection) oauthSection.classList.remove('hidden');
  }

  // Tab switching
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panes.forEach(p => p.classList.add('hidden'));
      tab.classList.add('active');
      document.getElementById(`pane-${tab.dataset.tab}`).classList.remove('hidden');
      if (tab.dataset.tab === 'admin') loadAdminUsers();
      if (tab.dataset.tab === 'token') refreshCredsStatus();
    });
  });

  // Open / close
  settingsBtn.addEventListener('click', () => {
    overlay.classList.remove('hidden');
    refreshCredsStatus();
  });
  closeBtn.addEventListener('click',    () => overlay.classList.add('hidden'));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.add('hidden'); });

  // ---- Profile: Change Password ----
  document.getElementById('changePasswordBtn').addEventListener('click', async () => {
    const current  = document.getElementById('currentPassword').value;
    const next     = document.getElementById('newPassword').value;
    const confirm  = document.getElementById('confirmPassword').value;
    const feedback = document.getElementById('profileFeedback');

    feedback.className = 'modal-feedback';
    if (!current || !next) return showFeedback(feedback, 'error', 'All fields are required.');
    if (next !== confirm) return showFeedback(feedback, 'error', 'New passwords do not match.');
    if (next.length < 8)  return showFeedback(feedback, 'error', 'Password must be at least 8 characters.');

    try {
      await apiFetch('/settings/password', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      showFeedback(feedback, 'success', 'Password updated.');
      document.getElementById('currentPassword').value = '';
      document.getElementById('newPassword').value     = '';
      document.getElementById('confirmPassword').value = '';
    } catch (err) {
      showFeedback(feedback, 'error', err.message);
    }
  });

  // ---- Meta Credentials ----
  async function refreshCredsStatus() {
    try {
      const data = await apiFetch('/settings/meta-credentials-status');
      setCredStatus('statusAppId',     data.hasAppId);
      setCredStatus('statusAppSecret', data.hasAppSecret);
      setCredStatus('statusToken',     data.hasToken);
    } catch { /* ignore */ }
  }

  function setCredStatus(elId, ok) {
    const el = document.getElementById(elId);
    el.textContent = ok ? '✓' : '✗';
    el.className   = ok ? 'token-status--ok' : 'token-status--missing';
  }

  document.getElementById('saveCredsBtn').addEventListener('click', async () => {
    const appId     = document.getElementById('metaAppIdInput').value.trim();
    const appSecret = document.getElementById('metaAppSecretInput').value.trim();
    const token     = document.getElementById('metaTokenInput').value.trim();
    const feedback  = document.getElementById('tokenFeedback');

    // At least one field must be provided
    if (appId === '' && appSecret === '' && token === '') {
      return showFeedback(feedback, 'error', 'Completa al menos un campo antes de guardar.');
    }

    try {
      await apiFetch('/settings/meta-credentials', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        // Only send fields the user interacted with (all three in this case)
        body: JSON.stringify({ appId, appSecret, token }),
      });
      showFeedback(feedback, 'success', 'Credenciales guardadas. Recarga las cuentas para usar el nuevo token.');
      document.getElementById('metaAppIdInput').value     = '';
      document.getElementById('metaAppSecretInput').value = '';
      document.getElementById('metaTokenInput').value     = '';
      refreshCredsStatus();
    } catch (err) {
      showFeedback(feedback, 'error', err.message);
    }
  });

  // ---- Admin: Users ----
  async function loadAdminUsers() {
    const tbody    = document.getElementById('adminUserBody');
    const feedback = document.getElementById('adminFeedback');
    tbody.innerHTML = `<tr><td colspan="5" class="empty-row"><span class="spinner"></span> Loading…</td></tr>`;
    try {
      const { users } = await apiFetch('/admin/users');
      if (users.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="empty-row">No users found.</td></tr>`;
        return;
      }
      const credIcon = (ok) => ok
        ? '<span class="token-status--ok">✓</span>'
        : '<span class="token-status--missing">✗</span>';

      tbody.innerHTML = users.map(u => `
        <tr>
          <td>${escHtml(u.username)}</td>
          <td>${escHtml(u.email)}</td>
          <td>${escHtml(u.role)}</td>
          <td style="white-space:nowrap">
            ID ${credIcon(u.has_meta_app_id)}
            Secret ${credIcon(u.has_meta_app_secret)}
            Token ${credIcon(u.has_meta_token)}
          </td>
          <td>
            <button class="btn-small btn-reset-pwd" data-id="${u.id}" data-name="${escHtml(u.username)}">Reset pwd</button>
            ${u.id !== me.id ? `<button class="btn-small btn-delete-user" data-id="${u.id}" data-name="${escHtml(u.username)}">Delete</button>` : ''}
          </td>
        </tr>
      `).join('');

      tbody.querySelectorAll('.btn-delete-user').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm(`Delete user "${btn.dataset.name}"? This cannot be undone.`)) return;
          try {
            await apiFetch(`/admin/users/${btn.dataset.id}`, { method: 'DELETE' });
            showFeedback(feedback, 'success', `User "${btn.dataset.name}" deleted.`);
            loadAdminUsers();
          } catch (err) {
            showFeedback(feedback, 'error', err.message);
          }
        });
      });

      tbody.querySelectorAll('.btn-reset-pwd').forEach(btn => {
        btn.addEventListener('click', async () => {
          const pwd = prompt(`New password for "${btn.dataset.name}" (min 8 chars):`);
          if (!pwd) return;
          if (pwd.length < 8) { alert('Password must be at least 8 characters.'); return; }
          try {
            await apiFetch(`/admin/users/${btn.dataset.id}/password`, {
              method:  'PUT',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({ newPassword: pwd }),
            });
            showFeedback(feedback, 'success', `Password reset for "${btn.dataset.name}".`);
          } catch (err) {
            showFeedback(feedback, 'error', err.message);
          }
        });
      });
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-row">Error: ${err.message}</td></tr>`;
    }
  }

  // ---- Admin: Create User ----
  document.getElementById('createUserBtn').addEventListener('click', async () => {
    const username = document.getElementById('newUsername').value.trim();
    const email    = document.getElementById('newEmail').value.trim();
    const password = document.getElementById('newUserPassword').value;
    const role     = document.getElementById('newUserRole').value;
    const feedback = document.getElementById('adminFeedback');

    if (!username || !email || !password) return showFeedback(feedback, 'error', 'All fields are required.');

    try {
      await apiFetch('/admin/users', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username, email, password, role }),
      });
      showFeedback(feedback, 'success', `User "${username}" created.`);
      document.getElementById('newUsername').value     = '';
      document.getElementById('newEmail').value        = '';
      document.getElementById('newUserPassword').value = '';
      loadAdminUsers();
    } catch (err) {
      showFeedback(feedback, 'error', err.message);
    }
  });
}

function showFeedback(el, type, msg) {
  el.textContent = msg;
  el.className   = type === 'success' ? 'modal-feedback modal-success' : 'modal-feedback modal-error';
}

function escHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
async function init() {
  // Auth check — redirect to login if not authenticated
  let me;
  try {
    me = await apiFetch('/auth/me');
  } catch {
    // apiFetch already redirects on 401
    return;
  }

  headerUsername.textContent = me.username;

  // Handle OAuth redirect-back params
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('connected')) {
    // Show success — open settings → Meta credentials tab and show toast
    history.replaceState({}, '', '/');
    setTimeout(() => {
      document.getElementById('settingsOverlay').classList.remove('hidden');
      document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.modal-pane').forEach(p => p.classList.add('hidden'));
      const tokenTab  = document.querySelector('[data-tab="token"]');
      const tokenPane = document.getElementById('pane-token');
      if (tokenTab)  tokenTab.classList.add('active');
      if (tokenPane) tokenPane.classList.remove('hidden');
      // Show success feedback in the token pane
      const feedback = document.getElementById('tokenFeedback');
      if (feedback) showFeedback(feedback, 'success', '¡Cuenta de Facebook conectada! Token guardado correctamente.');
    }, 150);
  } else if (urlParams.has('error')) {
    const msg = urlParams.get('error');
    showError(`Facebook OAuth error: ${msg}`);
    history.replaceState({}, '', '/');
  }

  // Logout
  logoutBtn.addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
    window.location.href = '/login.html';
  });

  initSettingsModal(me);

  await loadAccounts();

  accountSelect.addEventListener('change', loadDashboard);
  dateSelect.addEventListener('change', loadDashboard);
  refreshBtn.addEventListener('click', loadDashboard);

  btnAiRecommend.addEventListener('click', () => {
    const name = btnAiRecommend.dataset.campaignName;
    const id   = btnAiRecommend.dataset.campaignId;
    if (name && id) fetchAiRecommendations(name, id);
  });

  btnAiReport.addEventListener('click', () => {
    const name = btnAiReport.dataset.campaignName;
    const id   = btnAiReport.dataset.campaignId;
    if (name && id) generatePdfReport(name, id);
  });

  if (accountSelect.options.length === 2) {
    accountSelect.selectedIndex = 1;
    loadDashboard();
  }
}

init();
