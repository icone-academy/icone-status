import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SERVICES } from "./services.mjs";

const ALLOWED_STATUSES = new Set(["healthy", "degraded", "unhealthy"]);
const MAX_LABEL_LENGTH = 80;

export function sanitizePublicHealth(payload) {
  if (!payload || typeof payload !== "object") return null;
  const status = String(payload.status ?? "").toLowerCase();
  if (!ALLOWED_STATUSES.has(status)) return null;

  const affectedComponents = Array.isArray(payload.components)
    ? payload.components
        .filter((component) => component && String(component.status).toLowerCase() !== "healthy")
        .map((component) => String(component.label ?? "").trim().slice(0, MAX_LABEL_LENGTH))
        .filter(Boolean)
        .filter((label, index, labels) => labels.indexOf(label) === index)
        .slice(0, 5)
    : [];

  const checkedAt = new Date(payload.checkedAt);
  return {
    status,
    checkedAt: Number.isFinite(checkedAt.getTime()) ? checkedAt.toISOString() : null,
    affectedComponents,
  };
}

export async function fetchHealthDetails(service, {
  fetchImpl = fetch,
  timeoutMs = 10_000,
} = {}) {
  try {
    const response = await fetchImpl(service.url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = sanitizePublicHealth(await response.json());
    return payload ? { slug: service.slug, ...payload } : null;
  } catch {
    // Details enrich the public explanation but never override Upptime's state.
    return null;
  }
}

export async function collectHealthDetails(options = {}) {
  const entries = await Promise.all(
    SERVICES.filter((service) => service.healthDetails)
      .map((service) => fetchHealthDetails(service, options)),
  );
  return Object.fromEntries(
    entries.filter(Boolean).map((entry) => [entry.slug, entry]),
  );
}

export async function writeHealthDetails(outputPath, options = {}) {
  const services = await collectHealthDetails(options);
  fs.writeFileSync(outputPath, `${JSON.stringify({ services }, null, 2)}\n`, "utf8");
  return services;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = path.resolve(process.argv[2] ?? "current-health.json");
  const services = await writeHealthDetails(output);
  process.stdout.write(`Detalhes públicos obtidos para ${Object.keys(services).length} serviços.\n`);
}
