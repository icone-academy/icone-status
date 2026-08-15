import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDaySeries,
  deriveOverallStatus,
  normalizeCurrentStatus,
  parseHistoryYaml,
  parseIncidentIssues,
} from "./data.mjs";
import { renderPage } from "./render.mjs";

const now = new Date("2026-08-15T02:00:00.000Z");

test("normaliza fixtures saudável, degradada, indisponível e desconhecida", () => {
  assert.equal(normalizeCurrentStatus({ status: "up", lastUpdated: "2026-08-15T01:55:00Z" }, now), "operational");
  assert.equal(normalizeCurrentStatus({ status: "degraded", lastUpdated: "2026-08-15T01:55:00Z" }, now), "degraded");
  assert.equal(normalizeCurrentStatus({ status: "down", lastUpdated: "2026-08-15T01:55:00Z" }, now), "down");
  assert.equal(normalizeCurrentStatus({ status: "up", lastUpdated: "2026-08-15T01:44:59Z" }, now), "unknown");
  assert.equal(normalizeCurrentStatus({ status: "up", lastUpdated: "not-a-date" }, now), "unknown");
  assert.equal(normalizeCurrentStatus(null, now), "unknown");
});

test("recusa histórico inválido em vez de assumir operacional", () => {
  assert.equal(parseHistoryYaml("status: up\ncode: 200"), null);
  assert.equal(parseHistoryYaml("lastUpdated: 2026-08-15T01:55:00Z"), null);
  assert.deepEqual(parseHistoryYaml("status: up\nlastUpdated: 2026-08-15T01:55:00Z\nresponseTime: 42"), {
    status: "up",
    lastUpdated: "2026-08-15T01:55:00Z",
    responseTime: "42",
  });
});

test("gera exatamente 90 datas em horário de Brasília e respeita indisponibilidade diária", () => {
  const service = {
    slug: "api-liveness",
    summary: { dailyMinutesDown: { "2026-08-13": 15 } },
  };

  const days = buildDaySeries(service, [], now, 90);

  assert.equal(days.length, 90);
  assert.equal(days.at(-1).date, "2026-08-14");
  assert.equal(days.find((day) => day.date === "2026-08-13").status, "down");
  assert.equal(days.find((day) => day.date === "2026-08-12").status, "operational");
});

test("mantém dias desconhecidos para monitor novo sem summary", () => {
  const days = buildDaySeries({ slug: "arquivos", summary: null }, [], now, 90);
  assert.ok(days.every((day) => day.status === "unknown"));
});

test("converte somente Issues reais de status e calcula transições", () => {
  const issues = parseIncidentIssues([
    {
      number: 42,
      title: "🟨 API — Liveness has degraded performance",
      state: "closed",
      created_at: "2026-08-14T10:00:00Z",
      closed_at: "2026-08-14T10:07:00Z",
      html_url: "https://github.com/icone-academy/icone-status/issues/42",
      labels: [{ name: "status" }, { name: "api-liveness" }],
    },
    {
      number: 43,
      title: "Documentação",
      state: "open",
      created_at: "2026-08-14T10:00:00Z",
      labels: [{ name: "documentation" }],
    },
  ]);

  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, "degraded");
  assert.equal(issues[0].serviceName, "API");
  assert.equal(issues[0].active, false);
});

test("prioridade geral é down, degraded, unknown e operational", () => {
  assert.equal(deriveOverallStatus([{ status: "operational" }, { status: "down" }]), "down");
  assert.equal(deriveOverallStatus([{ status: "operational" }, { status: "degraded" }]), "degraded");
  assert.equal(deriveOverallStatus([{ status: "operational" }, { status: "unknown" }]), "unknown");
  assert.equal(deriveOverallStatus([{ status: "operational" }]), "operational");
});

test("HTML não contém undefined e mantém acentuação e estados acessíveis", () => {
  const days = Array.from({ length: 90 }, (_, index) => ({
    date: `2026-05-${String((index % 28) + 1).padStart(2, "0")}`,
    status: index === 0 ? "unknown" : "operational",
  }));
  const service = {
    slug: "plataforma-app",
    name: "Plataforma",
    description: "Site e aplicação principal",
    group: "products",
    status: "operational",
    checkedAt: now,
    uptime90: 99.99,
    days,
  };
  const html = renderPage({
    generatedAt: now,
    lastCheckedAt: now,
    overallStatus: "operational",
    services: [service],
    incidents: [],
    activeIncidents: [],
  });

  assert.doesNotMatch(html, /undefined/i);
  assert.match(html, /Todos os sistemas estão operacionais/);
  assert.match(html, /Histórico de 90 dias/);
  assert.match(html, /prefers-color-scheme|styles\.css/);
});
