import { SERVICE_GROUPS } from "./services.mjs";

const STATUS = {
  operational: { label: "Operacional", summary: "Todos os sistemas estão operacionais" },
  degraded: { label: "Degradado", summary: "Alguns sistemas estão com degradação" },
  down: { label: "Indisponível", summary: "Alguns sistemas estão indisponíveis" },
  unknown: { label: "Status desconhecido", summary: "Não foi possível confirmar todos os sistemas" },
};

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function statusMeta(status) {
  return STATUS[status] ?? STATUS.unknown;
}

function formatDateTime(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return "Não disponível";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(value);
}

function formatLongDate(value) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function formatBarDate(value) {
  const date = new Date(`${value}T12:00:00-03:00`);
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatDuration(startedAt, resolvedAt, now) {
  const milliseconds = Math.max(0, (resolvedAt ?? now).getTime() - startedAt.getTime());
  const minutes = Math.round(milliseconds / 60_000);
  if (minutes < 1) return "menos de 1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 24) return remainder ? `${hours}h ${remainder}min` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours ? `${days}d ${remainingHours}h` : `${days}d`;
}

function renderBars(service) {
  const counts = service.days.reduce((result, day) => {
    result[day.status] = (result[day.status] ?? 0) + 1;
    return result;
  }, {});
  const ariaLabel = `Histórico de 90 dias de ${service.name}: ${counts.operational ?? 0} dias operacionais, ${counts.degraded ?? 0} degradados, ${counts.down ?? 0} indisponíveis e ${counts.unknown ?? 0} desconhecidos.`;

  const bars = service.days.map((day) => {
    const meta = statusMeta(day.status);
    return `<span class="uptime-bar is-${day.status}" title="${escapeHtml(formatBarDate(day.date))}: ${escapeHtml(meta.label)}" aria-hidden="true"></span>`;
  }).join("");

  return `
    <div class="uptime-scroll" tabindex="0" aria-label="${escapeHtml(ariaLabel)}">
      <div class="uptime-bars">${bars}</div>
    </div>
    <div class="uptime-scale" aria-hidden="true">
      <span>90 dias atrás</span>
      <span>Hoje</span>
    </div>`;
}

function renderService(service) {
  const meta = statusMeta(service.status);
  const uptime = service.uptime90 == null
    ? "Aguardando histórico"
    : `${service.uptime90.toFixed(2).replace(".", ",")}% de uptime`;

  return `
    <article class="service-card" aria-labelledby="service-${escapeHtml(service.slug)}">
      <div class="service-heading">
        <div>
          <h3 id="service-${escapeHtml(service.slug)}">${escapeHtml(service.name)}</h3>
          <p>${escapeHtml(service.description)}</p>
        </div>
        <span class="status-pill is-${service.status}">
          <span class="status-dot" aria-hidden="true"></span>${escapeHtml(meta.label)}
        </span>
      </div>
      ${renderBars(service)}
      <div class="service-meta">
        <span>${escapeHtml(uptime)}</span>
        <span>Verificado em ${escapeHtml(formatDateTime(service.checkedAt))}</span>
      </div>
    </article>`;
}

function renderGroups(data) {
  return SERVICE_GROUPS.map((group) => {
    const services = data.services.filter((service) => service.group === group.key);
    return `
      <section class="service-group" aria-labelledby="group-${escapeHtml(group.key)}">
        <div class="section-heading">
          <div>
            <p class="eyebrow">Monitoramento</p>
            <h2 id="group-${escapeHtml(group.key)}">${escapeHtml(group.label)}</h2>
          </div>
          <p>${escapeHtml(group.description)}</p>
        </div>
        <div class="service-list">${services.map(renderService).join("")}</div>
      </section>`;
  }).join("");
}

function safeIssueUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" ? url.toString() : null;
  } catch {
    return null;
  }
}

function renderIncident(incident, data) {
  const stateLabel = incident.active ? "Em andamento" : "Resolvido";
  const issueUrl = safeIssueUrl(incident.url);
  const link = issueUrl
    ? `<a href="${escapeHtml(issueUrl)}" target="_blank" rel="noreferrer">Ver Issue<span class="sr-only"> no GitHub</span></a>`
    : "";
  const kindLabel = incident.kind === "degraded" ? "Degradação" : "Indisponibilidade";

  return `
    <article class="incident-card ${incident.active ? "is-active" : ""}">
      <div class="incident-topline">
        <span class="incident-state">${escapeHtml(stateLabel)}</span>
        <time datetime="${escapeHtml(incident.startedAt.toISOString())}">${escapeHtml(formatLongDate(incident.startedAt))}</time>
      </div>
      <h3>${escapeHtml(incident.serviceName)} · ${escapeHtml(kindLabel)}</h3>
      <p>
        ${incident.active
          ? "A investigação está em andamento."
          : `Resolvido em ${escapeHtml(formatDuration(incident.startedAt, incident.resolvedAt, data.generatedAt))}.`}
      </p>
      ${link}
    </article>`;
}

