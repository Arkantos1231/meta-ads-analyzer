/**
 * Meta Ads Dashboard — frontend logic
 *
 * Pure vanilla JS (ES modules). No frameworks.
 * Communicates only with the local proxy server on port 3000.
 */

import { t, getLang, setLang, applyI18n } from './i18n.js';

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
const adFilterTag        = document.getElementById('adFilterTag');
const adsetFilterTag     = document.getElementById('adsetFilterTag');
const placementFilterTag = document.getElementById('placementFilterTag');
const themeBtn           = document.getElementById('themeBtn');
const langBtn            = document.getElementById('langBtn');

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
// Language toggle
// ---------------------------------------------------------------------------
function applyLangBtn() {
  const lang = getLang();
  langBtn.title = t('lang_toggle_title');
  langBtn.setAttribute('aria-label', lang === 'en' ? 'EN' : 'ES');
  // Show current lang as small text next to globe
  langBtn.textContent = '🌐 ' + (lang === 'en' ? 'EN' : 'ES');
}

applyLangBtn();

langBtn.addEventListener('click', () => {
  const next = getLang() === 'en' ? 'es' : 'en';
  setLang(next);
  applyLangBtn();
  // Update date options (data-i18n on <option> elements)
  document.querySelectorAll('#dateSelect option[data-i18n]').forEach(opt => {
    opt.textContent = t(opt.dataset.i18n);
  });
  // Re-render dynamic content with current data
  rerenderAll();
});

// Apply i18n on page load
applyI18n();
// Also update date options on load
document.querySelectorAll('#dateSelect option[data-i18n]').forEach(opt => {
  opt.textContent = t(opt.dataset.i18n);
});

// ---------------------------------------------------------------------------
// Module-level data state (for click-to-filter + AI + re-render)
// ---------------------------------------------------------------------------
let allAdRows       = [];
let allAdsetRows    = [];
let allInsightRows  = {};   // keyed by campaign_name
let allCampaignRows = [];   // full campaign objects
let selectedCampaign = null;
let selectedAdId     = null;
let dataLoaded       = false;

// AI section DOM refs
const aiSection       = document.getElementById('aiSection');
const aiBody          = document.getElementById('aiBody');
const aiCampaignLabel = document.getElementById('aiCampaignLabel');
const btnAiRecommend  = document.getElementById('btnAiRecommend');
const btnAiReport     = document.getElementById('btnAiReport');

// Re-render all currently loaded data (called on language switch)
function rerenderAll() {
  if (!dataLoaded) return;
  const insightRows = Object.values(allInsightRows);
  renderSummary(insightRows);
  renderCampaigns(allCampaignRows, insightRows);
  if (selectedCampaign) {
    const filteredAds    = allAdRows.filter(r => r.campaign_name === selectedCampaign);
    const selectedRow    = allCampaignRows.find(c => c.name === selectedCampaign);
    const filteredAdsets = allAdsetRows.filter(r => r.campaign_id === selectedRow?.id);
    renderAds(filteredAds);
    renderAdsets(filteredAdsets);
  } else {
    renderAds(allAdRows);
    renderAdsets(allAdsetRows);
  }
  // AI buttons
  btnAiRecommend.textContent = t('ai_generate');
  btnAiReport.textContent    = t('ai_report');
  // AI placeholder
  if (!selectedCampaign) {
    aiBody.innerHTML = `<p class="ai-placeholder">${t('ai_placeholder')}</p>`;
  }
}

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
  errorBanner.textContent = `${t('error_prefix')}: ${msg}`;
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
  if (s === 'active')              return `<span class="badge badge-active">${t('badge_active')}</span>`;
  if (s === 'paused')              return `<span class="badge badge-paused">${t('badge_paused')}</span>`;
  if (s === 'learning')            return `<span class="badge badge-learning">${t('badge_learning')}</span>`;
  if (s === 'learning_limited')    return `<span class="badge badge-limited">${t('badge_learning_limited')}</span>`;
  if (s === 'deleted' || s === 'archived') return `<span class="badge badge-paused">${status}</span>`;
  return `<span class="badge badge-unknown">${status || '—'}</span>`;
}

