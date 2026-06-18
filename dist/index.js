// src/useTerminalBridge.ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
var DEFAULT_HUB = {
  url: "https://pzlakqqnkvogtfvippvx.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB6bGFrcXFua3ZvZ3RmdmlwcHZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NTQzOTYsImV4cCI6MjA5MzAzMDM5Nn0.uHbz-Ft4MCLbcMPAS-tFMQhDny7XCkevUD-fBgW0euQ"
};
var uid = () => typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
var notifySupported = () => typeof window !== "undefined" && "Notification" in window;
var secretKey = (channel) => `tb-secret:${channel}`;
var readSecret = (channel) => {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(secretKey(channel)) || "";
  } catch {
    return "";
  }
};
var writeSecret = (channel, s) => {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(secretKey(channel), s);
  } catch {
  }
};
async function signMessage(secret, id, ts, text) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const buf = await crypto.subtle.sign("HMAC", key, enc.encode(`${id}.${ts}.${text}`));
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
var notifyPrefKey = (channel) => `tb-notify:${channel}`;
var readNotifyPref = (channel) => {
  try {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(notifyPrefKey(channel)) !== "0";
  } catch {
    return true;
  }
};
var writeNotifyPref = (channel, on) => {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(notifyPrefKey(channel), on ? "1" : "0");
  } catch {
  }
};
var audioCtx = null;
function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx || new Ctx();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.05;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.12);
  } catch {
  }
}
async function captureScreenSmall(maxB64 = 18e4) {
  try {
    const { domToJpeg } = await import("modern-screenshot");
    const vw = window.innerWidth || 720;
    const scale = Math.min(1, 720 / vw);
    for (const quality of [0.6, 0.45, 0.3]) {
      const dataUrl = await domToJpeg(document.body, {
        quality,
        scale,
        backgroundColor: "#ffffff",
        filter: (node) => !(node instanceof HTMLElement && node.dataset?.terminalBridgeIgnore === "true")
      });
      const b64 = dataUrl.split(",")[1] || "";
      if (b64.length <= maxB64) return dataUrl;
    }
    return null;
  } catch {
    return null;
  }
}
function useTerminalBridge(opts = {}) {
  const { supabase, channel = "terminal-bridge", enabled = true, captureMobileScreen = true, notify = true } = opts;
  const client = useMemo(
    () => supabase ?? createClient(DEFAULT_HUB.url, DEFAULT_HUB.anonKey, { auth: { persistSession: false } }),
    [supabase]
  );
  const [messages, setMessages] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [online, setOnline] = useState(false);
  const channelRef = useRef(null);
  const pendingAcks = useRef(/* @__PURE__ */ new Map());
  const [secret, setSecret] = useState(() => readSecret(channel));
  const locked = !secret;
  const unlock = useCallback((s) => {
    const trimmed = s.trim();
    writeSecret(channel, trimmed);
    setSecret(trimmed);
  }, [channel]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const urlSecret = params.get("tb-secret");
    if (urlSecret) {
      unlock(urlSecret);
      params.delete("tb-secret");
      const newSearch = params.toString();
      const newUrl = window.location.pathname + (newSearch ? "?" + newSearch : "") + window.location.hash;
      window.history.replaceState(null, "", newUrl);
    }
    setSecret(readSecret(channel));
  }, [channel, unlock]);
  const [permission, setPermission] = useState(
    () => notifySupported() ? Notification.permission : "unsupported"
  );
  const [notifyOn, setNotifyOn] = useState(() => readNotifyPref(channel));
  useEffect(() => {
    setPermission(notifySupported() ? Notification.permission : "unsupported");
    setNotifyOn(readNotifyPref(channel));
  }, [channel]);
  const notificationsOn = notify && notifyOn && permission === "granted";
  const enableNotifications = useCallback(async () => {
    if (!notifySupported()) return;
    let p = Notification.permission;
    if (p === "default") {
      try {
        p = await Notification.requestPermission();
      } catch {
      }
    }
    setPermission(p);
    if (p === "granted") {
      setNotifyOn(true);
      writeNotifyPref(channel, true);
    }
  }, [channel]);
  const disableNotifications = useCallback(() => {
    setNotifyOn(false);
    writeNotifyPref(channel, false);
  }, [channel]);
  const flashRef = useRef(null);
  const stopFlash = useCallback(() => {
    if (flashRef.current) {
      clearInterval(flashRef.current.timer);
      document.title = flashRef.current.original;
      flashRef.current = null;
    }
  }, []);
  const startFlash = useCallback((label) => {
    if (typeof document === "undefined" || flashRef.current) return;
    const original = document.title;
    let on = false;
    const timer = setInterval(() => {
      document.title = (on = !on) ? label : original;
    }, 1e3);
    flashRef.current = { timer, original };
  }, []);
  useEffect(() => {
    const onVisible = () => {
      if (typeof document !== "undefined" && !document.hidden) stopFlash();
    };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
    if (typeof window !== "undefined") window.addEventListener("focus", onVisible);
    return () => {
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
      if (typeof window !== "undefined") window.removeEventListener("focus", onVisible);
      stopFlash();
    };
  }, [stopFlash]);
  const pushNotification = useCallback(
    (title, body) => {
      if (!notificationsOn) return;
      if (typeof document !== "undefined" && !document.hidden) return;
      try {
        new Notification(title, { body: (body || "").slice(0, 180), tag: channel });
      } catch {
      }
      beep();
      startFlash("\u{1F4AC} " + title);
    },
    [notificationsOn, channel, startFlash]
  );
  const notifyRef = useRef(pushNotification);
  notifyRef.current = pushNotification;
  useEffect(() => {
    if (!enabled) return;
    const ch = client.channel(channel, { config: { broadcast: { self: false } } });
    const akey = (id) => (id || uid()) + "-a";
    const upsertAssistant = (id, mut, seed) => setMessages((m) => {
      const key = akey(id);
      const idx = m.findIndex((x) => x.id === key);
      if (idx === -1) {
        return [...m, mut({ id: key, role: "assistant", content: "", ...seed })];
      }
      const copy = m.slice();
      copy[idx] = mut(copy[idx]);
      return copy;
    });
    ch.on("broadcast", { event: "assistant_delta" }, ({ payload }) => {
      upsertAssistant(payload.id, (msg) => ({ ...msg, content: msg.content + (payload.text || ""), streaming: true }));
      setIsStreaming(true);
    });
    ch.on("broadcast", { event: "tool_use" }, ({ payload }) => {
      if (!payload.summary) return;
      upsertAssistant(payload.id, (msg) => ({ ...msg, tools: [...msg.tools || [], payload.summary], streaming: true }));
      setIsStreaming(true);
    });
    ch.on("broadcast", { event: "assistant_msg" }, ({ payload }) => {
      upsertAssistant(payload.id, (msg) => ({ ...msg, content: payload.text, streaming: false }));
      setIsStreaming(false);
      notifyRef.current("Resposta do terminal", payload.text || "");
      ch.send({ type: "broadcast", event: "assistant_msg_ack", payload: { id: payload.id } }).catch(() => {
      });
    });
    ch.on("broadcast", { event: "user_msg_ack" }, ({ payload }) => {
      const resolve = pendingAcks.current.get(payload?.id);
      if (resolve) {
        resolve();
        pendingAcks.current.delete(payload.id);
      }
    });
    ch.on("broadcast", { event: "user_msg" }, ({ payload }) => {
      if (!payload?.id) return;
      setMessages((m) => m.some((x) => x.id === payload.id) ? m : [...m, { id: payload.id, role: "user", content: payload.text || "" }]);
      notifyRef.current("Nova mensagem no chat", payload.text || "");
    });
    const refresh = () => {
      const state = ch.presenceState();
      setOnline(Object.keys(state).length > 0);
    };
    ch.on("presence", { event: "sync" }, refresh);
    ch.on("presence", { event: "join" }, refresh);
    ch.on("presence", { event: "leave" }, refresh);
    ch.subscribe();
    channelRef.current = ch;
    return () => {
      client.removeChannel(ch);
      channelRef.current = null;
      setOnline(false);
    };
  }, [client, channel, enabled]);
  const sendMessage = useCallback(
    async (content) => {
      const text = content.trim();
      if (!text || isStreaming) return;
      const id = uid();
      setMessages((m) => [...m, { id, role: "user", content: text }]);
      if (!online) {
        setMessages((m) => [
          ...m,
          {
            id: id + "-off",
            role: "assistant",
            content: "\u26A0\uFE0F O terminal est\xE1 offline \u2014 liga o Mac e confirma que o daemon est\xE1 a correr (o indicador fica verde). Depois tenta de novo."
          }
        ]);
        return;
      }
      setIsStreaming(true);
      const ts = Date.now();
      const route = window.location.pathname + window.location.search;
      const device = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? "mobile" : "desktop";
      const image = device === "mobile" && captureMobileScreen ? await captureScreenSmall() : null;
      const sig = secret ? await signMessage(secret, id, ts, text).catch(() => void 0) : void 0;
      const msgPayload = { id, text, ts, sig, route, device, image };
      const MAX_RETRIES = 3;
      const ACK_TIMEOUT_MS = 6e3;
      const RETRY_DELAYS = [0, 2e3, 6e4];
      let delivered = false;
      for (let attempt = 0; attempt < MAX_RETRIES && !delivered; attempt++) {
        if (RETRY_DELAYS[attempt] > 0) await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
        await channelRef.current?.send({ type: "broadcast", event: "user_msg", payload: msgPayload });
        delivered = await new Promise((resolve) => {
          const timer = setTimeout(() => {
            pendingAcks.current.delete(id);
            resolve(false);
          }, ACK_TIMEOUT_MS);
          pendingAcks.current.set(id, () => {
            clearTimeout(timer);
            resolve(true);
          });
        });
      }
      if (!delivered) {
        setMessages((m) => [
          ...m,
          { id: id + "-no-ack", role: "assistant", content: "\u26A0\uFE0F Mensagem enviada mas o daemon n\xE3o confirmou recep\xE7\xE3o. Verifica se o terminal bridge est\xE1 online." }
        ]);
        setIsStreaming(false);
      }
    },
    [isStreaming, online, captureMobileScreen, secret, pendingAcks]
  );
  return {
    messages,
    isStreaming,
    online,
    sendMessage,
    locked,
    unlock,
    notificationPermission: permission,
    notificationsOn,
    enableNotifications,
    disableNotifications
  };
}

