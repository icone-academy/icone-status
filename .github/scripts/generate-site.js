// generate-site.js — Status page generator
const fs = require('fs');
const path = require('path');

// ── Data ──────────────────────────────────────────────────────────────────────
let sites = [];
let incidents = [];

try {
  const raw = fs.readFileSync('history/summary.json', 'utf8');
  const data = JSON.parse(raw);
  sites = Array.isArray(data) ? data : (data.sites || []);
} catch (_) {}

// Collect incidents from open GitHub Issues (history/*.yml "down" events)
// We read each history yml and extract downtime intervals
function parseHistory(slug) {
  const file = `history/${slug}.yml`;
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const lines = raw.split('\n').filter(l => l.trim());
    const events = [];
    let current = {};
    for (const line of lines) {
      const m = line.match(/^\s*-\s+(status|startTime|endTime|duration|downDuration):\s+(.+)$/);
      if (!m) continue;
      const [, k, v] = m;
      if (k === 'status') {
        if (current.status) events.push(current);
        current = { status: v.trim() };
      } else {
        current[k] = v.trim();
      }
    }
    if (current.status) events.push(current);
    return events;
  } catch (_) { return []; }
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ── Logo (base64 embedded) ─────────────────────────────────────────────────
let logoDataUrl = '';
try {
  const b64 = fs.readFileSync(path.join(__dirname, 'logo.b64'), 'utf8').trim();
  logoDataUrl = `data:image/png;base64,${b64}`;
} catch (_) {}

const logoHtml = logoDataUrl
  ? `<img src="${logoDataUrl}" alt="Ícone Academy" class="logo-img">`
  : `<span class="logo-text">Ícone</span>`;

// ── Helpers ────────────────────────────────────────────────────────────────────
const STATUS = {
  up:       { label: 'Operacional',   cls: 'up',       dot: '🟢' },
  down:     { label: 'Indisponível',  cls: 'down',     dot: '🔴' },
  degraded: { label: 'Degradado',    cls: 'degraded', dot: '🟡' },
};

function fmtMs(ms) {
  if (!ms && ms !== 0) return null;
  const n = Number(ms);
  if (n >= 1000) return (n / 1000).toFixed(2) + ' s';
  return n + ' ms';
}

function fmtUptime(val) {
  if (val === undefined || val === null || val === '') return null;
  const s = String(val);
  return s.endsWith('%') ? s : s + '%';
}

// Build 90-day bar sparkline from history file
function buildSparkline(slug) {
  const events = parseHistory(slug);
  // Default: 90 days of green bars
  const days = 90;
  const bars = Array(days).fill('up');

  for (const e of events) {
    if (e.status === 'down' && e.startTime) {
      try {
        const d = new Date(e.startTime);
        const today = new Date();
        const diff = Math.floor((today - d) / 86400000);
        if (diff >= 0 && diff < days) {
          bars[days - 1 - diff] = 'down';
        }
      } catch (_) {}
    }
  }
  return bars;
}

function sparklineHtml(bars) {
  return bars.map((s, i) => {
    const cls = s === 'down' ? 'bar bar-down' : s === 'degraded' ? 'bar bar-degraded' : 'bar bar-up';
    const daysAgo = bars.length - 1 - i;
    const label = daysAgo === 0 ? 'Hoje' : `${daysAgo} dias atrás`;
    return `<div class="${cls}" title="${label}"></div>`;
  }).join('');
}

// ── Overall status ─────────────────────────────────────────────────────────────
const anyDown     = sites.some(s => s.status === 'down');
const anyDegraded = sites.some(s => s.status !== 'up' && s.status !== 'down');
const allUp       = sites.length > 0 && !anyDown && !anyDegraded;

const overall = allUp
  ? { cls: 'up',       icon: '✓', title: 'Todos os sistemas operacionais', sub: 'Todos os serviços estão funcionando normalmente.' }
  : anyDown
  ? { cls: 'down',     icon: '!', title: 'Alguns sistemas estão fora do ar', sub: 'Estamos trabalhando para resolver o problema.' }
  : sites.length === 0
  ? { cls: 'unknown',  icon: '·', title: 'Aguardando primeira verificação', sub: 'O monitoramento vai iniciar em até 5 minutos.' }
  : { cls: 'degraded', icon: '~', title: 'Sistemas com degradação', sub: 'Alguns serviços podem estar lentos.' };

