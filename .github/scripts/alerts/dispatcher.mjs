import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCurrentStatus, parseHistoryYaml } from "../status/data.mjs";
import { SERVICE_BY_SLUG } from "../status/services.mjs";

const STATUS_PAGE_URL = "https://status.icone.academy";
const ALERT_LABEL_COLOR = "7A6A5A";
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function issueLabels(issue) {
  return (issue.labels ?? [])
    .map((label) => typeof label === "string" ? label : label?.name)
    .filter(Boolean);
}

function issueService(issue) {
  const labels = issueLabels(issue);
  const slug = labels.find((label) => SERVICE_BY_SLUG.has(label));
  return slug ? SERVICE_BY_SLUG.get(slug) : null;
}

function issueKind(issue) {
  return /degraded|degrada|performance/i.test(String(issue.title ?? "")) ? "degraded" : "down";
}

export function transitionLabel(transition) {
  return `alert:${transition}-notified`;
}

export function channelLabel(channel, transition) {
  return `alert:${channel}-${transition}-sent`;
}

export function determineTransition(issue, { now = new Date(), currentHistory = null } = {}) {
  const labels = issueLabels(issue);
  if (!labels.includes("status")) return null;
  const state = String(issue.state ?? "").toLowerCase();
  const kind = issueKind(issue);

  if (state === "closed") {
    const wasNotified = labels.includes(transitionLabel("down"))
      || labels.includes(transitionLabel("degraded"));
    return wasNotified && !labels.includes(transitionLabel("recovery")) ? "recovery" : null;
  }

  if (state !== "open" || labels.includes(transitionLabel(kind))) return null;
  if (kind === "down") return "down";

  const createdAt = new Date(issue.created_at ?? issue.createdAt);
  const checkedAt = currentHistory ? new Date(currentHistory.lastUpdated) : null;
  const wasConfirmedOnNextCheck = currentHistory
    && normalizeCurrentStatus(currentHistory, now) === "degraded"
    && Number.isFinite(createdAt.getTime())
    && checkedAt
    && Number.isFinite(checkedAt.getTime())
    && checkedAt.getTime() >= createdAt.getTime() + (4 * 60 * 1000);

  return wasConfirmedOnNextCheck ? "degraded" : null;
}

export async function withRetry(action, {
  attempts = 4,
  wait = sleep,
  baseDelayMs = 1_000,
} = {}) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await action(attempt + 1);
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await wait(baseDelayMs * (2 ** attempt));
    }
  }
  throw lastError;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function stateCopy(transition) {
  if (transition === "down") return { subject: "Indisponibilidade", state: "indisponível", color: "#C2410C" };
  if (transition === "degraded") return { subject: "Degradação", state: "degradado", color: "#B7791F" };
  return { subject: "Recuperação", state: "operacional novamente", color: "#2F855A" };
}

export function buildAlert({ service, transition, issue = null, now = new Date(), test = false }) {
  const copy = stateCopy(transition);
  const prefix = test ? "[TESTE] " : "";
  const issueUrl = issue?.html_url ?? issue?.url ?? null;
  const checkedAt = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(now);
  const issueLine = issueUrl ? `\nIssue: ${issueUrl}` : "";
  const text = `${prefix}Ícone Status\nServiço: ${service.name}\nEstado: ${copy.state}\nHorário: ${checkedAt}\nComponente: ${service.description}\nStatus: ${STATUS_PAGE_URL}${issueLine}`;

  return {
    subject: `${prefix}[Ícone Status] ${copy.subject}: ${service.name}`,
    text,
    html: `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#F8F6F2;font-family:Arial,sans-serif;color:#344054"><div style="max-width:620px;margin:0 auto;padding:32px 20px"><div style="background:#fff;border:1px solid #DDD6CC;border-radius:18px;padding:28px"><p style="margin:0 0 12px;color:#7A6A5A;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">${escapeHtml(prefix)}Ícone Status</p><h1 style="margin:0 0 18px;color:#1F2933;font-size:24px">${escapeHtml(service.name)} está <span style="color:${copy.color}">${escapeHtml(copy.state)}</span></h1><table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px"><tr><td style="padding:8px 0;color:#667085">Horário</td><td style="padding:8px 0;text-align:right">${escapeHtml(checkedAt)}</td></tr><tr><td style="padding:8px 0;color:#667085">Componente</td><td style="padding:8px 0;text-align:right">${escapeHtml(service.description)}</td></tr></table><p style="margin:24px 0 0"><a href="${STATUS_PAGE_URL}" style="color:#6B5C4E;font-weight:700">Abrir página de status</a>${issueUrl ? ` &nbsp;·&nbsp; <a href="${escapeHtml(issueUrl)}" style="color:#6B5C4E;font-weight:700">Abrir Issue</a>` : ""}</p></div></div></body></html>`,
  };
}

