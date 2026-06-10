#!/usr/bin/env bun
/**
 * terminal-bridge (daemon) — liga o chat de um site ao Claude Code desta máquina.
 * Genérico: corre para qualquer site, parametrizado por env. Online via Presence.
 *
 * Correr (a partir da pasta do site, que tem @supabase/supabase-js):
 *   bun node_modules/terminal-bridge/daemon/terminal-bridge.mjs
 * ou via CLI:  npx terminal-bridge daemon
 *
 * Env (normalmente em .env.agent na raiz do site):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (obrigatórias)
 *   BRIDGE_CHANNEL        canal Realtime único do site (ex 'bridge-iocmanager')
 *   AGENT_PROJECT_ROOT    raiz do site (default: cwd)
 *   BRIDGE_MODEL          modelo do Claude Code (opcional; default = o do CLI)
 *   BRIDGE_FLAG           marca da aba a capturar (default 'claude')
 */

import { createClient } from "@supabase/supabase-js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const execFileP = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const WHICH_PAGE = join(HERE, "which-page.mjs");

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ROOT = process.env.AGENT_PROJECT_ROOT || process.cwd();
const CHANNEL = process.env.BRIDGE_CHANNEL || "terminal-bridge";
const MODEL = process.env.BRIDGE_MODEL || "";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("[bridge] FATAL: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias (.env.agent).");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

let claudeSession = null;
let busy = false;

const channel = supabase.channel(CHANNEL, {
  config: { broadcast: { self: false, ack: true }, presence: { key: "terminal" } },
});

const childEnv = { ...process.env, AGENT_PROJECT_ROOT: ROOT };

async function captureMarkedTab() {
  try {
    const { stdout } = await execFileP(process.execPath, [WHICH_PAGE, "--shot"], { cwd: ROOT, timeout: 20_000, env: childEnv });
    const m = stdout.match(/\/tmp\/terminal-bridge-view-\d+\.png/);
    return m ? m[0] : null;
  } catch {
    return null;
  }
}

async function resolveRoute(route) {
  try {
    const path = route.split("?")[0].split("#")[0] || "/";
    const { stdout } = await execFileP(process.execPath, [WHICH_PAGE, path], { cwd: ROOT, timeout: 10_000, env: childEnv });
    const m = stdout.match(/src\/pages\/[A-Za-z0-9_]+\.tsx/);
    return m ? m[0] : null;
  } catch {
    return null;
  }
}

async function runClaude(prompt) {
  const args = ["--dangerously-skip-permissions", "-p", prompt, "--output-format", "json"];
  if (claudeSession) args.push("--resume", claudeSession);
  if (MODEL) args.push("--model", MODEL);
  const { stdout } = await execFileP("claude", args, { cwd: ROOT, timeout: 300_000, maxBuffer: 16 * 1024 * 1024 });
  const res = JSON.parse(stdout);
  return { text: res.result ?? "(sem resposta)", session: res.session_id ?? null };
}

function saveInlineImage(dataUrl) {
  try {
    const m = dataUrl.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/);
    if (!m) return null;
    const ext = m[1] === "jpeg" ? "jpg" : m[1];
    const out = join("/tmp", `terminal-bridge-mobile-${Date.now()}.${ext}`);
    writeFileSync(out, Buffer.from(m[2], "base64"));
    return out;
  } catch {
    return null;
  }
}

async function handle(payload) {
  const text = (payload?.text || "").trim();
  if (!text) return;
  if (busy) {
    await channel.send({ type: "broadcast", event: "assistant_msg", payload: { id: payload.id, text: "⏳ Ainda estou a tratar do pedido anterior — aguarda um momento." } });
    return;
  }
  busy = true;
  const t0 = Date.now();
  const onMobile = payload.device === "mobile";
  console.log(`\n\x1b[36m[app→claude]\x1b[0m ${onMobile ? "📱 " : ""}${text}`);

  let shot = null;
  if (payload.image) {
    shot = saveInlineImage(payload.image);
    if (shot) console.log(`\x1b[90m   📱📸 ${shot}\x1b[0m`);
  } else if (!onMobile) {
    shot = await captureMarkedTab();
    if (shot) console.log(`\x1b[90m   📸 ${shot}\x1b[0m`);
  }
  const routeFile = payload.route ? await resolveRoute(payload.route) : null;
  if (routeFile) console.log(`\x1b[90m   📄 ${payload.route} → ${routeFile}\x1b[0m`);

  let prompt = text;
  if (shot) {
    prompt = `O utilizador está a ver esta página da app. Tens um printscreen REAL do que ele vê em \`${shot}\` — lê-o com a tool Read antes de responder. Pedido:\n\n${text}`;
  } else if (routeFile) {
    const where = onMobile ? "no telemóvel" : "no browser";
    prompt = `O utilizador está ${where} na rota \`${payload.route}\` (ficheiro \`${routeFile}\`). Sem printscreen — usa o ficheiro para contexto. Pedido:\n\n${text}`;
  }

  try {
    const { text: answer, session } = await runClaude(prompt);
    if (session) claudeSession = session;
    console.log(`\x1b[32m[claude→app]\x1b[0m (${((Date.now() - t0) / 1000).toFixed(1)}s) ${answer}\n`);
    await channel.send({ type: "broadcast", event: "assistant_msg", payload: { id: payload.id, text: answer, session: claudeSession, shot: !!shot } });
  } catch (e) {
    const msg = `Erro ao correr o Claude Code: ${e?.message || e}`;
    console.error(`\x1b[31m[bridge]\x1b[0m ${msg}`);
    await channel.send({ type: "broadcast", event: "assistant_msg", payload: { id: payload.id, text: "❌ " + msg } });
  } finally {
    busy = false;
  }
}

channel
  .on("broadcast", { event: "user_msg" }, ({ payload }) => handle(payload))
  .subscribe((status) => {
    console.log(`[bridge] canal "${CHANNEL}": ${status}`);
    if (status === "SUBSCRIBED") {
      console.log(`[bridge] ✓ pronto (projeto: ${ROOT}). Modelo: ${MODEL || "(default do CLI)"}`);
      channel.track({ role: "terminal", ts: Date.now() }); // Presence — sem batimentos periódicos
    }
  });

const bye = () => { supabase.removeAllChannels(); process.exit(0); };
process.on("SIGINT", () => { console.log("\n[bridge] a desligar..."); bye(); });
process.on("SIGTERM", bye);