// ── Service cards ──────────────────────────────────────────────────────────────
function serviceCard(site) {
  const st = STATUS[site.status] || STATUS.up;
  const uptimeDay   = fmtUptime(site.uptimeDay   ?? site.uptime);
  const uptimeWeek  = fmtUptime(site.uptimeWeek);
  const uptimeMonth = fmtUptime(site.uptimeMonth);
  const ms          = fmtMs(site.timeDay ?? site.time);
  const slug        = slugify(site.name || site.url);
  const bars        = buildSparkline(slug);
  const sparkline   = sparklineHtml(bars);

  const statsHtml = [
    uptimeDay   ? `<div class="stat"><span class="stat-val">${uptimeDay}</span><span class="stat-key">Hoje</span></div>` : '',
    uptimeWeek  ? `<div class="stat"><span class="stat-val">${uptimeWeek}</span><span class="stat-key">7 dias</span></div>` : '',
    uptimeMonth ? `<div class="stat"><span class="stat-val">${uptimeMonth}</span><span class="stat-key">30 dias</span></div>` : '',
    ms          ? `<div class="stat"><span class="stat-val">${ms}</span><span class="stat-key">Resposta</span></div>` : '',
  ].filter(Boolean).join('\n');

  return `
  <div class="card">
    <div class="card-header">
      <div class="card-title-row">
        <span class="card-name">${site.name || site.url}</span>
        <span class="badge badge-${st.cls}">${st.label}</span>
      </div>
      <a class="card-url" href="${site.url}" target="_blank" rel="noopener">${site.url}</a>
    </div>
    ${statsHtml ? `<div class="card-stats">${statsHtml}</div>` : ''}
    <div class="sparkline-wrap">
      <div class="sparkline">${sparkline}</div>
      <div class="sparkline-legend">
        <span>90 dias atrás</span>
        <span>Hoje</span>
      </div>
    </div>
  </div>`;
}

const cardsHtml = sites.length > 0
  ? sites.map(serviceCard).join('\n')
  : `<div class="card card-empty"><p>Aguardando dados de monitoramento&hellip;</p></div>`;

// ── Incident section (open GitHub Issues) ─────────────────────────────────────
// Check if any service is down to show active incident
const downServices = sites.filter(s => s.status === 'down');
const incidentHtml = downServices.length > 0 ? `
<section class="section">
  <h2 class="section-title">Incidentes Ativos</h2>
  ${downServices.map(s => `
  <div class="incident">
    <div class="incident-header">
      <span class="incident-dot"></span>
      <strong>${s.name || s.url} — Indisponível</strong>
      <span class="incident-time">Em andamento</span>
    </div>
    <p class="incident-desc">Monitorando e investigando o problema.</p>
  </div>`).join('')}
</section>` : '';

// ── Timestamp ─────────────────────────────────────────────────────────────────
const now = new Date().toLocaleString('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit',
});

