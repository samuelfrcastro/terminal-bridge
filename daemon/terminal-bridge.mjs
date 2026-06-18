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
 *   BRIDGE_SECRET         código de acesso (obrigatório) — o chat assina cada mensagem com ele (HMAC)
 *   BRIDGE_CHANNEL        canal Realtime único do site (ex 'bridge-iocmanager')
 *   AGENT_PROJECT_ROOT    raiz do site (default: cwd)
 *   BRIDGE_MODEL          modelo do Claude Code (opcional; default = o do CLI)
 *   BRIDGE_FLAG           marca da aba a capturar (default 'claude')
 *
 * Modo fila de tarefas (BRIDGE_MODE=queue):
 *   BRIDGE_MODE           "queue" para delegar ao dashboard-3macs em vez de correr Claude localmente
 *   BRIDGE_QUEUE_URL      URL base do dashboard (ex https://ioc-1.tail215de3.ts.net:4747)
 *   BRIDGE_QUEUE_TOKEN    token admin do dashboard (~/.claude/dashboard-token)
 *   BRIDGE_PROJECT        nome do projeto para serialização da fila (ex 'iocmanager')
 *   BRIDGE_SITE_NAME      nome legível do site para aparecer no prompt (default: BRIDGE_CHANNEL)
 */

import { createClient } from "@supabase/supabase-js";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync, readFileSync, unlinkSync } from "node:fs";
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

// Modo fila de tarefas
const BRIDGE_MODE = process.env.BRIDGE_MODE || "direct"; // "direct" | "queue"
const BRIDGE_QUEUE_URL = (process.env.BRIDGE_QUEUE_URL || "").replace(/\/$/, "");
const BRIDGE_QUEUE_TOKEN = process.env.BRIDGE_QUEUE_TOKEN || "";
const BRIDGE_PROJECT = process.env.BRIDGE_PROJECT || "";
const BRIDGE_SITE_NAME = process.env.BRIDGE_SITE_NAME || CHANNEL;
const BRIDGE_TARGET_HOST = process.env.BRIDGE_TARGET_HOST || ""; // runner que deve executar (mac-1/mac-3/ioc-1)

// Notificações ao owner: ligadas por defeito (BRIDGE_NOTIFY=0 desliga).
const NOTIFY = process.env.BRIDGE_NOTIFY !== "0";
const TG_TOKEN = process.env.BRIDGE_TELEGRAM_BOT_TOKEN || "";
const TG_CHAT = process.env.BRIDGE_TELEGRAM_CHAT_ID || "";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("[bridge] FATAL: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias (.env.agent).");
  process.exit(1);
}

// ── Auth HMAC ────────────────────────────────────────────────────────────────
const BRIDGE_SECRET = process.env.BRIDGE_SECRET || "";
if (!BRIDGE_SECRET) {
  console.warn("[bridge] AVISO: BRIDGE_SECRET não definido — canal aceita mensagens sem autenticação.");
}
// Replay protection: guarda IDs vistos nos últimos 10 min.
const seenIds = new Map(); // id → expiry ms
function cleanSeenIds() {
  const now = Date.now();
  for (const [id, exp] of seenIds) if (now > exp) seenIds.delete(id);
}
async function verifyHmac(payload) {
  if (!BRIDGE_SECRET) return true; // sem secret configurado: aceita tudo
  const { id, ts, text, sig } = payload || {};
  if (!sig || !id || !ts) return false;
  if (Math.abs(Date.now() - ts) > 5 * 60_000) return false; // ts fora de ±5 min
  cleanSeenIds();
  if (seenIds.has(id)) return false; // replay
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(BRIDGE_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const sigBuf = Uint8Array.from(atob(sig), (c) => c.charCodeAt(0));
  const valid = await crypto.subtle.verify("HMAC", key, sigBuf, enc.encode(`${id}.${ts}.${text}`));
  if (valid) seenIds.set(id, Date.now() + 10 * 60_000);
  return valid;
}

/**
 * Avisa o owner que há atividade no chat: notificação nativa do macOS e, se
 * configurado, mensagem no Telegram. Fire-and-forget — nunca bloqueia o handler.
 * Desliga-se com BRIDGE_NOTIFY=0.
 */
function notify(title, message) {
  if (!NOTIFY) return;
  const body = String(message || "").replace(/\s+/g, " ").slice(0, 200);

  // macOS: passa título/corpo como argv (sem escapes frágeis dentro do AppleScript).
  if (process.platform === "darwin") {
    execFile(
      "osascript",
      [
        "-e", "on run argv",
        "-e", 'display notification (item 1 of argv) with title (item 2 of argv) sound name "Glass"',
        "-e", "end run",
        "--", body, title,
      ],
      () => {}
    );
  }

  // Telegram opcional (só se token + chat id estiverem definidos).
  if (TG_TOKEN && TG_CHAT) {
    fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: TG_CHAT, text: `${title}\n${body}`, disable_notification: false }),
    }).catch(() => {});
  }
}

