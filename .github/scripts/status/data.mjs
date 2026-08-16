import fs from "node:fs";
import path from "node:path";
import { SERVICE_BY_SLUG, SERVICES } from "./services.mjs";

export const MAX_STATUS_AGE_MS = 15 * 60 * 1000;
const BRAZIL_TIME_ZONE = "America/Sao_Paulo";

export function parseHistoryYaml(raw) {
  if (typeof raw !== "string") return null;

  const values = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9]*):\s*(.*?)\s*$/);
    if (match) values[match[1]] = match[2];
  }

  if (!values.status || !values.lastUpdated) return null;
  return values;
}

export function normalizeCurrentStatus(
  history,
  now = new Date(),
  maxAgeMs = MAX_STATUS_AGE_MS,
  checkedAtValue = history?.lastUpdated,
) {
  if (!history) return "unknown";

  const checkedAt = new Date(checkedAtValue);
  const age = now.getTime() - checkedAt.getTime();
  if (!Number.isFinite(checkedAt.getTime()) || age > maxAgeMs || age < -maxAgeMs) return "unknown";

  const normalized = String(history.status).toLowerCase();
  if (normalized === "up") return "operational";
  if (normalized === "down") return "down";
  if (normalized === "degraded") return "degraded";
  return "unknown";
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function readHistory(root, slug) {
  try {
    return parseHistoryYaml(fs.readFileSync(path.join(root, "history", `${slug}.yml`), "utf8"));
  } catch {
    return null;
  }
}

function parseUptime(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number.parseFloat(value.replace("%", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function dateKeyInBrazil(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BRAZIL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateKeysEndingAt(now, total) {
  const cursor = new Date(`${dateKeyInBrazil(now)}T12:00:00.000Z`);
  const result = [];
  for (let offset = total - 1; offset >= 0; offset -= 1) {
    const date = new Date(cursor);
    date.setUTCDate(cursor.getUTCDate() - offset);
    result.push(dateKeyInBrazil(date));
  }
  return result;
}

export function parseIncidentIssues(issues) {
  if (!Array.isArray(issues)) return [];

  return issues.flatMap((issue) => {
    const labels = (issue.labels ?? []).map((label) => typeof label === "string" ? label : label?.name).filter(Boolean);
    if (!labels.includes("status") || issue.pull_request) return [];

    const slug = labels.find((label) => SERVICE_BY_SLUG.has(label));
    const service = slug ? SERVICE_BY_SLUG.get(slug) : null;
    const startedAt = new Date(issue.created_at ?? issue.createdAt);
    const resolvedValue = issue.closed_at ?? issue.closedAt;
    const resolvedAt = resolvedValue ? new Date(resolvedValue) : null;
    if (!Number.isFinite(startedAt.getTime())) return [];

    const title = String(issue.title ?? "");
    const kind = /degraded|degrada|performance/i.test(title) ? "degraded" : "down";
    const state = String(issue.state ?? "").toLowerCase();
    const number = Number(issue.number);

    return [{
      id: Number.isFinite(number) ? number : title,
      number: Number.isFinite(number) ? number : null,
      serviceSlug: slug ?? null,
      serviceName: service?.name ?? "Serviço monitorado",
      kind,
      active: state === "open" || state === "opened",
      startedAt,
      resolvedAt: resolvedAt && Number.isFinite(resolvedAt.getTime()) ? resolvedAt : null,
      url: String(issue.html_url ?? issue.url ?? ""),
    }];
  }).sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime());
}

export function buildDaySeries(service, incidents, now = new Date(), total = 90) {
  const keys = dateKeysEndingAt(now, total);
  const dailyMinutesDown = service.summary?.dailyMinutesDown ?? {};
  const hasHistory = Boolean(service.summary);
  const states = new Map(keys.map((key) => [
    key,
    hasHistory ? (Number(dailyMinutesDown[key]) > 0 ? "down" : "operational") : "unknown",
  ]));

  for (const incident of incidents) {
    if (incident.serviceSlug !== service.slug) continue;
    const end = incident.resolvedAt ?? now;
    for (const key of keys) {
      if (key >= dateKeyInBrazil(incident.startedAt) && key <= dateKeyInBrazil(end)) {
        if (incident.kind === "down" || states.get(key) !== "down") states.set(key, incident.kind);
      }
    }
  }

  return keys.map((date) => ({ date, status: states.get(date) ?? "unknown" }));
}

export function deriveOverallStatus(services) {
  const states = services.map((service) => service.status);
  if (states.includes("down")) return "down";
  if (states.includes("degraded")) return "degraded";
  if (states.includes("unknown") || states.length === 0) return "unknown";
  return "operational";
}

export function loadStatusData({ root = process.cwd(), now = new Date() } = {}) {
  const monitorCheckPath = path.join(root, "monitor-check.json");
  const hasMonitorCheck = fs.existsSync(monitorCheckPath);
  const monitorCheck = readJson(monitorCheckPath, null);
  const parsedMonitorCheckedAt = monitorCheck?.checkedAt
    ? new Date(monitorCheck.checkedAt)
    : null;
  const monitorCheckedAt = parsedMonitorCheckedAt && Number.isFinite(parsedMonitorCheckedAt.getTime())
    ? parsedMonitorCheckedAt
    : null;
  const summaryItems = readJson(path.join(root, "history", "summary.json"), []);
  const currentHealth = readJson(path.join(root, "current-health.json"), { services: {} });
  const summaryBySlug = new Map(
    (Array.isArray(summaryItems) ? summaryItems : []).map((item) => [item.slug, item]),
  );
  const issues = readJson(path.join(root, "incidents.json"), []);
  const incidents = parseIncidentIssues(issues);

  const services = SERVICES.map((definition) => {
    const history = readHistory(root, definition.slug);
    const summary = summaryBySlug.get(definition.slug) ?? null;
    const healthDetails = currentHealth?.services?.[definition.slug] ?? null;
    const historyCheckedAt = history ? new Date(history.lastUpdated) : null;
    const checkedAt = hasMonitorCheck ? monitorCheckedAt : historyCheckedAt;
    return {
      ...definition,
      history,
      summary,
      affectedComponents: Array.isArray(healthDetails?.affectedComponents)
        ? healthDetails.affectedComponents
        : [],
      status: normalizeCurrentStatus(history, now, MAX_STATUS_AGE_MS, checkedAt),
      checkedAt,
      responseTimeMs: history && Number.isFinite(Number(history.responseTime))
        ? Number(history.responseTime)
        : null,
      uptime90: parseUptime(summary?.uptimeMonth ?? summary?.uptime),
    };
  }).map((service) => ({
    ...service,
    days: buildDaySeries(service, incidents, now, 90),
  }));

  const validChecks = services
    .map((service) => service.checkedAt)
    .filter((date) => date && Number.isFinite(date.getTime()));
  const lastCheckedAt = monitorCheckedAt ?? (validChecks.length > 0
    ? new Date(Math.max(...validChecks.map((date) => date.getTime())))
    : null);

  return {
    generatedAt: now,
    lastCheckedAt,
    overallStatus: deriveOverallStatus(services),
    services,
    incidents,
    activeIncidents: incidents.filter((incident) => incident.active),
  };
}