// src/TerminalChat.tsx
import { useEffect as useEffect2, useRef as useRef2, useState as useState2 } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
function TerminalChat({
  supabase,
  channel,
  enabled = true,
  title = "Terminal",
  placeholder = "Escreve uma mensagem\u2026"
}) {
  const {
    messages,
    isStreaming,
    online,
    sendMessage,
    locked,
    unlock,
    notificationPermission,
    notificationsOn,
    enableNotifications,
    disableNotifications
  } = useTerminalBridge({ supabase, channel, enabled });
  const [input, setInput] = useState2("");
  const [codeInput, setCodeInput] = useState2("");
  const listRef = useRef2(null);
  useEffect2(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isStreaming]);
  const submit = () => {
    const t = input.trim();
    if (!t) return;
    setInput("");
    void sendMessage(t);
  };
  return /* @__PURE__ */ jsxs(
    "div",
    {
      "data-terminal-bridge-ignore": "true",
      style: {
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#0b0f17",
        color: "#e5e7eb",
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontSize: 14
      },
      children: [
        /* @__PURE__ */ jsx("style", { children: "@keyframes tb-blink{0%,49%{opacity:1}50%,100%{opacity:0}}.tb-caret{animation:tb-blink 1s step-end infinite;margin-left:1px}" }),
        /* @__PURE__ */ jsxs(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 14px",
              borderBottom: "1px solid #1f2937"
            },
            children: [
              /* @__PURE__ */ jsx("span", { style: { fontWeight: 600 }, children: title }),
              /* @__PURE__ */ jsxs(
                "span",
                {
                  style: {
                    marginLeft: "auto",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 12,
                    color: online ? "#22c55e" : "#ef4444"
                  },
                  children: [
                    /* @__PURE__ */ jsx(
                      "span",
                      {
                        style: {
                          width: 8,
                          height: 8,
                          borderRadius: 9999,
                          background: online ? "#22c55e" : "#ef4444",
                          boxShadow: online ? "0 0 6px #22c55e" : "none"
                        }
                      }
                    ),
                    online ? "online" : "offline"
                  ]
                }
              ),
              notificationPermission !== "unsupported" && /* @__PURE__ */ jsx(
                "button",
                {
                  onClick: () => notificationsOn ? disableNotifications() : void enableNotifications(),
                  title: notificationPermission === "denied" ? "Notifica\xE7\xF5es bloqueadas no browser \u2014 ativa-as nas defini\xE7\xF5es do site" : notificationsOn ? "Notifica\xE7\xF5es ligadas \u2014 clica para desligar" : "Ligar notifica\xE7\xF5es de novas mensagens",
                  style: {
                    marginLeft: 4,
                    background: "transparent",
                    border: "none",
                    color: notificationsOn ? "#22c55e" : "#6b7280",
                    cursor: "pointer",
                    fontSize: 13,
                    padding: 0
                  },
                  children: notificationsOn ? "\u{1F514}" : "\u{1F515}"
                }
              )
            ]
          }
        ),
        locked ? (
          /* Ecrã de bloqueio — pedir código de acesso */
          /* @__PURE__ */ jsxs("div", { style: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 24 }, children: [
            /* @__PURE__ */ jsx("span", { style: { fontSize: 32 }, children: "\u{1F512}" }),
            /* @__PURE__ */ jsxs("p", { style: { color: "#9ca3af", textAlign: "center", margin: 0, fontSize: 13, maxWidth: 280 }, children: [
              "Este canal requer um c\xF3digo de acesso.",
              /* @__PURE__ */ jsx("br", {}),
              "Obt\xE9m o link de liga\xE7\xE3o no dashboard e abre-o neste browser, ou introduz o c\xF3digo manualmente."
            ] }),
            /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 8, width: "100%", maxWidth: 320 }, children: [
              /* @__PURE__ */ jsx(
                "input",
                {
                  type: "password",
                  value: codeInput,
                  onChange: (e) => setCodeInput(e.target.value),
                  onKeyDown: (e) => {
                    if (e.key === "Enter" && codeInput.trim()) {
                      unlock(codeInput.trim());
                      setCodeInput("");
                    }
                  },
                  placeholder: "C\xF3digo de acesso\u2026",
                  autoFocus: true,
                  style: {
                    flex: 1,
                    background: "#111827",
                    color: "#e5e7eb",
                    border: "1px solid #374151",
                    borderRadius: 8,
                    padding: "8px 10px",
                    fontFamily: "inherit",
                    fontSize: 14,
                    outline: "none"
                  }
                }
              ),
              /* @__PURE__ */ jsx(
                "button",
                {
                  onClick: () => {
                    if (codeInput.trim()) {
                      unlock(codeInput.trim());
                      setCodeInput("");
                    }
                  },
                  disabled: !codeInput.trim(),
                  style: {
                    background: codeInput.trim() ? "#2563eb" : "#374151",
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    padding: "0 14px",
                    cursor: codeInput.trim() ? "pointer" : "default",
                    fontWeight: 600,
                    fontSize: 13
                  },
                  children: "OK"
                }
              )
            ] })
          ] })
        ) : /* @__PURE__ */ jsxs(Fragment, { children: [
          /* @__PURE__ */ jsxs("div", { ref: listRef, style: { flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 10 }, children: [
            messages.length === 0 && /* @__PURE__ */ jsx("p", { style: { color: "#6b7280", textAlign: "center", marginTop: 24 }, children: online ? "Liga-te ao Claude Code da tua m\xE1quina. Escreve abaixo." : "\xC0 espera do terminal\u2026" }),
            messages.map((m) => /* @__PURE__ */ jsxs(
              "div",
              {
                style: {
                  alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "85%",
                  padding: "8px 12px",
                  borderRadius: 12,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  background: m.role === "user" ? "#2563eb" : "#1f2937",
                  color: m.role === "user" ? "#fff" : "#e5e7eb"
                },
                children: [
                  m.tools && m.tools.length > 0 && /* @__PURE__ */ jsx("div", { style: { marginBottom: m.content ? 6 : 0, display: "flex", flexDirection: "column", gap: 2 }, children: m.tools.map((t, i) => /* @__PURE__ */ jsxs("span", { style: { color: "#9ca3af", fontSize: 12, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }, children: [
                    "\u25B8 ",
                    t
                  ] }, i)) }),
                  m.content,
                  m.streaming && /* @__PURE__ */ jsx("span", { style: { opacity: 0.6 }, className: "tb-caret", children: "\u258B" })
                ]
              },
              m.id
            )),
            isStreaming && !messages.some((m) => m.streaming) && /* @__PURE__ */ jsx("div", { style: { alignSelf: "flex-start", color: "#9ca3af", fontStyle: "italic" }, children: "a pensar\u2026" })
          ] }),
          /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 8, padding: 10, borderTop: "1px solid #1f2937" }, children: [
            /* @__PURE__ */ jsx(
              "textarea",
              {
                value: input,
                onChange: (e) => setInput(e.target.value),
                onKeyDown: (e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                },
                placeholder,
                rows: 1,
                style: {
                  flex: 1,
                  resize: "none",
                  background: "#111827",
                  color: "#e5e7eb",
                  border: "1px solid #374151",
                  borderRadius: 8,
                  padding: "8px 10px",
                  fontFamily: "inherit",
                  fontSize: 14,
                  outline: "none"
                }
              }
            ),
            /* @__PURE__ */ jsx(
              "button",
              {
                onClick: submit,
                disabled: isStreaming || !input.trim(),
                style: {
                  background: isStreaming || !input.trim() ? "#374151" : "#2563eb",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  padding: "0 16px",
                  cursor: isStreaming || !input.trim() ? "default" : "pointer",
                  fontWeight: 600
                },
                children: "\u27A4"
              }
            )
          ] })
        ] })
      ]
    }
  );
}
export {
  TerminalChat,
  useTerminalBridge
};
//# sourceMappingURL=index.js.map