// ── State persistence (restart recovery) ─────────────────────────────────────
// Guarda o taskId activo em disco antes de iniciar o poll. Se o daemon reiniciar
// com uma tarefa em curso, recupera e retoma o poll sem perder a resposta.
const STATE_FILE = join(process.env.HOME || "/tmp", ".claude", `bridge-state-${CHANNEL}.json`);
function saveState(s) { try { writeFileSync(STATE_FILE, JSON.stringify(s), { mode: 0o600 }); } catch {} }
function clearState() { try { unlinkSync(STATE_FILE); } catch {} }
function loadState() { try { return JSON.parse(readFileSync(STATE_FILE, "utf8")); } catch { return null; } }

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
  realtime: { heartbeatIntervalMs: 15_000, disconnectOnEmptyChannelsAfterMs: 300_000 },
});

let claudeSession = null;
let busy = false;

const channel = supabase.channel(CHANNEL, {
  config: { broadcast: { self: false } },
});

// ── ACK para assistant_msg ────────────────────────────────────────────────────
// Quando o browser recebe assistant_msg, envia assistant_msg_ack de volta.
// O daemon aguarda esse ACK antes de considerar a entrega confirmada.
// Sem ACK em 5s → retry até 3x. Backward compat: se o browser for antigo
// e nunca enviar ACK, o daemon loga aviso mas não fica stuck.
const pendingAssistantAcks = new Map(); // msgId → resolve()

async function sendAssistantWithAck(msgPayload) {
  const msgId = msgPayload.id;
  // Delays entre tentativas: imediato, 2s, 60s (última dá tempo p/ browser reiniciar)
  const retryDelays = [0, 2_000, 60_000];
  for (let i = 0; i < 3; i++) {
    if (retryDelays[i] > 0) await new Promise((r) => setTimeout(r, retryDelays[i]));
    await channel.send({ type: "broadcast", event: "assistant_msg", payload: msgPayload }).catch(() => {});
    const acked = await new Promise((resolve) => {
      const timer = setTimeout(() => { pendingAssistantAcks.delete(msgId); resolve(false); }, 5_000);
      pendingAssistantAcks.set(msgId, () => { clearTimeout(timer); resolve(true); });
    });
    if (acked) return;
    if (i < 2) console.warn(`[bridge] assistant_msg sem ACK (id=${msgId}), tentativa ${i + 2}/3`);
  }
  console.warn(`[bridge] assistant_msg não confirmado após 3 tentativas (id=${msgId}) — browser pode não ter código ACK`);
}

