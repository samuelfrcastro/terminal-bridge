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
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

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
    // Lê a linha "📄 <ficheiro>" — funciona p/ qualquer router (src/pages, src/routes, app/…).
    const m = stdout.match(/📄\s+(\S+\.[jt]sx?)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** Encurta um caminho absoluto para relativo à raiz do projeto (UI mais limpa). */
function shortPath(p) {
  if (typeof p !== "string") return "";
  return p.startsWith(ROOT) ? p.slice(ROOT.length).replace(/^\//, "") : p;
}

/** Resumo legível de uma tool call para mostrar no chat (ex. "Read src/Header.tsx"). */
function toolSummary(name, input) {
  const i = input || {};
  if (i.file_path) return `${name} ${shortPath(i.file_path)}`;
  if (i.path) return `${name} ${shortPath(i.path)}`;
  if (i.notebook_path) return `${name} ${shortPath(i.notebook_path)}`;
  if (i.command) return `${name} ${String(i.command).replace(/\s+/g, " ").slice(0, 70)}`;
  if (i.pattern) return `${name} ${i.pattern}${i.path ? " " + shortPath(i.path) : ""}`;
  if (i.url) return `${name} ${i.url}`;
  if (i.query) return `${name} ${String(i.query).slice(0, 60)}`;
  if (i.description) return `${name}: ${String(i.description).slice(0, 60)}`;
  return name;
}

/**
 * Corre o Claude Code em modo streaming (NDJSON) e chama os callbacks à medida
 * que os eventos chegam: onText(token), onTool(resumo), onSession(id).
 * Devolve o texto final autoritativo + session no fim. Mantém a continuidade
 * de sessão via --resume, tal como a versão buffered.
 */
function runClaudeStreaming(prompt, { onText, onTool, onSession } = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      "--dangerously-skip-permissions",
      "-p", prompt,
      "--output-format", "stream-json",
      "--include-partial-messages",
      "--verbose",
    ];
    if (claudeSession) args.push("--resume", claudeSession);
    if (MODEL) args.push("--model", MODEL);

    const child = spawn("claude", args, { cwd: ROOT, env: childEnv });
    const rl = readline.createInterface({ input: child.stdout });
    const killTimer = setTimeout(() => child.kill("SIGKILL"), 300_000);

    let finalText = "";
    let session = null;
    let stderr = "";
    child.stderr.on("data", (d) => { stderr += d.toString(); });

    rl.on("line", (line) => {
      const s = line.trim();
      if (!s) return;
      let ev;
      try { ev = JSON.parse(s); } catch { return; }

      if (ev.type === "system" && ev.subtype === "init") {
        if (ev.session_id) { session = ev.session_id; onSession?.(session); }
      } else if (ev.type === "stream_event") {
        const e = ev.event;
        if (e?.type === "content_block_delta" && e.delta?.type === "text_delta") {
          onText?.(e.delta.text);
        }
      } else if (ev.type === "assistant" && Array.isArray(ev.message?.content)) {
        // Blocos completos desta volta: emite as tool calls (já com input preenchido).
        for (const block of ev.message.content) {
          if (block.type === "tool_use") onTool?.(toolSummary(block.name, block.input));
        }
      } else if (ev.type === "result") {
        if (ev.session_id) session = ev.session_id;
        if (typeof ev.result === "string") finalText = ev.result;
      }
    });

    child.on("error", (err) => { clearTimeout(killTimer); reject(err); });
    child.on("close", (code) => {
      clearTimeout(killTimer);
      if (!finalText && code !== 0) {
        reject(new Error(stderr.trim() || `claude saiu com código ${code}`));
      } else {
        resolve({ text: finalText || "(sem resposta)", session });
      }
    });
  });
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

  // Contexto de página: combina os sinais que existirem (rota sempre, + ficheiro, + printscreen).
  const where = onMobile ? "no telemóvel" : "no browser";
  const ctx = [];
  if (payload.route) ctx.push(`O utilizador está ${where} na rota \`${payload.route}\`.`);
  if (routeFile) ctx.push(`Essa rota corresponde ao ficheiro \`${routeFile}\` — usa-o para contexto.`);
  if (shot) ctx.push(`Tens um printscreen REAL do que ele vê em \`${shot}\` — lê-o com a tool Read antes de responder.`);
  const prompt = ctx.length ? `${ctx.join(" ")}\n\nPedido:\n\n${text}` : text;

  // Envios serializados → preserva a ordem (deltas de texto vs linhas de tool).
  let sendQ = Promise.resolve();
  const send = (event, extra) =>
    (sendQ = sendQ
      .then(() => channel.send({ type: "broadcast", event, payload: { id: payload.id, ...extra } }))
      .catch(() => {}));

  // Throttle dos tokens: acumula e descarrega a cada ~120ms (evita inundar o Realtime).
  let buf = "";
  const flush = () => { if (buf) { const chunk = buf; buf = ""; send("assistant_delta", { text: chunk }); } };
  const flusher = setInterval(flush, 120);

  const onText = (t) => { buf += t; };
  const onTool = (summary) => { flush(); send("tool_use", { summary }); console.log(`\x1b[90m   ▸ ${summary}\x1b[0m`); };

  try {
    const { text: answer, session } = await runClaudeStreaming(prompt, {
      onText,
      onTool,
      onSession: (s) => { claudeSession = s; },
    });
    if (session) claudeSession = session;
    clearInterval(flusher);
    flush();
    await sendQ;
    console.log(`\x1b[32m[claude→app]\x1b[0m (${((Date.now() - t0) / 1000).toFixed(1)}s) ${answer}\n`);
    // Mensagem final autoritativa: o cliente substitui o texto streamado (corrige deltas perdidos).
    await channel.send({ type: "broadcast", event: "assistant_msg", payload: { id: payload.id, text: answer, session: claudeSession, shot: !!shot, streamed: true } });
  } catch (e) {
    clearInterval(flusher);
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
