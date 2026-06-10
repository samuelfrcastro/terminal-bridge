#!/usr/bin/env node
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, "..");
const cmd = process.argv[2];
const rest = process.argv.slice(3);

function run(bin, args, opts = {}) {
  const c = spawn(bin, args, { stdio: "inherit", ...opts });
  c.on("exit", (code) => process.exit(code ?? 0));
  c.on("error", (e) => { console.error(e.message); process.exit(1); });
}

switch (cmd) {
  case "daemon":
    // corre o daemon a partir da pasta do site (resolve @supabase/supabase-js do site)
    run(process.execPath, [join(PKG, "daemon", "terminal-bridge.mjs"), ...rest]);
    break;
  case "page":
    run(process.execPath, [join(PKG, "daemon", "which-page.mjs"), ...rest]);
    break;
  case "install":
    run("bash", [join(PKG, "scripts", "install-daemon.sh"), ...rest]);
    break;
  case "release":
    run(process.execPath, [join(PKG, "scripts", "release.mjs"), ...rest]);
    break;
  default:
    console.log(`terminal-bridge — liga o chat de um site ao Claude Code local.

Uso:
  terminal-bridge daemon     Corre o daemon (lê .env.agent do site)
  terminal-bridge install    Instala o daemon como serviço (LaunchAgent)
  terminal-bridge page ...   which-page: resolve rota/printscreen
  terminal-bridge release    Propaga a nova versão a todos os sites (sites.json)
`);
    process.exit(cmd ? 1 : 0);
}