// ── HTTP POST com retry ───────────────────────────────────────────────────────
// Garante entrega mesmo se o servidor do dashboard estiver temporariamente down.
async function postWithRetry(url, body, token, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": token },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) return data;
      throw new Error(data.error || "queue error");
    } catch (e) {
      if (i === maxRetries - 1) throw e;
      // Delays: 2s, 60s (última tentativa dá tempo p/ servidor reiniciar)
      const delay = i === 0 ? 2_000 : 60_000;
      console.warn(`[bridge] POST falhou (tentativa ${i + 1}/${maxRetries}): ${e.message} — retry em ${delay / 1000}s`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

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

/**
 * Poll de uma tarefa na fila do dashboard até conclusão.
 * Extrai a lógica de polling para ser reutilizável em restart recovery.
 */
async function runQueuePoll(taskId, payloadId) {
  let lastLiveLen = 0;
  const MAX_POLLS = 300; // 300 × 2s = 10 min
  let polls = 0;

  await new Promise((resolve) => {
    const tick = async () => {
      polls++;
      try {
        const res = await fetch(`${BRIDGE_QUEUE_URL}/api/queue/${taskId}`, {
          headers: { "x-admin-token": BRIDGE_QUEUE_TOKEN },
        });
        const { task } = await res.json();

        // Transmite live_output como delta enquanto a tarefa corre
        const live = task?.live_output || "";
        if (live.length > lastLiveLen) {
          const delta = live.slice(lastLiveLen);
          lastLiveLen = live.length;
          await channel.send({ type: "broadcast", event: "assistant_delta", payload: { id: payloadId + "-live", text: delta } }).catch(() => {});
        }

        if (task?.status === "done" || task?.status === "error") {
          const finalText = task.result || "(sem resultado)";
          const prefix = task.status === "error" ? "❌ " : "";
          console.log(`\x1b[32m[queue→app]\x1b[0m tarefa #${taskId} ${task.status}: ${finalText.slice(0, 120)}`);
          notify(`${task.status === "done" ? "✅" : "❌"} ${BRIDGE_SITE_NAME}`, finalText);
          clearState();
          await sendAssistantWithAck({ id: payloadId, text: prefix + finalText, task_id: taskId, streamed: lastLiveLen > 0 });
          busy = false;
          resolve();
          return;
        }
      } catch (e) {
        console.error(`\x1b[33m[bridge]\x1b[0m poll erro: ${e.message}`);
      }

      if (polls >= MAX_POLLS) {
        console.warn(`[bridge] timeout polling tarefa #${taskId}`);
        clearState();
        await sendAssistantWithAck({ id: payloadId, text: `⏱ Timeout: tarefa #${taskId} ainda a correr após 10 min. Verifica no dashboard.`, task_id: taskId });
        busy = false;
        resolve();
        return;
      }
      setTimeout(tick, 2000);
    };
    setTimeout(tick, 2000);
  });
}

/**
 * Modo BRIDGE_MODE=queue: delega ao dashboard-3macs em vez de correr Claude localmente.
 * O prompt inclui a origem (site, página, raiz do repo) para o runner saber onde trabalhar.
 * Faz poll a /api/queue/:id a cada 2s e transmite live_output como deltas enquanto espera.
 */
async function handleQueue(payload) {
  const text = (payload?.text || "").trim();
  if (!text) return;
  notify(`💬 ${CHANNEL}`, text);

  if (!BRIDGE_QUEUE_URL || !BRIDGE_QUEUE_TOKEN) {
    await sendAssistantWithAck({ id: payload.id, text: "❌ BRIDGE_QUEUE_URL e BRIDGE_QUEUE_TOKEN são obrigatórios no modo queue." });
    return;
  }

  if (busy) {
    await sendAssistantWithAck({ id: payload.id, text: "⏳ Ainda estou a tratar do pedido anterior — aguarda um momento." });
    return;
  }
  busy = true;

  const onMobile = payload.device === "mobile";
  const route = payload.route || "";
  const userEmail = payload.userEmail || "";

  // Contexto de origem embutido no prompt para o runner saber onde trabalhar
  const originLines = [];
  originLines.push(`Este pedido vem do chat do site **${BRIDGE_SITE_NAME}** (canal \`${CHANNEL}\`).`);
  if (userEmail) originLines.push(`O utilizador autenticado é **${userEmail}**.`);
  if (route) originLines.push(`O utilizador está na rota \`${route}\`.`);
  if (ROOT) originLines.push(`O repositório do projeto está em \`${ROOT}\` — trabalha sempre a partir daí, é o repo correcto.`);
  if (onMobile) originLines.push(`Mensagem enviada do telemóvel.`);

  const prompt =
    `[Origem: ${BRIDGE_SITE_NAME}${route ? " · " + route : ""}${userEmail ? " · " + userEmail : ""}]\n\n` +
    originLines.join(" ") +
    `\n\nPedido do utilizador:\n${text}`;

  // Enfileira no dashboard (com retry automático)
  let taskId;
  try {
    const data = await postWithRetry(`${BRIDGE_QUEUE_URL}/api/queue`, {
      prompt,
      project: BRIDGE_PROJECT || null,
      target_host: BRIDGE_TARGET_HOST || null,
      source_channel: CHANNEL,
      source_site: BRIDGE_SITE_NAME,
      source_page: route || null,
    }, BRIDGE_QUEUE_TOKEN);
    taskId = data.id;
    console.log(`\n\x1b[36m[app→queue]\x1b[0m tarefa #${taskId} enfileirada (${BRIDGE_SITE_NAME}${route ? " " + route : ""})`);
  } catch (e) {
    busy = false;
    console.error(`\x1b[31m[bridge]\x1b[0m erro ao enfileirar: ${e.message}`);
    await sendAssistantWithAck({ id: payload.id, text: `❌ Erro ao enfileirar tarefa: ${e.message}` });
    return;
  }

  // Persistir estado antes do poll — se daemon reiniciar, retoma automaticamente
  saveState({ taskId, payloadId: payload.id, channel: CHANNEL, startedAt: Date.now() });

  // Acknowledge imediato no chat (sem esperar ACK — mensagem de status, não resultado)
  await channel.send({ type: "broadcast", event: "assistant_msg", payload: {
    id: payload.id,
    text: `⏳ Tarefa #${taskId} adicionada à fila do dashboard... (a aguardar execução)`,
  }}).catch(() => {});

  await runQueuePoll(taskId, payload.id);
}

async function handle(payload) {
  // Delega para a fila do dashboard quando BRIDGE_MODE=queue
  if (BRIDGE_MODE === "queue") return handleQueue(payload);

  const text = (payload?.text || "").trim();
  if (!text) return;

  // Avisa o owner que chegou uma mensagem nova no chat deste site.
  notify(`💬 ${CHANNEL}`, text);

  if (busy) {
    await sendAssistantWithAck({ id: payload.id, text: "⏳ Ainda estou a tratar do pedido anterior — aguarda um momento." });
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
  if (payload.userEmail) ctx.push(`O utilizador autenticado é **${payload.userEmail}**.`);
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
    notify(`✅ ${CHANNEL}`, answer);
    // Mensagem final autoritativa com ACK: o cliente substitui o texto streamado (corrige deltas perdidos).
    await sendAssistantWithAck({ id: payload.id, text: answer, session: claudeSession, shot: !!shot, streamed: true });
  } catch (e) {
    clearInterval(flusher);
    const msg = `Erro ao correr o Claude Code: ${e?.message || e}`;
    console.error(`\x1b[31m[bridge]\x1b[0m ${msg}`);
    await sendAssistantWithAck({ id: payload.id, text: "❌ " + msg });
  } finally {
    busy = false;
  }
}

let heartbeatTimer = null;

function sendHeartbeat() {
  channel.send({ type: "broadcast", event: "daemon_online", payload: { ts: Date.now(), project: ROOT } }).catch(() => {});
}

// Delay de arranque: dá tempo ao event loop do Bun de estabilizar em contexto launchd
await new Promise((r) => setTimeout(r, 500));

// Carregar estado persistido (restart recovery)
const savedState = loadState();

channel
  .on("broadcast", { event: "user_msg" }, async ({ payload }) => {
    const valid = await verifyHmac(payload);
    if (!valid) {
      console.warn(`[bridge] 🔒 mensagem rejeitada (auth inválida) id=${payload?.id}`);
      // Não enviar ACK para mensagens inválidas — evita confirmar recepção de lixo
      channel.send({ type: "broadcast", event: "assistant_msg", payload: {
        id: payload?.id || "auth-err",
        text: "🔒 Acesso negado — configura o código de acesso neste browser (ver dashboard).",
        streamed: false,
      }}).catch(() => {});
      return;
    }
    // Confirmar recepção imediatamente, antes de processar
    channel.send({ type: "broadcast", event: "user_msg_ack", payload: { id: payload?.id } }).catch(() => {});
    handle(payload);
  })
  .on("broadcast", { event: "assistant_msg_ack" }, ({ payload }) => {
    // Browser confirmou que recebeu o assistant_msg — resolver a promise em pendingAssistantAcks
    const resolve = pendingAssistantAcks.get(payload?.id);
    if (resolve) { resolve(); pendingAssistantAcks.delete(payload.id); }
  })
  .subscribe((status) => {
    console.log(`[bridge] canal "${CHANNEL}": ${status}`);
    if (status === "SUBSCRIBED") {
      console.log(`[bridge] ✓ pronto (projeto: ${ROOT}). Modelo: ${MODEL || "(default do CLI)"}`);
      sendHeartbeat();
      if (!heartbeatTimer) {
        heartbeatTimer = setInterval(sendHeartbeat, 20_000);
      }
      // Restart recovery: se há tarefa activa em disco, retomar o poll
      if (savedState?.taskId && savedState?.payloadId && !busy) {
        const age = Date.now() - (savedState.startedAt || 0);
        if (age < 10 * 60_000) { // só retoma se a tarefa tem menos de 10 min
          console.log(`[bridge] restart recovery: a retomar tarefa #${savedState.taskId} (${Math.round(age / 1000)}s atrás)`);
          busy = true;
          channel.send({ type: "broadcast", event: "assistant_delta", payload: {
            id: savedState.payloadId + "-live",
            text: "\n_(daemon reiniciou — a retomar monitorização...)_\n",
          }}).catch(() => {});
          runQueuePoll(savedState.taskId, savedState.payloadId);
        } else {
          console.log(`[bridge] restart recovery: tarefa #${savedState.taskId} já tem ${Math.round(age / 60_000)}min — demasiado antiga, a limpar estado`);
          clearState();
        }
      }
    }
    if (status === "CLOSED" || status === "CHANNEL_ERROR") {
      // heartbeat timer kept running so channel.send() retries on reconnect
    }
  });

const bye = () => { clearInterval(heartbeatTimer); supabase.removeAllChannels(); process.exit(0); };
process.on("SIGINT", () => { console.log("\n[bridge] a desligar..."); bye(); });
process.on("SIGTERM", bye);
