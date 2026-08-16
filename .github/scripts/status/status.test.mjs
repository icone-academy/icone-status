import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  buildDaySeries,
  deriveOverallStatus,
  normalizeCurrentStatus,
  parseHistoryYaml,
  parseIncidentIssues,
} from "./data.mjs";
import { renderPage } from "./render.mjs";
import {
  parseCheckedAt,
  resolveMonitorCheck,
  selectLatestSuccessfulRun,
} from "./resolve-monitor-check.mjs";
import { sanitizePublicHealth } from "./fetch-health-details.mjs";

const now = new Date("2026-08-15T02:00:00.000Z");

test("mantém o indicador geral centralizado", () => {
  const styles = fs.readFileSync(new URL("./styles.css", import.meta.url), "utf8");

  assert.doesNotMatch(styles, /\.overall-card\s+span\s*\{/);
  assert.match(styles, /\.overall-card\s*>\s*div\s*>\s*span\s*\{/);
  assert.match(styles, /\.overall-icon\s*\{[\s\S]*?display:\s*grid;/);
});

test("normaliza fixtures saudável, degradada, indisponível e desconhecida", () => {
  assert.equal(normalizeCurrentStatus({ status: "up", lastUpdated: "2026-08-15T01:55:00Z" }, now), "operational");
  assert.equal(normalizeCurrentStatus({ status: "degraded", lastUpdated: "2026-08-15T01:55:00Z" }, now), "degraded");
  assert.equal(normalizeCurrentStatus({ status: "down", lastUpdated: "2026-08-15T01:55:00Z" }, now), "down");
  assert.equal(normalizeCurrentStatus({ status: "up", lastUpdated: "2026-08-15T01:44:59Z" }, now), "unknown");
  assert.equal(normalizeCurrentStatus({ status: "up", lastUpdated: "not-a-date" }, now), "unknown");
  assert.equal(normalizeCurrentStatus(null, now), "unknown");
});

test("usa a execução do monitor como heartbeat sem envelhecer estados estáveis", () => {
  const staleHistory = { status: "up", lastUpdated: "2026-03-10T17:45:48Z" };
  assert.equal(
    normalizeCurrentStatus(staleHistory, now, undefined, "2026-08-15T01:55:00Z"),
    "operational",
  );
  assert.equal(
    normalizeCurrentStatus(staleHistory, now, undefined, "2026-08-15T01:44:59Z"),
    "unknown",
  );
});

test("resolve heartbeat pelo workflow e seleciona somente execução bem-sucedida", async () => {
  assert.equal(parseCheckedAt("inválido"), null);
  const selected = selectLatestSuccessfulRun({
    workflow_runs: [
      { id: 1, status: "completed", conclusion: "failure", updated_at: "2026-08-15T01:59:00Z" },
      { id: 2, status: "completed", conclusion: "success", updated_at: "2026-08-15T01:58:00Z" },
    ],
  });
  assert.equal(selected.runId, 2);

  const resolved = await resolveMonitorCheck({
    providedCheckedAt: "2026-08-15T01:58:00Z",
    providedRunId: "2469",
    fetchImpl: () => { throw new Error("não deveria consultar a rede"); },
  });
  assert.deepEqual(resolved, {
    checkedAt: "2026-08-15T01:58:00.000Z",
    runId: 2469,
    source: "workflow_run",
  });

  const fetched = await resolveMonitorCheck({
    providedCheckedAt: "",
    repository: "icone-academy/icone-status",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        workflow_runs: [
          { id: 2470, status: "completed", conclusion: "success", updated_at: "2026-08-15T01:59:00Z" },
        ],
      }),
    }),
  });
  assert.deepEqual(fetched, {
    checkedAt: "2026-08-15T01:59:00.000Z",
    runId: 2470,
    source: "github_api",
  });
});

test("expõe somente labels públicas dos componentes realmente afetados", () => {
  const health = sanitizePublicHealth({
    status: "degraded",
    checkedAt: "2026-08-15T01:58:00Z",
    components: [
      { key: "database", label: "Banco de dados", status: "healthy" },
      { key: "redis", label: "Cache e sessões", status: "degraded", description: "segredo interno" },
    ],
  });

  assert.deepEqual(health, {
    status: "degraded",
    checkedAt: "2026-08-15T01:58:00.000Z",
    affectedComponents: ["Cache e sessões"],
  });
  assert.equal(sanitizePublicHealth({ status: "unexpected" }), null);
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
    affectedComponents: [],
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
  assert.doesNotMatch(html, /\u00cdcone/);
  assert.match(html, /Todos os sistemas estão operacionais/);
  assert.match(html, /Histórico de 90 dias/);
  assert.match(html, /<title>ICone Status<\/title>/);
  assert.match(html, /srcset="logo-dark\.png"/);
  assert.match(html, /src="logo-light\.png"/);
  assert.match(html, /prefers-color-scheme|styles\.css/);
});

test("HTML explica somente o componente público afetado", () => {
  const service = {
    slug: "api-health-completo",
    name: "Banco de dados e cache",
    description: "Dependências necessárias para atender tráfego",
    group: "infrastructure",
    status: "degraded",
    affectedComponents: ["Cache e sessões"],
    checkedAt: now,
    uptime90: null,
    days: Array.from({ length: 90 }, () => ({ date: "2026-08-14", status: "degraded" })),
  };
  const html = renderPage({
    generatedAt: now,
    lastCheckedAt: now,
    overallStatus: "degraded",
    services: [service],
    incidents: [],
    activeIncidents: [],
  });

  assert.match(html, /Componente afetado:<\/strong> Cache e sessões/);
  assert.doesNotMatch(html, /segredo interno|stack trace|exception message/i);
});