// ---------------------------------------------------------------------------
// Loading placeholder rows
// ---------------------------------------------------------------------------
function loadingRow(cols) {
  return `<tr class="loading-row"><td colspan="${cols}"><span class="spinner"></span> ${t('loading')}</td></tr>`;
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

  subSpend.textContent     = `${fmtNumber(totalImpressions)} ${t('impressions').toLowerCase()}`;
  subRoas.textContent      = t('weighted_by_spend');
  subPurchases.textContent = `${fmtNumber(totalClicks)} ${t('clicks').toLowerCase()}`;
  subCpm.textContent       = t('weighted_avg_cpm');
  subCtr.textContent       = `${fmtNumber(totalClicks)} ${t('clicks').toLowerCase()}`;
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
    campaignBody.innerHTML = `<tr><td colspan="10" class="empty-row">${t('no_campaigns')}</td></tr>`;
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
    selectedAdId = null;
    campaignBody.querySelectorAll('.campaign-row').forEach(r => r.classList.remove('row-selected'));
    setFilterTag(adFilterTag, null);
    setFilterTag(adsetFilterTag, null);
    setFilterTag(placementFilterTag, null);
    renderAds(allAdRows);
    renderAdsets(allAdsetRows);
    aiBody.innerHTML = `<p class="ai-placeholder">${t('ai_placeholder')}</p>`;
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
    renderAds(filteredAds);
    renderAdsets(filteredAdsets);
    aiCampaignLabel.textContent = truncate(campaignName, 50);
    aiBody.innerHTML = `<p class="ai-placeholder">${t('ai_campaign_selected')}</p>`;
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
    language:   getLang(),
  };
}

async function fetchAiRecommendations(campaignName, campaignId) {
  aiBody.innerHTML = `<div class="ai-loading">
    <div class="ai-dots"><span></span><span></span><span></span></div>
    ${t('ai_analyzing')}
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
  btnAiReport.textContent  = t('ai_generating');
  btnAiReport.disabled     = true;
  btnAiRecommend.disabled  = true;

  try {
    const json = await apiFetch('/api/ai-report', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(buildAiPayload(campaignName, campaignId)),
    });
    if (json.error) {
      aiBody.innerHTML = `<div class="ai-error">⚠ ${t('report_title')} error: ${json.error}</div>`;
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
  const lang     = getLang();
  const now      = new Date().toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const period   = datePreset.replace(/_/g, ' ');

  const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <title>${t('report_title')} — ${campaignName}</title>
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
  <button class="print-btn" onclick="window.print()">${t('report_print')}</button>
  <div class="rpt-header">
    <div>
      <div class="rpt-title">${t('report_title')}</div>
      <div class="rpt-campaign">${campaignName}</div>
    </div>
    <div class="rpt-meta">
      ${t('report_period')}: ${period}<br>
      ${t('report_generated')}: ${now}<br>
      Meta Ads Dashboard
    </div>
  </div>
  ${bodyHtml}
  <div class="rpt-footer">${t('report_footer')} · ${now}</div>
</body>
</html>`;

  const win = window.open('', '_blank');
  if (!win) {
    alert(t('popup_blocked'));
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
    el.innerHTML = `${t('filtered')}: ${label} <span class="clear-filter" title="Clear filter">✕</span>`;
    el.querySelector('.clear-filter').addEventListener('click', (e) => {
      e.stopPropagation();
      onCampaignClick(selectedCampaign, null);
    });
  }
}