function renderIncidents(data) {
  const incidents = data.incidents.slice(0, 12);
  return `
    <section class="incidents" id="incidentes" aria-labelledby="incidents-title">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Transparência operacional</p>
          <h2 id="incidents-title">Incidentes recentes</h2>
        </div>
        <p>Somente ocorrências reais registradas pelo monitoramento.</p>
      </div>
      ${incidents.length
        ? `<div class="incident-list">${incidents.map((incident) => renderIncident(incident, data)).join("")}</div>`
        : `<div class="empty-state"><strong>Nenhum incidente registrado.</strong><span>O histórico aparecerá aqui quando houver uma ocorrência real.</span></div>`}
    </section>`;
}

function renderActiveIncidents(data) {
  if (data.activeIncidents.length === 0) return "";
  return `
    <aside class="active-incident" aria-label="Incidente ativo">
      <div class="active-icon" aria-hidden="true"><span></span></div>
      <div>
        <strong>Incidente em andamento</strong>
        <p>${escapeHtml(data.activeIncidents.map((incident) => incident.serviceName).join(", "))}: nossa equipe foi alertada e está acompanhando.</p>
      </div>
      <a href="#incidentes">Ver detalhes</a>
    </aside>`;
}

export function renderPage(data) {
  const overall = statusMeta(data.overallStatus);
  const checkedAt = data.lastCheckedAt
    ? `Última verificação em ${formatDateTime(data.lastCheckedAt)}`
    : "Nenhuma verificação válida nos últimos 15 minutos";
  const year = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
  }).format(data.generatedAt);

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Disponibilidade e incidentes dos serviços de produção da ICone Academy.">
  <meta name="color-scheme" content="light dark">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data:; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'">
  <title>ICone Status</title>
  <link rel="icon" href="logo-light.png" type="image/png" media="(prefers-color-scheme: light)">
  <link rel="icon" href="logo-dark.png" type="image/png" media="(prefers-color-scheme: dark)">
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <a class="skip-link" href="#conteudo">Ir para o conteúdo</a>
  <header class="site-header">
    <div class="shell header-inner">
      <a class="brand" href="https://www.icone.academy" aria-label="ICone Academy — página inicial">
        <picture>
          <source srcset="logo-dark.png" media="(prefers-color-scheme: dark)">
          <img class="brand-logo" src="logo-light.png" width="40" height="40" alt="">
        </picture>
        <span><strong>ICone</strong><small>Status</small></span>
      </a>
      <nav aria-label="Navegação principal">
        <a href="#visao-geral">Visão geral</a>
        <a href="#incidentes">Incidentes</a>
        <a class="support-link" href="mailto:suporte@icone.academy">Falar com suporte</a>
      </nav>
    </div>
  </header>

  <main id="conteudo">
    <section class="hero shell" id="visao-geral" aria-labelledby="page-title">
      <div class="hero-copy">
        <p class="eyebrow">Status dos serviços</p>
        <h1 id="page-title">Operação clara, sem ruído.</h1>
        <p>Acompanhe a disponibilidade dos produtos e das operações críticas da ICone Academy.</p>
      </div>
      <div class="overall-card is-${escapeHtml(data.overallStatus)}" role="status">
        <span class="overall-icon" aria-hidden="true"><span></span></span>
        <div>
          <strong>${escapeHtml(overall.summary)}</strong>
          <span>${escapeHtml(checkedAt)}</span>
        </div>
      </div>
      ${renderActiveIncidents(data)}
    </section>

    <div class="shell content-stack">
      ${renderGroups(data)}
      ${renderIncidents(data)}
    </div>
  </main>

  <footer class="site-footer">
    <div class="shell footer-inner">
      <p>© ${escapeHtml(year)} ICone Academy</p>
      <p>Disponibilidade verificada a cada cinco minutos com <a href="https://upptime.js.org" target="_blank" rel="noreferrer">Upptime</a>.</p>
    </div>
  </footer>
</body>
</html>`;
}
