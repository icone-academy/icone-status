import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadStatusData } from "./data.mjs";
import { renderPage } from "./render.mjs";

export function generateSite({ root = process.cwd(), now = new Date() } = {}) {
  const output = path.join(root, "_site");
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  fs.mkdirSync(output, { recursive: true });

  const data = loadStatusData({ root, now });
  const html = renderPage(data).replace(/[ \t]+$/gm, "");
  fs.writeFileSync(path.join(output, "index.html"), html, "utf8");
  fs.copyFileSync(path.join(scriptDirectory, "styles.css"), path.join(output, "styles.css"));
  fs.copyFileSync(path.join(scriptDirectory, "..", "logo-light.png"), path.join(output, "logo-light.png"));
  fs.copyFileSync(path.join(scriptDirectory, "..", "logo-dark.png"), path.join(output, "logo-dark.png"));

  const cname = path.join(root, "CNAME");
  if (fs.existsSync(cname)) fs.copyFileSync(cname, path.join(output, "CNAME"));

  return data;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const data = generateSite();
  process.stdout.write(`Status gerado: ${data.services.length} serviços, ${data.incidents.length} incidentes reais.\n`);
}
