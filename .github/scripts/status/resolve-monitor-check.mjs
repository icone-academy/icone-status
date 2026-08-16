import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REPOSITORY = "icone-academy/icone-status";
const USER_AGENT = "icone-academy-status-builder";

export function parseCheckedAt(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function selectLatestSuccessfulRun(payload) {
  const runs = Array.isArray(payload?.workflow_runs) ? payload.workflow_runs : [];
  return runs
    .filter((run) => run?.status === "completed" && run?.conclusion === "success")
    .map((run) => ({
      checkedAt: parseCheckedAt(run.updated_at ?? run.run_started_at),
      runId: Number(run.id),
    }))
    .filter((run) => run.checkedAt && Number.isFinite(run.runId))
    .sort((left, right) => right.checkedAt.getTime() - left.checkedAt.getTime())[0] ?? null;
}

async function fetchLatestSuccessfulRun({ repository, token, fetchImpl }) {
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": USER_AGENT,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetchImpl(
    `https://api.github.com/repos/${repository}/actions/workflows/uptime.yml/runs?branch=master&per_page=10`,
    { headers },
  );
  if (!response.ok) {
    throw new Error(`Falha ao consultar a última verificação: GitHub respondeu ${response.status}.`);
  }

  const run = selectLatestSuccessfulRun(await response.json());
  if (!run) throw new Error("Nenhuma execução bem-sucedida do Uptime CI foi encontrada.");
  return run;
}

export async function resolveMonitorCheck({
  providedCheckedAt = process.env.STATUS_MONITOR_CHECKED_AT,
  providedRunId = process.env.STATUS_MONITOR_RUN_ID,
  repository = process.env.GITHUB_REPOSITORY ?? DEFAULT_REPOSITORY,
  token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN,
  fetchImpl = fetch,
} = {}) {
  const checkedAt = parseCheckedAt(providedCheckedAt);
  const runId = Number(providedRunId);
  if (checkedAt) {
    return {
      checkedAt: checkedAt.toISOString(),
      runId: Number.isFinite(runId) ? runId : null,
      source: "workflow_run",
    };
  }

  const latest = await fetchLatestSuccessfulRun({ repository, token, fetchImpl });
  return {
    checkedAt: latest.checkedAt.toISOString(),
    runId: latest.runId,
    source: "github_api",
  };
}

export async function writeMonitorCheck(outputPath, options = {}) {
  const monitorCheck = await resolveMonitorCheck(options);
  fs.writeFileSync(outputPath, `${JSON.stringify(monitorCheck, null, 2)}\n`, "utf8");
  return monitorCheck;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = path.resolve(process.argv[2] ?? "monitor-check.json");
  const monitorCheck = await writeMonitorCheck(output);
  process.stdout.write(`Última verificação confirmada em ${monitorCheck.checkedAt}.\n`);
}
