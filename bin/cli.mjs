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
    run(process.execPath, [join(PKG, "daemon", "iframe-mac.mjs"), ...rest]);
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
  case "attach": {
    // Liga a uma sessão tmux que mostra o daemon ao vivo (tail do log). Cria-a se
    // não existir (attach-or-create), no socket default — o mesmo do `tmux attach`.
    const site = rest[0];
    if (!site) {
      console.error("Uso: iframe-mac attach <site>   (ex: iframe-mac attach grupo-jantar)");
      console.error("Depois, sair sem matar: Ctrl-b d. Re-ligar: tmux attach -t tb-<site>");
      process.exit(1);
    }
    const session = `tb-${site}`;
    const log = `/tmp/iframe-mac-${site}.log`;
    run("tmux", ["new-session", "-A", "-s", session, `tail -n 200 -F '${log}'`]);
    break;
  }
  default:
    console.log(`iframe-mac — liga o chat de um site ao Claude Code local.

Uso:
  iframe-mac daemon       Corre o daemon (lê .env.agent do site)
  iframe-mac install      Instala o daemon como serviço (LaunchAgent)
  iframe-mac attach <s>   Vê o daemon ao vivo numa sessão tmux (Ctrl-b d p/ sair)
  iframe-mac page ...     which-page: resolve rota/printscreen
  iframe-mac release      Propaga a nova versão a todos os sites (sites.json)
`);
    process.exit(cmd ? 1 : 0);
}
