// generate-site.js — Cursor-style status page
const fs   = require('fs');
const path = require('path');

// ── Load data ─────────────────────────────────────────────────────────────────
let sites = [];
try {
  const raw  = fs.readFileSync('history/summary.json', 'utf8');
  const data = JSON.parse(raw);
  sites = Array.isArray(data) ? data : (data.sites || data.value || []);
  // Fix encoding issues in names (â€" → —)
  sites = sites.map(s => ({ ...s, name: s.name.replace(/â€"/g, '—') }));
} catch (_) {}

let healthFull = null;
try {
  const raw = fs.readFileSync('health-full.json', 'utf8');
  const obj = JSON.parse(raw);
  if (obj && obj.status && obj.status !== '{}') healthFull = obj;
} catch (_) {}

// ── Logo ──────────────────────────────────────────────────────────────────────
let logoDataUrl = '';
try {
  const buf  = fs.readFileSync(path.join(__dirname, 'logo.png'));
  logoDataUrl = `data:image/png;base64,${buf.toString('base64')}`;
} catch (_) {}

// ── Helpers ───────────────────────────────────────────────────────────────────
function slugify(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Build 90-day map from dailyMinutesDown object in summary.json
function buildDayMap(site, total = 90) {
  const map = {};
  const dmd = site.dailyMinutesDown || {};
  for (const [date, mins] of Object.entries(dmd)) {
    map[date] = mins > 0 ? 'down' : 'up';
  }
  // Also scan history yml for richer data
  try {
    const slug = site.slug || slugify(site.name);
    const raw  = fs.readFileSync(`history/${slug}.yml`, 'utf8');
    const startMatch = raw.match(/startTime:\s+(.+)/);
    if (startMatch) {
      const d = new Date(startMatch[1].trim());
      if (!isNaN(d)) {
        const key = d.toISOString().slice(0, 10);
        if (!map[key]) map[key] = 'down';
      }
    }
  } catch (_) {}
  return map;
}

function buildBars(site, total = 90) {
  const dayMap = buildDayMap(site, total);
  const bars   = [];
  const today  = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = total - 1; i >= 0; i--) {
    const d   = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    bars.push({ date: key, status: dayMap[key] || 'up', daysAgo: i });
  }
  return bars;
}

function uptimePct(site) {
  const v = site.uptimeMonth || site.uptimeYear || site.uptime;
  if (!v && v !== 0) return null;
  const s = String(v);
  return s.endsWith('%') ? s : s + '%';
}

// ── Past incidents ─────────────────────────────────────────────────────────────
// Build last 14 days of incident log
function buildIncidentDays(allSites, daysBack = 14) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = [];

  for (let i = 0; i < daysBack; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateKey = d.toISOString().slice(0, 10);

    const incidents = [];
    for (const site of allSites) {
      const dmd   = site.dailyMinutesDown || {};
      const mins  = dmd[dateKey];
      if (mins && Number(mins) > 0) {
        incidents.push({
          service: site.name,
          minutes: Number(mins),
          url:     site.url,
        });
      }
    }

    days.push({ date: d, dateKey, incidents });
  }
  return days;
}

function fmtDate(d) {
  return d.toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

function fmtMins(m) {
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${m % 60}min`;
}

// ── Overall ───────────────────────────────────────────────────────────────────
const anyDown     = sites.some(s => s.status === 'down');
const anyDegraded = sites.some(s => s.status !== 'up' && s.status !== 'down');
const allUp       = sites.length > 0 && !anyDown && !anyDegraded;

const overallText = allUp       ? 'Todos os sistemas operacionais'
                  : anyDown     ? 'Alguns sistemas indisponiveis'
                  : sites.length === 0 ? 'Aguardando verificacao inicial'
                  :               'Alguns sistemas com degradacao';
const overallCls  = allUp ? 'ov-up' : anyDown ? 'ov-down' : 'ov-deg';

// ── Timestamp ─────────────────────────────────────────────────────────────────
const nowStr = new Date().toLocaleString('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit',
});

// ── Service rows ──────────────────────────────────────────────────────────────
function statusLabel(s) {
  return s === 'down' ? 'Indisponivel' : s === 'degraded' ? 'Degradado' : 'Operacional';
}

function serviceRow(site) {
  const st    = site.status || 'up';
  const bars  = buildBars(site, 90);
  const upt   = uptimePct(site);

  const barsHtml = bars.map(b => {
    const cls  = b.status === 'down' ? 'b-down' : b.status === 'degraded' ? 'b-deg' : 'b-up';
    const lbl  = b.daysAgo === 0 ? 'Hoje' : `${b.daysAgo}d atras - ${b.dateKey}`;
    return `<div class="bar ${cls}" title="${lbl}"></div>`;
  }).join('');

  const statusCls = st === 'down' ? 'st-down' : st === 'degraded' ? 'st-deg' : 'st-up';

  return `
  <div class="svc-row">
    <div class="svc-top">
      <span class="svc-name">${site.name}</span>
      <span class="svc-status ${statusCls}">${statusLabel(st)}</span>
    </div>
    <div class="spark-wrap">
      <div class="spark">${barsHtml}</div>
      <div class="spark-foot">
        <span>90 dias atras</span>
        ${upt ? `<span class="upt-pct">${upt} uptime</span>` : ''}
        <span>Hoje</span>
      </div>
    </div>
  </div>`;
}

// ── Health checks ─────────────────────────────────────────────────────────────
function healthSection() {
  if (!healthFull) return '';
  const overall = (healthFull.status || '').toLowerCase();
  const isOk    = overall === 'healthy';

  const rows = (healthFull.checks || []).map(c => {
    const st    = (c.status || '').toLowerCase();
    const ok    = st === 'healthy';
    const deg   = st === 'degraded';
    const dotC  = ok ? 'b-up-dot' : deg ? 'b-deg-dot' : 'b-down-dot';
    const label = ok ? 'Operacional' : deg ? 'Degradado' : 'Problema';
    const lCls  = ok ? 'st-up' : deg ? 'st-deg' : 'st-down';
    const desc  = c.description ? ` <span class="chk-desc">${c.description}</span>` : '';
    return `<div class="chk-row">
      <div class="chk-left"><span class="chk-dot ${dotC}"></span><span class="chk-name">${c.name}</span>${desc}</div>
      <span class="${lCls}" style="font-size:13px;font-weight:600">${label}</span>
    </div>`;
  }).join('');

  if (!rows) return '';

  return `
  <div class="section-gap"></div>
  <div class="grp-header">
    <span class="grp-title">Diagnostico do Backend</span>
    <span class="svc-status ${isOk ? 'st-up' : 'st-down'}" style="font-size:12px">${isOk ? 'Healthy' : overall}</span>
  </div>
  <div class="grp-box chk-box">${rows}</div>`;
}

// ── Incident days ─────────────────────────────────────────────────────────────
function incidentDaysHtml() {
  const days = buildIncidentDays(sites, 14);
  return days.map(day => {
    const dateLabel = fmtDate(day.date);
    if (day.incidents.length === 0) {
      return `<div class="inc-day">
        <div class="inc-date">${dateLabel}</div>
        <div class="inc-none">Nenhum incidente registrado.</div>
      </div>`;
    }
    const evts = day.incidents.map(inc => `
      <div class="inc-evt">
        <div class="inc-evt-title"><span class="inc-dot"></span> ${inc.service} — Indisponibilidade</div>
        <div class="inc-evt-body">
          <div class="inc-line"><span class="inc-tag inc-resolved">Resolvido</span> Servico retornou ao normal apos ${fmtMins(inc.minutes)} de interrupcao.</div>
        </div>
      </div>`).join('');
    return `<div class="inc-day">
      <div class="inc-date">${dateLabel}</div>
      ${evts}
    </div>`;
  }).join('');
}

// ── Active incident banner ────────────────────────────────────────────────────
const activeIncidents = sites.filter(s => s.status === 'down');
const activeBannerHtml = activeIncidents.length > 0 ? `
<div class="active-inc">
  ${activeIncidents.map(s => `
  <div class="active-inc-row">
    <span class="pulse-dot"></span>
    <strong>${s.name}</strong> esta indisponivel — nosso time foi notificado e esta trabalhando na resolucao.
  </div>`).join('')}
</div>` : '';

// ── HTML ──────────────────────────────────────────────────────────────────────
const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="refresh" content="300">
  <title>Status — ICone Academy</title>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Inter',Helvetica,sans-serif;background:#fff;color:#111827;font-size:14px;line-height:1.5}

    /* Header */
    .hdr{border-bottom:1px solid #e5e7eb;background:#fff}
    .hdr-in{max-width:680px;margin:0 auto;padding:0 24px;height:56px;display:flex;align-items:center;justify-content:space-between}
    .brand{display:flex;align-items:center;gap:8px;text-decoration:none;color:#111827}
    .brand img{width:26px;height:26px;border-radius:5px;object-fit:contain}
    .brand-name{font-size:15px;font-weight:700;letter-spacing:-.02em}
    .brand-dot{color:#9ca3af;margin:0 2px}
    .brand-sub{font-size:14px;color:#6b7280;font-weight:400}
    .hdr-link{font-size:13px;color:#6b7280;text-decoration:none;padding:6px 12px;border:1px solid #e5e7eb;border-radius:6px;transition:background .15s}
    .hdr-link:hover{background:#f9fafb}

    /* Page */
    .page{max-width:680px;margin:0 auto;padding:32px 24px 80px}

    /* Overall */
    .overall{border-radius:10px;padding:20px 22px;margin-bottom:32px;display:flex;align-items:center;gap:14px}
    .ov-up  {background:#f0fdf4;border:1px solid #bbf7d0}
    .ov-down{background:#fef2f2;border:1px solid #fecaca}
    .ov-deg {background:#fffbeb;border:1px solid #fde68a}
    .ov-unk {background:#f9fafb;border:1px solid #e5e7eb}
    .ov-icon{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:800;flex-shrink:0}
    .ov-up   .ov-icon{background:#dcfce7;color:#16a34a}
    .ov-down .ov-icon{background:#fee2e2;color:#dc2626}
    .ov-deg  .ov-icon{background:#fef3c7;color:#d97706}
    .ov-unk  .ov-icon{background:#e5e7eb;color:#9ca3af}
    .ov-text{font-size:18px;font-weight:700;flex:1}
    .ov-up   .ov-text{color:#15803d}
    .ov-down .ov-text{color:#dc2626}
    .ov-deg  .ov-text{color:#d97706}
    .pulse{width:9px;height:9px;border-radius:50%;flex-shrink:0}
    .ov-up .pulse{background:#22c55e;animation:pls 2s infinite}
    .ov-down .pulse{background:#ef4444}
    .ov-deg  .pulse{background:#f59e0b}
    @keyframes pls{0%{box-shadow:0 0 0 0 rgba(34,197,94,.45)}70%{box-shadow:0 0 0 8px transparent}100%{box-shadow:0 0 0 0 transparent}}

    /* Active incident */
    .active-inc{background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:14px 18px;margin-bottom:24px}
    .active-inc-row{display:flex;align-items:flex-start;gap:10px;font-size:14px;color:#991b1b}
    .pulse-dot{width:8px;height:8px;border-radius:50%;background:#ef4444;flex-shrink:0;margin-top:4px;animation:pld 1.5s infinite}
    @keyframes pld{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,.45)}50%{box-shadow:0 0 0 6px transparent}}

    /* Group */
    .grp-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;padding:0 2px}
    .grp-title{font-size:13px;font-weight:600;color:#374151}
    .grp-sub{font-size:12px;color:#9ca3af}
    .grp-box{border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin-bottom:8px}
    .section-gap{height:28px}

    /* Service row */
    .svc-row{padding:16px 20px;border-bottom:1px solid #f3f4f6}
    .svc-row:last-child{border-bottom:none}
    .svc-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
    .svc-name{font-size:14px;font-weight:600;color:#111827}
    .svc-status{font-size:13px;font-weight:500}
    .st-up  {color:#15803d}
    .st-down{color:#dc2626}
    .st-deg {color:#d97706}

    /* Sparkline */
    .spark{display:flex;gap:2px;height:28px}
    .bar{flex:1;border-radius:2px;min-width:2px;cursor:default;transition:opacity .1s}
    .bar:hover{opacity:.6}
    .b-up  {background:#bbf7d0}
    .b-down{background:#fca5a5}
    .b-deg {background:#fde68a}
    .spark-foot{display:flex;justify-content:space-between;align-items:center;margin-top:5px;font-size:11px;color:#9ca3af}
    .upt-pct{color:#6b7280;font-weight:500}

    /* Health checks */
    .chk-box .chk-row{display:flex;align-items:center;justify-content:space-between;padding:12px 20px;border-bottom:1px solid #f3f4f6;gap:12px}
    .chk-box .chk-row:last-child{border-bottom:none}
    .chk-left{display:flex;align-items:center;gap:8px;flex:1;min-width:0}
    .chk-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
    .b-up-dot  {background:#16a34a}
    .b-down-dot{background:#dc2626}
    .b-deg-dot {background:#d97706}
    .chk-name{font-size:13px;font-weight:500;text-transform:capitalize}
    .chk-desc{font-size:12px;color:#9ca3af;margin-left:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

    /* Incidents */
    .inc-section-title{font-size:16px;font-weight:700;margin-bottom:20px;margin-top:36px;padding-top:32px;border-top:1px solid #e5e7eb}
    .inc-day{margin-bottom:24px}
    .inc-date{font-size:13px;font-weight:600;color:#374151;margin-bottom:8px}
    .inc-none{font-size:13px;color:#9ca3af;padding-left:0}
    .inc-evt{border-left:2px solid #e5e7eb;padding-left:14px;margin-bottom:10px}
    .inc-evt-title{font-size:13px;font-weight:600;color:#111827;margin-bottom:6px;display:flex;align-items:center;gap:6px}
    .inc-dot{width:7px;height:7px;border-radius:50%;background:#ef4444;flex-shrink:0}
    .inc-line{font-size:13px;color:#4b5563;margin-bottom:4px;display:flex;align-items:flex-start;gap:7px}
    .inc-tag{font-size:11px;font-weight:600;padding:1px 7px;border-radius:99px;white-space:nowrap;flex-shrink:0}
    .inc-resolved{background:#dcfce7;color:#15803d}
    .inc-invest  {background:#fee2e2;color:#991b1b}

    /* Footer */
    footer{border-top:1px solid #f3f4f6;padding:24px;text-align:center;font-size:12px;color:#9ca3af}
    footer a{color:#6b7280;text-decoration:none}
    footer a:hover{text-decoration:underline}
    .fdot{margin:0 7px}

    @media(max-width:560px){.page{padding:20px 14px 60px}.hdr-in{padding:0 14px}.spark-foot{font-size:10px}}
  </style>
</head>
<body>

<div class="hdr">
  <div class="hdr-in">
    <a class="brand" href="https://icone.academy" target="_blank" rel="noopener">
      ${logoDataUrl ? `<img src="${logoDataUrl}" alt="ICone Academy">` : ''}
      <span class="brand-name">ICone Academy</span>
      <span class="brand-dot">&middot;</span>
      <span class="brand-sub">Status</span>
    </a>
    <a class="hdr-link" href="https://icone.academy" target="_blank" rel="noopener">Ir para a plataforma &rarr;</a>
  </div>
</div>

<div class="page">

  <div class="overall ${overallCls}">
    <div class="ov-icon">${allUp ? '&#10003;' : anyDown ? '!' : sites.length === 0 ? '&middot;' : '~'}</div>
    <div class="ov-text">${overallText}</div>
    <div class="pulse"></div>
  </div>

  ${activeBannerHtml}

  <div class="grp-header">
    <span class="grp-title">Servicos</span>
    <span class="grp-sub">Uptime nos ultimos 90 dias.</span>
  </div>
  <div class="grp-box">
    ${sites.length > 0 ? sites.map(serviceRow).join('') : '<div class="svc-row" style="color:#9ca3af;padding:20px">Aguardando dados...</div>'}
  </div>

  ${healthSection()}

  <h2 class="inc-section-title">Incidentes Recentes</h2>
  ${incidentDaysHtml()}

</div>

<footer>
  Atualizado em ${nowStr} (BRT)
  <span class="fdot">&middot;</span>
  Monitorado com <a href="https://upptime.js.org" target="_blank" rel="noopener">Upptime</a>
  <span class="fdot">&middot;</span>
  <a href="https://icone.academy" target="_blank" rel="noopener">ICone Academy</a>
</footer>

</body>
</html>`;

fs.mkdirSync('_site', { recursive: true });
fs.writeFileSync('_site/index.html', html);
fs.writeFileSync('_site/CNAME', 'status.icone.academy');

console.log('Site gerado. Servicos:', sites.map(s => `${s.name}:${s.status}`).join(', ') || 'nenhum');
if (healthFull) console.log('Health checks:', (healthFull.checks || []).map(c => `${c.name}:${c.status}`).join(', '));