// ── HTML ──────────────────────────────────────────────────────────────────────
const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="300">
  <title>Status — Ícone Academy</title>
  <meta name="description" content="Acompanhe o status em tempo real dos serviços da Ícone Academy.">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #0f1117;
      --surface: #16181f;
      --surface2: #1e2029;
      --border: #2a2d38;
      --text: #e8eaf0;
      --text-muted: #6b7280;
      --text-dim: #9ca3af;
      --up: #22c55e;
      --up-bg: #052e16;
      --up-text: #86efac;
      --down: #ef4444;
      --down-bg: #450a0a;
      --down-text: #fca5a5;
      --degraded: #f59e0b;
      --degraded-bg: #451a03;
      --degraded-text: #fcd34d;
      --accent: #6366f1;
      --radius: 10px;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      font-size: 15px;
      line-height: 1.6;
    }

    /* ── Header ── */
    header {
      border-bottom: 1px solid var(--border);
      background: var(--bg);
      position: sticky;
      top: 0;
      z-index: 10;
      backdrop-filter: blur(8px);
    }
    .header-inner {
      max-width: 860px;
      margin: 0 auto;
      padding: 0 24px;
      height: 58px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .header-brand {
      display: flex;
      align-items: center;
      gap: 10px;
      text-decoration: none;
      color: var(--text);
    }
    .logo-img {
      width: 30px;
      height: 30px;
      object-fit: contain;
      border-radius: 6px;
    }
    .logo-text {
      font-size: 17px;
      font-weight: 700;
      letter-spacing: -.03em;
    }
    .brand-label {
      font-size: 14px;
      font-weight: 500;
      color: var(--text-dim);
    }
    .header-link {
      font-size: 13px;
      color: var(--text-muted);
      text-decoration: none;
      transition: color .15s;
    }
    .header-link:hover { color: var(--text); }

    /* ── Layout ── */
    .page { max-width: 860px; margin: 0 auto; padding: 40px 24px 80px; }

    /* ── Overall banner ── */
    .overall {
      border-radius: var(--radius);
      padding: 20px 24px;
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 40px;
      border: 1px solid var(--border);
    }
    .overall.up       { background: linear-gradient(135deg, #052e16 0%, #0a1a2e 100%); border-color: #166534; }
    .overall.down     { background: linear-gradient(135deg, #450a0a 0%, #1a0a14 100%); border-color: #7f1d1d; }
    .overall.degraded { background: linear-gradient(135deg, #451a03 0%, #1a1408 100%); border-color: #78350f; }
    .overall.unknown  { background: var(--surface); }

    .overall-icon {
      width: 36px; height: 36px;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; font-weight: 700; flex-shrink: 0;
    }
    .overall.up       .overall-icon { background: var(--up);       color: #fff; }
    .overall.down     .overall-icon { background: var(--down);     color: #fff; }
    .overall.degraded .overall-icon { background: var(--degraded); color: #fff; }
    .overall.unknown  .overall-icon { background: var(--surface2); color: var(--text-muted); }

    .overall-body { flex: 1; }
    .overall-title { font-size: 17px; font-weight: 700; margin-bottom: 2px; }
    .overall-sub { font-size: 13px; color: var(--text-dim); }

    .overall-pulse {
      width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0;
      animation: pulse 2s infinite;
    }
    .overall.up       .overall-pulse { background: var(--up); box-shadow: 0 0 0 0 rgba(34,197,94,.4); }
    .overall.down     .overall-pulse { background: var(--down); box-shadow: 0 0 0 0 rgba(239,68,68,.4); animation: none; }
    .overall.degraded .overall-pulse { background: var(--degraded); }
    .overall.unknown  .overall-pulse { background: var(--text-muted); animation: none; }
    @keyframes pulse {
      0%   { box-shadow: 0 0 0 0 rgba(34,197,94,.4); }
      70%  { box-shadow: 0 0 0 8px rgba(34,197,94,0); }
      100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); }
    }

    /* ── Section ── */
    .section { margin-bottom: 40px; }
    .section-title {
      font-size: 11px;
      font-weight: 600;
      letter-spacing: .1em;
      text-transform: uppercase;
      color: var(--text-muted);
      margin-bottom: 12px;
    }

    /* ── Service card ── */
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 20px 22px;
      margin-bottom: 10px;
      transition: border-color .15s;
    }
    .card:hover { border-color: #3a3d4a; }
    .card-empty {
      color: var(--text-muted);
      font-size: 14px;
      text-align: center;
      padding: 32px;
    }
    .card-header { margin-bottom: 14px; }
    .card-title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 4px;
    }
    .card-name { font-weight: 600; font-size: 15px; }
    .card-url { font-size: 12px; color: var(--text-muted); text-decoration: none; }
    .card-url:hover { color: var(--text-dim); text-decoration: underline; }

    /* ── Badge ── */
    .badge {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 2px 9px; border-radius: 99px;
      font-size: 12px; font-weight: 500; white-space: nowrap;
      flex-shrink: 0;
    }
    .badge::before { content: ''; width: 6px; height: 6px; border-radius: 50%; }
    .badge-up       { background: var(--up-bg);       color: var(--up-text); }
    .badge-up::before { background: var(--up); }
    .badge-down     { background: var(--down-bg);     color: var(--down-text); }
    .badge-down::before { background: var(--down); }
    .badge-degraded { background: var(--degraded-bg); color: var(--degraded-text); }
    .badge-degraded::before { background: var(--degraded); }

    /* ── Stats row ── */
    .card-stats {
      display: flex;
      gap: 20px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }
    .stat { display: flex; flex-direction: column; }
    .stat-val { font-size: 14px; font-weight: 600; color: var(--text); }
    .stat-key { font-size: 11px; color: var(--text-muted); margin-top: 1px; }

    /* ── Sparkline ── */
    .sparkline-wrap { }
    .sparkline {
      display: flex;
      gap: 2px;
      height: 28px;
      align-items: flex-end;
    }
    .bar {
      flex: 1;
      height: 100%;
      border-radius: 2px;
      min-width: 2px;
      transition: opacity .15s;
      cursor: default;
    }
    .bar:hover { opacity: .7; }
    .bar-up       { background: #16a34a; }
    .bar-down     { background: var(--down); }
    .bar-degraded { background: var(--degraded); }
    .sparkline-legend {
      display: flex;
      justify-content: space-between;
      margin-top: 5px;
      font-size: 11px;
      color: var(--text-muted);
    }

    /* ── Incident ── */
    .incident {
      background: #1f0a0a;
      border: 1px solid #7f1d1d;
      border-radius: var(--radius);
      padding: 16px 20px;
      margin-bottom: 10px;
    }
    .incident-header {
      display: flex; align-items: center; gap: 10px;
      margin-bottom: 6px; font-size: 14px;
    }
    .incident-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: var(--down); flex-shrink: 0;
      animation: pulse-red 1.5s infinite;
    }
    @keyframes pulse-red {
      0%,100% { box-shadow: 0 0 0 0 rgba(239,68,68,.5); }
      50% { box-shadow: 0 0 0 6px rgba(239,68,68,0); }
    }
    .incident-time { margin-left: auto; font-size: 12px; color: var(--text-muted); }
    .incident-desc { font-size: 13px; color: var(--text-dim); padding-left: 18px; }

    /* ── Footer ── */
    footer {
      border-top: 1px solid var(--border);
      text-align: center;
      padding: 28px 24px;
      font-size: 12px;
      color: var(--text-muted);
    }
    footer a { color: var(--text-dim); text-decoration: none; }
    footer a:hover { text-decoration: underline; }
    .footer-dot { margin: 0 8px; opacity: .4; }

    /* ── Responsive ── */
    @media (max-width: 560px) {
      .card-title-row { flex-wrap: wrap; }
      .card-stats { gap: 14px; }
      .page { padding: 24px 16px 60px; }
    }
  </style>
</head>
<body>

<header>
  <div class="header-inner">
    <a href="https://icone.academy" class="header-brand" target="_blank" rel="noopener">
      ${logoHtml}
      <span class="logo-text">Ícone Academy</span>
    </a>
    <a href="https://icone.academy" class="header-link" target="_blank" rel="noopener">
      Ir para a plataforma →
    </a>
  </div>
</header>

<main>
  <div class="page">

    <div class="overall ${overall.cls}">
      <div class="overall-icon">${overall.icon}</div>
      <div class="overall-body">
        <div class="overall-title">${overall.title}</div>
        <div class="overall-sub">${overall.sub}</div>
      </div>
      <div class="overall-pulse"></div>
    </div>

    ${incidentHtml}

    <section class="section">
      <p class="section-title">Serviços</p>
      ${cardsHtml}
    </section>

  </div>
</main>

<footer>
  Atualizado em ${now} (BRT)
  <span class="footer-dot">·</span>
  Monitorado com <a href="https://upptime.js.org" target="_blank" rel="noopener">Upptime</a>
  <span class="footer-dot">·</span>
  <a href="https://icone.academy" target="_blank" rel="noopener">Ícone Academy</a>
</footer>

</body>
</html>`;

fs.mkdirSync('_site', { recursive: true });
fs.writeFileSync('_site/index.html', html);
fs.writeFileSync('_site/CNAME', 'status.icone.academy');

console.log('✅ Site gerado em _site/index.html');
if (sites.length > 0) {
  console.log('Serviços:', sites.map(s => `${s.name}: ${s.status}`).join(', '));
} else {
  console.log('Nenhum serviço encontrado em history/summary.json');
}