// ---------------------------------------------------------------------------
// Render: Ads Table
// ---------------------------------------------------------------------------
function renderAds(adRows) {
  if (!adRows || adRows.length === 0) {
    adBody.innerHTML = `<tr><td colspan="14" class="empty-row">${t('no_ads')}</td></tr>`;
    adCount.textContent = '0';
    return;
  }

  const sorted = [...adRows].sort((a, b) => parseFloat(b.spend) - parseFloat(a.spend));

  adBody.innerHTML = sorted.map(row => {
    const purchases = getAction(row.actions, 'purchase');
    const revenue   = getAction(row.action_values, 'purchase');
    const roas      = extractRoas(row.purchase_roas);

    const adStatus = (row.ad_status || '').toUpperCase();
    const isActive = adStatus === 'ACTIVE';
    const isSelected = row.ad_id === selectedAdId;
    return `<tr class="ad-row${isSelected ? ' row-selected' : ''}" data-ad-id="${row.ad_id}" data-ad-name="${row.ad_name}" style="cursor:pointer">
      <td title="${row.ad_name}">${truncate(row.ad_name, 35)}</td>
      <td><span class="status-badge status-${isActive ? 'active' : 'inactive'}">${isActive ? 'ON' : 'OFF'}</span></td>
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

  adBody.querySelectorAll('.ad-row').forEach(row => {
    row.addEventListener('click', () => onAdClick(row.dataset.adId, row.dataset.adName));
  });
}

// ---------------------------------------------------------------------------
// Ad click → filter Placement Breakdown
// ---------------------------------------------------------------------------
async function onAdClick(adId, adName) {
  if (selectedAdId === adId) {
    selectedAdId = null;
    adBody.querySelectorAll('.ad-row').forEach(r => r.classList.remove('row-selected'));
    setFilterTag(placementFilterTag, null);
    const qs = `account_id=${encodeURIComponent(accountSelect.value)}&date_preset=${encodeURIComponent(dateSelect.value)}`;
    try {
      const data = await apiFetch(`/api/placements?${qs}`);
      renderPlacements(data.data || []);
    } catch { /* keep existing */ }
    return;
  }

  selectedAdId = adId;
  adBody.querySelectorAll('.ad-row').forEach(r => {
    r.classList.toggle('row-selected', r.dataset.adId === adId);
  });
  setFilterTag(placementFilterTag, truncate(adName, 40));

  placementBody.innerHTML = `<tr><td colspan="9" class="empty-row">${t('loading')}</td></tr>`;
  const qs = `account_id=${encodeURIComponent(accountSelect.value)}&date_preset=${encodeURIComponent(dateSelect.value)}&ad_id=${encodeURIComponent(adId)}`;
  try {
    const data = await apiFetch(`/api/placements?${qs}`);
    renderPlacements(data.data || []);
  } catch (err) {
    placementBody.innerHTML = `<tr><td colspan="9" class="empty-row">${t('error_prefix')}: ${err.message}</td></tr>`;
  }
}

// ---------------------------------------------------------------------------
// Render: Ad Sets
// ---------------------------------------------------------------------------
function renderAdsets(adsetRows) {
  if (!adsetRows || adsetRows.length === 0) {
    adsetBody.innerHTML = `<tr><td colspan="2" class="empty-row">${t('no_adsets')}</td></tr>`;
    adsetCount.textContent = '0';
    return;
  }

  const sorted = [...adsetRows].sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  adsetBody.innerHTML = sorted.map(row => `<tr>
    <td title="${row.name}">${truncate(row.name, 55)}</td>
    <td>${statusBadge(row.effective_status || row.status)}</td>
  </tr>`).join('');

  adsetCount.textContent = sorted.length;
}

// ---------------------------------------------------------------------------
// Render: Placement Breakdown
// ---------------------------------------------------------------------------
function renderPlacements(placementRows) {
  if (!placementRows || placementRows.length === 0) {
    placementBody.innerHTML = `<tr><td colspan="9" class="empty-row">${t('no_placements')}</td></tr>`;
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
  feed:              'Feed',
  right_hand_column: 'Right Column',
  story:             'Stories',
  reels:             'Reels',
  video_feeds:       'Video Feeds',
  search:            'Search',
  instant_article:   'Instant Articles',
  marketplace:       'Marketplace',
  instream_video:    'In-Stream Video',
  rewarded_video:    'Rewarded Video',
  an_classic:        'AN Classic',
  suggested_video:   'Suggested Video',
  explore:           'Explore',
  profile_feed:      'Profile Feed',
  biz_disco_feed:    'Business Explore',
};
function formatPlacement(p) {
  return PLACEMENT_LABELS[p] || (p ? p.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '—');
}

// ---------------------------------------------------------------------------
// Account dropdown
// ---------------------------------------------------------------------------
async function loadAccounts() {
  accountSelect.innerHTML = `<option value="">${t('loading_accounts')}</option>`;
  try {
    const data     = await apiFetch('/api/accounts');
    const accounts = data.data || [];
    if (accounts.length === 0) {
      accountSelect.innerHTML = `<option value="">${t('no_accounts')}</option>`;
      return;
    }
    accountSelect.innerHTML = `<option value="">${t('select_account')}</option>` +
      accounts.map(a => `<option value="${a.account_id}">${a.name} (${a.account_id})</option>`).join('');
  } catch (err) {
    accountSelect.innerHTML = `<option value="">${t('error_loading_accounts')}</option>`;
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

  aiBody.innerHTML = `<p class="ai-placeholder">${t('ai_placeholder')}</p>`;
  aiCampaignLabel.textContent = '';
  btnAiRecommend.disabled = true;
  btnAiReport.disabled    = true;

  campaignBody.innerHTML  = loadingRow(10);
  adBody.innerHTML        = loadingRow(14);
  adsetBody.innerHTML     = loadingRow(4);
  placementBody.innerHTML = loadingRow(9);
  resetSummary();

  const qs = `account_id=${encodeURIComponent(accountId)}&date_preset=${encodeURIComponent(datePreset)}`;

  const [insightsResult, campaignsResult, adsResult, adsetsResult, placementsResult] = await Promise.allSettled([
    apiFetch(`/api/insights?${qs}`),
    apiFetch(`/api/campaigns?${qs}`),
    apiFetch(`/api/ads?${qs}`),
    apiFetch(`/api/adsets?${qs}`),
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
    campaignBody.innerHTML = `<tr><td colspan="10" class="empty-row">${t('failed_campaigns')}: ${campaignsResult.reason?.message}</td></tr>`;
    showError(campaignsResult.reason?.message || t('failed_campaigns'));
  }

  if (adsResult.status === 'fulfilled') {
    allAdRows = adsResult.value.data || [];
    renderAds(allAdRows);
  } else {
    allAdRows = [];
    adBody.innerHTML = `<tr><td colspan="14" class="empty-row">${t('failed_ads')}: ${adsResult.reason?.message}</td></tr>`;
  }

  if (adsetsResult.status === 'fulfilled') {
    allAdsetRows = adsetsResult.value.data || [];
    renderAdsets(allAdsetRows);
  } else {
    allAdsetRows = [];
    adsetBody.innerHTML = `<tr><td colspan="2" class="empty-row">${t('failed_adsets')}: ${adsetsResult.reason?.message}</td></tr>`;
  }

  if (placementsResult.status === 'fulfilled') {
    renderPlacements(placementsResult.value.data || []);
  } else {
    placementBody.innerHTML = `<tr><td colspan="9" class="empty-row">${t('failed_placements')}: ${placementsResult.reason?.message}</td></tr>`;
  }

  dataLoaded = true;
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
  } else {
    document.querySelectorAll('.admin-connection-only').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.admin-connection-only-hide').forEach(el => el.classList.remove('hidden'));
  }

  // Tab switching
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panes.forEach(p => p.classList.add('hidden'));
      tab.classList.add('active');
      document.getElementById(`pane-${tab.dataset.tab}`).classList.remove('hidden');
      if (tab.dataset.tab === 'admin') loadAdminUsers();
      if (tab.dataset.tab === 'token') refreshWindsorStatus();
    });
  });

  // Open / close
  settingsBtn.addEventListener('click', () => {
    overlay.classList.remove('hidden');
    refreshWindsorStatus();
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
    if (!current || !next) return showFeedback(feedback, 'error', t('all_fields_required'));
    if (next !== confirm)  return showFeedback(feedback, 'error', t('passwords_no_match'));
    if (next.length < 8)   return showFeedback(feedback, 'error', t('password_min_8'));

    try {
      await apiFetch('/settings/password', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      showFeedback(feedback, 'success', t('password_updated'));
      document.getElementById('currentPassword').value = '';
      document.getElementById('newPassword').value     = '';
      document.getElementById('confirmPassword').value = '';
    } catch (err) {
      showFeedback(feedback, 'error', err.message);
    }
  });

  // ---- Conexión Windsor ----
  async function refreshWindsorStatus() {
    try {
      const data         = await apiFetch('/auth/me');
      const connected    = document.getElementById('windsorConnected');
      const notConnected = document.getElementById('windsorNotConnected');
      const feedback     = document.getElementById('tokenFeedback');
      const ids          = data.windsorDatasourceIds || [];

      if (ids.length > 0) {
        connected.classList.remove('hidden');
        notConnected.classList.add('hidden');
        const nameMap = {};
        for (const ds of windsorDatasources) nameMap[ds.id] = ds.account_name;
        const list = document.getElementById('windsorConnectedList');
        const isAdmin = me.role === 'admin';
        list.innerHTML = ids.map(id => `
          <div class="windsor-ds-item">
            <span>✓ ${escHtml(nameMap[id] || id)}</span>
            ${isAdmin ? `<button class="btn-small btn-remove-ds" data-id="${escHtml(id)}">✕</button>` : ''}
          </div>`).join('');
        list.querySelectorAll('.btn-remove-ds').forEach(btn => {
          btn.addEventListener('click', async () => {
            const name = nameMap[btn.dataset.id] || btn.dataset.id;
            if (!confirm(t('remove_account_confirm', name))) return;
            try {
              await apiFetch(`/settings/windsor-datasource/${encodeURIComponent(btn.dataset.id)}`, { method: 'DELETE' });
              refreshWindsorStatus();
              loadAccounts();
            } catch (err) { showFeedback(feedback, 'error', err.message); }
          });
        });
      } else {
        connected.classList.add('hidden');
        notConnected.classList.remove('hidden');
        document.getElementById('windsorStep1').classList.remove('hidden');
        document.getElementById('windsorStep2').classList.add('hidden');
        document.getElementById('windsorSelectDs').classList.add('hidden');
      }
      feedback.classList.add('hidden');
    } catch { /* ignore */ }
  }

  // "Add another account"
  document.getElementById('windsorAddAnotherBtn').addEventListener('click', () => {
    document.getElementById('windsorConnected').classList.add('hidden');
    document.getElementById('windsorNotConnected').classList.remove('hidden');
    document.getElementById('windsorSelectDs').classList.add('hidden');
  });

  // Step 1: generate link
  document.getElementById('windsorConnectBtn').addEventListener('click', async () => {
    const btn      = document.getElementById('windsorConnectBtn');
    const feedback = document.getElementById('tokenFeedback');
    btn.disabled   = true;
    btn.textContent = t('generating_link');
    try {
      const { url } = await apiFetch('/api/windsor/connect', { method: 'POST' });
      window.open(url, '_blank');
      document.getElementById('windsorStep1').classList.add('hidden');
      document.getElementById('windsorStep2').classList.remove('hidden');
    } catch (err) {
      showFeedback(feedback, 'error', err.message);
    } finally {
      btn.disabled    = false;
      btn.textContent = t('connect_meta');
    }
  });

  document.getElementById('windsorBackBtn').addEventListener('click', () => {
    document.getElementById('windsorStep2').classList.add('hidden');
    document.getElementById('windsorStep1').classList.remove('hidden');
    document.getElementById('tokenFeedback').classList.add('hidden');
  });

  // Step 2: verify
  document.getElementById('windsorVerifyBtn').addEventListener('click', async () => {
    const btn      = document.getElementById('windsorVerifyBtn');
    const feedback = document.getElementById('tokenFeedback');
    btn.disabled   = true;
    btn.textContent = t('verifying');
    try {
      const { datasources } = await apiFetch('/api/windsor/available-datasources');
      if (!datasources || datasources.length === 0) {
        showFeedback(feedback, 'error', t('no_new_accounts'));
      } else if (datasources.length === 1) {
        await assignDatasource(datasources[0].id, datasources[0].account_name, feedback);
      } else {
        const select = document.getElementById('windsorDsSelect');
        select.innerHTML = datasources.map(ds =>
          `<option value="${escHtml(ds.id)}">${escHtml(ds.account_name)} (${escHtml(ds.id)})</option>`
        ).join('');
        document.getElementById('windsorStep2').classList.add('hidden');
        document.getElementById('windsorSelectDs').classList.remove('hidden');
      }
    } catch (err) {
      showFeedback(feedback, 'error', err.message);
    } finally {
      btn.disabled    = false;
      btn.textContent = t('check_accounts');
    }
  });

  // Step 3: confirm datasource
  document.getElementById('windsorConfirmBtn').addEventListener('click', async () => {
    const feedback     = document.getElementById('tokenFeedback');
    const datasourceId = document.getElementById('windsorDsSelect').value;
    const name         = document.getElementById('windsorDsSelect').selectedOptions[0]?.text || datasourceId;
    await assignDatasource(datasourceId, name, feedback);
  });

  async function assignDatasource(datasourceId, name, feedback) {
    try {
      await apiFetch('/settings/windsor-datasource', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ datasourceId }),
      });
      showFeedback(feedback, 'success', t('account_connected', name));
      refreshWindsorStatus();
      loadAccounts();
    } catch (err) {
      showFeedback(feedback, 'error', err.message);
    }
  }

  // Disconnect all
  document.getElementById('windsorDisconnectBtn').addEventListener('click', async () => {
    if (!confirm(t('disconnect_all_confirm'))) return;
    const feedback = document.getElementById('tokenFeedback');
    try {
      await apiFetch('/settings/windsor-datasource', {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ datasourceId: null }),
      });
      showFeedback(feedback, 'success', t('all_disconnected'));
      refreshWindsorStatus();
      loadAccounts();
    } catch (err) {
      showFeedback(feedback, 'error', err.message);
    }
  });

  // ---- Admin: Users ----
  let windsorDatasources = [];

  async function loadWindsorDatasources() {
    try {
      const { datasources } = await apiFetch('/api/windsor/datasources');
      windsorDatasources = datasources || [];
    } catch {
      windsorDatasources = [];
    }
  }

  async function loadAdminUsers() {
    const tbody    = document.getElementById('adminUserBody');
    const feedback = document.getElementById('adminFeedback');
    tbody.innerHTML = `<tr><td colspan="5" class="empty-row"><span class="spinner"></span> ${t('loading')}</td></tr>`;
    try {
      await loadWindsorDatasources();
      const { users } = await apiFetch('/admin/users');
      if (users.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="empty-row">${t('no_users')}</td></tr>`;
        return;
      }

      const dsMap = {};
      for (const ds of windsorDatasources) dsMap[ds.id] = ds.account_name;

      tbody.innerHTML = users.map(u => {
        const ids = u.windsor_datasource_ids || [];
        const dsLabel = ids.length > 0
          ? ids.map(id => `<span class="ds-chip" title="ID: ${escHtml(id)}">✓ ${escHtml(dsMap[id] || id)}</span>`).join(' ')
          : `<span class="token-status--missing">${t('none_assigned')}</span>`;
        return `
          <tr data-uid="${u.id}">
            <td>${escHtml(u.username)}</td>
            <td>${escHtml(u.email)}</td>
            <td>${escHtml(u.role)}</td>
            <td class="windsor-cell">${dsLabel}</td>
            <td>
              <button class="btn-small btn-assign-ds" data-id="${u.id}" data-name="${escHtml(u.username)}">${t('btn_add')}</button>
              <button class="btn-small btn-reset-pwd" data-id="${u.id}" data-name="${escHtml(u.username)}">${t('btn_reset_pwd')}</button>
              ${u.id !== me.id ? `<button class="btn-small btn-delete-user" data-id="${u.id}" data-name="${escHtml(u.username)}">${t('btn_delete')}</button>` : ''}
            </td>
          </tr>`;
      }).join('');

      tbody.querySelectorAll('.btn-assign-ds').forEach(btn => {
        btn.addEventListener('click', () => showAssignDatasource(btn, feedback));
      });

      tbody.querySelectorAll('.btn-delete-user').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm(t('delete_user_confirm', btn.dataset.name))) return;
          try {
            await apiFetch(`/admin/users/${btn.dataset.id}`, { method: 'DELETE' });
            showFeedback(feedback, 'success', t('user_deleted', btn.dataset.name));
            loadAdminUsers();
          } catch (err) {
            showFeedback(feedback, 'error', err.message);
          }
        });
      });

      tbody.querySelectorAll('.btn-reset-pwd').forEach(btn => {
        btn.addEventListener('click', async () => {
          const pwd = prompt(t('new_password_prompt', btn.dataset.name));
          if (!pwd) return;
          if (pwd.length < 8) { alert(t('password_min_8')); return; }
          try {
            await apiFetch(`/admin/users/${btn.dataset.id}/password`, {
              method:  'PUT',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({ newPassword: pwd }),
            });
            showFeedback(feedback, 'success', t('password_reset', btn.dataset.name));
          } catch (err) {
            showFeedback(feedback, 'error', err.message);
          }
        });
      });
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-row">${t('error_prefix')}: ${err.message}</td></tr>`;
    }
  }

  function showAssignDatasource(btn, feedback) {
    const userId = btn.dataset.id;
    const row    = btn.closest('tr');
    const cell   = row.querySelector('.windsor-cell');

    const options = windsorDatasources.length > 0
      ? windsorDatasources.map(ds => `<option value="${escHtml(ds.id)}">${escHtml(ds.account_name)} (${escHtml(ds.id)})</option>`).join('')
      : `<option value="">— ${t('no_accounts')} —</option>`;

    cell.innerHTML = `
      <select class="ds-select" style="font-size:0.78rem;max-width:180px">
        <option value="">— ${t('select_account').replace('— ', '').replace(' —', '')} —</option>
        ${options}
      </select>
      <button class="btn-small btn-save-ds" style="margin-left:4px">${t('btn_add').replace('+ ', '')}</button>
      <button class="btn-small btn-cancel-ds" style="margin-left:2px">✕</button>`;

    cell.querySelector('.btn-cancel-ds').addEventListener('click', () => loadAdminUsers());

    cell.querySelector('.btn-save-ds').addEventListener('click', async () => {
      const datasourceId = cell.querySelector('.ds-select').value;
      if (!datasourceId) return;
      try {
        await apiFetch(`/admin/users/${userId}/windsor-datasources`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ datasourceId }),
        });
        showFeedback(feedback, 'success', t('account_assigned'));
        loadAdminUsers();
      } catch (err) {
        showFeedback(feedback, 'error', err.message);
      }
    });
  }

  // ---- Admin: Generate Windsor connection link ----
  document.getElementById('generateLinkBtn').addEventListener('click', async () => {
    const btn      = document.getElementById('generateLinkBtn');
    const feedback = document.getElementById('generateLinkFeedback');
    btn.disabled   = true;
    btn.textContent = t('generating_link');
    try {
      const { url } = await apiFetch('/api/windsor/generate-link', { method: 'POST' });
      await navigator.clipboard.writeText(url);
      showFeedback(feedback, 'success', t('link_copied'));
    } catch (err) {
      showFeedback(feedback, 'error', err.message);
    } finally {
      btn.disabled   = false;
      btn.textContent = t('generate_link_btn');
    }
  });

  // ---- Admin: Create User ----
  document.getElementById('createUserBtn').addEventListener('click', async () => {
    const username = document.getElementById('newUsername').value.trim();
    const email    = document.getElementById('newEmail').value.trim();
    const password = document.getElementById('newUserPassword').value;
    const role     = document.getElementById('newUserRole').value;
    const feedback = document.getElementById('adminFeedback');

    if (!username || !email || !password) return showFeedback(feedback, 'error', t('all_fields_required'));

    try {
      await apiFetch('/admin/users', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username, email, password, role }),
      });
      showFeedback(feedback, 'success', t('user_created', username));
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
  let me;
  try {
    me = await apiFetch('/auth/me');
  } catch {
    return;
  }

  headerUsername.textContent = me.username;

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