function parseRecipients(value) {
  return String(value ?? "").split(/[;,]/).map((recipient) => recipient.trim()).filter(Boolean);
}

export function loadChannelConfiguration(environment = process.env) {
  const recipients = parseRecipients(environment.ALERT_EMAIL_TO);
  const emailValues = [environment.RESEND_API_KEY, environment.ALERT_EMAIL_FROM, recipients.length > 0 ? "configured" : ""];
  const telegramValues = [environment.TELEGRAM_BOT_TOKEN, environment.TELEGRAM_CHAT_ID];
  const emailAny = emailValues.some(Boolean);
  const telegramAny = telegramValues.some(Boolean);
  const emailComplete = emailValues.every(Boolean);
  const telegramComplete = telegramValues.every(Boolean);

  if ((emailAny && !emailComplete) || (telegramAny && !telegramComplete)) {
    throw new Error("Configuração parcial de alertas. Complete todos os secrets de Resend e Telegram.");
  }

  return {
    email: emailComplete ? {
      apiKey: environment.RESEND_API_KEY,
      from: environment.ALERT_EMAIL_FROM,
      to: recipients,
    } : null,
    telegram: telegramComplete ? {
      botToken: environment.TELEGRAM_BOT_TOKEN,
      chatId: environment.TELEGRAM_CHAT_ID,
    } : null,
  };
}

async function sendEmail(config, alert, idempotencyKey, fetchImpl = fetch) {
  const response = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      from: config.from,
      to: config.to,
      subject: alert.subject,
      html: alert.html,
      text: alert.text,
    }),
  });
  if (!response.ok) throw new Error(`Resend respondeu ${response.status}.`);
}

async function sendTelegram(config, alert, fetchImpl = fetch) {
  const response = await fetchImpl(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: config.chatId,
      text: alert.text,
      disable_web_page_preview: true,
    }),
  });
  if (!response.ok) throw new Error(`Telegram respondeu ${response.status}.`);
}

function githubClient({ repository, token, fetchImpl = fetch }) {
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "icone-academy-alert-dispatcher",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const request = async (apiPath, options = {}) => {
    const response = await fetchImpl(`https://api.github.com/repos/${repository}${apiPath}`, {
      ...options,
      headers: { ...headers, ...options.headers },
    });
    if (!response.ok) throw new Error(`GitHub ${apiPath} respondeu ${response.status}.`);
    if (response.status === 204) return null;
    return response.json();
  };
  return {
    request,
    async ensureLabel(name) {
      const response = await fetchImpl(`https://api.github.com/repos/${repository}/labels`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name, color: ALERT_LABEL_COLOR, description: "Controle interno de idempotência dos alertas" }),
      });
      if (!response.ok && response.status !== 422) throw new Error(`GitHub labels respondeu ${response.status}.`);
    },
    async addLabel(issueNumber, name) {
      await this.ensureLabel(name);
      return request(`/issues/${issueNumber}/labels`, {
        method: "POST",
        body: JSON.stringify({ labels: [name] }),
      });
    },
  };
}

