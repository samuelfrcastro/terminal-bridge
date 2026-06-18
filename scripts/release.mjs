#!/usr/bin/env node
/**
 * release — propaga a versão atual do plugin a todos os sites e faz deploy de cada um.
 * "Melhora-se uma vez, vale para todos." Lê sites.json (ver sites.example.json).
 *
 * Fluxo:
 *   1. (neste repo) garante que o build/dist está commitado e com push+tag no GitHub.
 *   2. para cada site: npm install do package (última versão) + corre o comando de deploy.
 *
 * Uso:
 *   iframe-mac release            atualiza + deploya todos os sites
 *   iframe-mac release --update   só atualiza o package nos sites (sem deploy)
 *   iframe-mac release --site X   só esse site
 */
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const onlySite = args.includes("--site") ? args[args.indexOf("--site") + 1] : null;
const noDeploy = args.includes("--update");

const cfgPath = join(PKG, "sites.json");
if (!existsSync(cfgPath)) {
  console.error("✗ Falta sites.json no package. Copia sites.example.json → sites.json e ajusta.");
  process.exit(1);
}
const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
const gitRef = cfg.gitRef || "github:samuelfrcastro/iframe-mac";
const sites = (cfg.sites || []).filter((s) => !onlySite || s.name === onlySite);

const sh = (cmd, cwd) => execSync(cmd, { cwd, stdio: "pipe", encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });

const pkgVersion = JSON.parse(readFileSync(join(PKG, "package.json"), "utf8")).version;

// Pin ao commit exato: o npm NÃO atualiza um git dep que considere "satisfeito"
// (instala stale e o site fica com a versão antiga). Instalar github:...#<sha>
// muda o spec e força a re-busca. Cai para o gitRef genérico se não houver git.
let headSha = "";
try { headSha = sh("git rev-parse HEAD", PKG).trim(); } catch {}
const ref = headSha ? `${gitRef}#${headSha}` : gitRef;
console.log(`\n▶ release do iframe-mac v${pkgVersion} (${headSha.slice(0, 7) || "?"}) para ${sites.length} site(s)\n`);

const results = [];
for (const site of sites) {
  const tag = `[${site.name}]`;
  try {
    if (!existsSync(site.path)) throw new Error(`path não existe: ${site.path}`);
    console.log(`${tag} a atualizar o package (${ref})…`);
    // installFlags por site (ex. "--legacy-peer-deps" p/ sites com conflitos de peer deps pré-existentes).
    const installFlags = site.installFlags ? ` ${site.installFlags}` : "";
    sh(`npm install ${ref} --save${installFlags}`, site.path);

    // Auto-verificação: confirma que o que ficou instalado é mesmo esta versão.
    const installedPkg = join(site.path, "node_modules", "iframe-mac", "package.json");
    const installed = existsSync(installedPkg) ? JSON.parse(readFileSync(installedPkg, "utf8")).version : "?";
    if (installed !== pkgVersion) {
      throw new Error(`versão instalada (${installed}) ≠ esperada (${pkgVersion}) — npm serviu cache; tenta com --force`);
    }
    console.log(`${tag} ✓ package v${installed}`);

    if (noDeploy) {
      console.log(`${tag} ✓ atualizado (sem deploy)`);
      results.push({ site: site.name, ok: true, deployed: false });
      continue;
    }
    if (!site.deploy) {
      console.log(`${tag} ⚠ sem comando de deploy — atualizado mas não deployado`);
      results.push({ site: site.name, ok: true, deployed: false });
      continue;
    }
    console.log(`${tag} a fazer deploy…`);
    const out = sh(site.deploy, site.path);
    const url = (out.match(/https:\/\/[^\s]+vercel\.app/) || [])[0] || "(deploy ok)";
    console.log(`${tag} ✓ ${url}`);
    results.push({ site: site.name, ok: true, deployed: true, url });
  } catch (e) {
    console.error(`${tag} ✗ ${e.message?.split("\n")[0] || e}`);
    results.push({ site: site.name, ok: false, error: String(e.message || e).split("\n")[0] });
  }
}

console.log("\n── resumo ──");
for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${r.site}${r.url ? " → " + r.url : ""}${r.error ? " — " + r.error : ""}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
