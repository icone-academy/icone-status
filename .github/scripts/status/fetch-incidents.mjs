import fs from "node:fs";
import path from "node:path";

const repository = process.env.GITHUB_REPOSITORY ?? "icone-academy/icone-status";
const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
const output = path.resolve(process.argv[2] ?? "incidents.json");
const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "icone-academy-status-builder",
  "X-GitHub-Api-Version": "2022-11-28",
};
if (token) headers.Authorization = `Bearer ${token}`;

const response = await fetch(`https://api.github.com/repos/${repository}/issues?state=all&labels=status&per_page=100`, { headers });
if (!response.ok) {
  throw new Error(`Falha ao buscar incidentes reais: GitHub respondeu ${response.status}.`);
}

const issues = await response.json();
fs.writeFileSync(output, `${JSON.stringify(issues, null, 2)}\n`, "utf8");
process.stdout.write(`${issues.length} incidentes obtidos do GitHub.\n`);