function readHistory(root, service) {
  try {
    return parseHistoryYaml(fs.readFileSync(path.join(root, "history", `${service.slug}.yml`), "utf8"));
  } catch {
    return null;
  }
}

async function deliverIssueAlert({ issue, transition, service, channels, github, now, fetchImpl }) {
  const labels = new Set(issueLabels(issue));
  const alert = buildAlert({ service, transition, issue, now });
  const errors = [];
  const deliveries = [];

  if (channels.email && !labels.has(channelLabel("email", transition))) {
    deliveries.push(withRetry(
      () => sendEmail(channels.email, alert, `icone-status-${issue.number}-${transition}`, fetchImpl),
    ).then(() => github.addLabel(issue.number, channelLabel("email", transition)))
      .catch((error) => errors.push(error)));
  }
  if (channels.telegram && !labels.has(channelLabel("telegram", transition))) {
    deliveries.push(withRetry(
      () => sendTelegram(channels.telegram, alert, fetchImpl),
    ).then(() => github.addLabel(issue.number, channelLabel("telegram", transition)))
      .catch((error) => errors.push(error)));
  }

  await Promise.all(deliveries);
  if (errors.length > 0) throw new AggregateError(errors, `Falha ao enviar alerta ${transition} da Issue #${issue.number}.`);
  await github.addLabel(issue.number, transitionLabel(transition));
}

async function sendTestAlert({ channels, now, fetchImpl = fetch, runId = Date.now() }) {
  if (!channels.email || !channels.telegram) {
    throw new Error("O teste exige Resend e Telegram completamente configurados.");
  }
  const service = {
    name: "Monitoramento de produção",
    description: "Canal de alertas operacionais",
  };
  const alert = buildAlert({ service, transition: "recovery", now, test: true });
  await Promise.all([
    withRetry(() => sendEmail(channels.email, alert, `icone-status-test-${runId}`, fetchImpl)),
    withRetry(() => sendTelegram(channels.telegram, alert, fetchImpl)),
  ]);
}

export async function runDispatcher({
  environment = process.env,
  root = process.cwd(),
  now = new Date(),
  fetchImpl = fetch,
} = {}) {
  const channels = loadChannelConfiguration(environment);
  const isTest = String(environment.ALERT_TEST).toLowerCase() === "true";
  if (isTest) {
    await sendTestAlert({ channels, now, fetchImpl, runId: environment.GITHUB_RUN_ID });
    return { tested: true, processed: 0 };
  }

  if (!channels.email && !channels.telegram) {
    process.stdout.write("Alertas ainda não configurados; nenhuma mensagem enviada.\n");
    return { tested: false, processed: 0 };
  }
  if (!channels.email || !channels.telegram) {
    throw new Error("Os alertas operacionais exigem Resend e Telegram completamente configurados.");
  }

  const repository = environment.GITHUB_REPOSITORY ?? "icone-academy/icone-status";
  const token = environment.GH_TOKEN ?? environment.GITHUB_TOKEN;
  if (!token) throw new Error("GH_TOKEN é obrigatório para idempotência por labels.");
  const github = githubClient({ repository, token, fetchImpl });
  const issueNumber = Number(environment.ALERT_ISSUE_NUMBER);
  const issues = Number.isFinite(issueNumber) && issueNumber > 0
    ? [await github.request(`/issues/${issueNumber}`)]
    : await github.request("/issues?state=all&labels=status&per_page=100&sort=updated&direction=desc");

  let processed = 0;
  for (const issue of issues) {
    const service = issueService(issue);
    if (!service) continue;
    const transition = determineTransition(issue, {
      now,
      currentHistory: readHistory(root, service),
    });
    if (!transition) continue;
    await deliverIssueAlert({ issue, transition, service, channels, github, now, fetchImpl });
    processed += 1;
  }

  return { tested: false, processed };
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  const result = await runDispatcher();
  process.stdout.write(`${result.tested ? "Teste concluído" : `${result.processed} transição(ões) processada(s)`}.\n`);
}
