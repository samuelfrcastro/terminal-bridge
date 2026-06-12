"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  TerminalChat: () => TerminalChat,
  useTerminalBridge: () => useTerminalBridge
});
module.exports = __toCommonJS(index_exports);

// src/useTerminalBridge.ts
var import_react = require("react");
var import_supabase_js = require("@supabase/supabase-js");
var DEFAULT_HUB = {
  url: "https://pzlakqqnkvogtfvippvx.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB6bGFrcXFua3ZvZ3RmdmlwcHZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NTQzOTYsImV4cCI6MjA5MzAzMDM5Nn0.uHbz-Ft4MCLbcMPAS-tFMQhDny7XCkevUD-fBgW0euQ"
};
var uid = () => typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
var notifySupported = () => typeof window !== "undefined" && "Notification" in window;
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
  const client = (0, import_react.useMemo)(
    () => supabase ?? (0, import_supabase_js.createClient)(DEFAULT_HUB.url, DEFAULT_HUB.anonKey, { auth: { persistSession: false } }),
    [supabase]
  );
  const [messages, setMessages] = (0, import_react.useState)([]);
  const [isStreaming, setIsStreaming] = (0, import_react.useState)(false);
  const [online, setOnline] = (0, import_react.useState)(false);
  const channelRef = (0, import_react.useRef)(null);
  const [permission, setPermission] = (0, import_react.useState)(
    () => notifySupported() ? Notification.permission : "unsupported"
  );
  const [notifyOn, setNotifyOn] = (0, import_react.useState)(() => readNotifyPref(channel));
  (0, import_react.useEffect)(() => {
    setPermission(notifySupported() ? Notification.permission : "unsupported");
    setNotifyOn(readNotifyPref(channel));
  }, [channel]);
  const notificationsOn = notify && notifyOn && permission === "granted";
  const enableNotifications = (0, import_react.useCallback)(async () => {
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
  const disableNotifications = (0, import_react.useCallback)(() => {
    setNotifyOn(false);
    writeNotifyPref(channel, false);
  }, [channel]);
  const flashRef = (0, import_react.useRef)(null);
  const stopFlash = (0, import_react.useCallback)(() => {
    if (flashRef.current) {
      clearInterval(flashRef.current.timer);
      document.title = flashRef.current.original;
      flashRef.current = null;
    }
  }, []);
  const startFlash = (0, import_react.useCallback)((label) => {
    if (typeof document === "undefined" || flashRef.current) return;
    const original = document.title;
    let on = false;
    const timer = setInterval(() => {
      document.title = (on = !on) ? label : original;
    }, 1e3);
    flashRef.current = { timer, original };
  }, []);
  (0, import_react.useEffect)(() => {
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
  const pushNotification = (0, import_react.useCallback)(
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
  const notifyRef = (0, import_react.useRef)(pushNotification);
  notifyRef.current = pushNotification;
  (0, import_react.useEffect)(() => {
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
  const sendMessage = (0, import_react.useCallback)(
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
      const route = window.location.pathname + window.location.search;
      const device = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? "mobile" : "desktop";
      const image = device === "mobile" && captureMobileScreen ? await captureScreenSmall() : null;
      await channelRef.current?.send({
        type: "broadcast",
        event: "user_msg",
        payload: { id, text, route, device, image }
      });
    },
    [isStreaming, online, captureMobileScreen]
  );
  return {
    messages,
    isStreaming,
    online,
    sendMessage,
    notificationPermission: permission,
    notificationsOn,
    enableNotifications,
    disableNotifications
  };
}

// src/TerminalChat.tsx
var import_react2 = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
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
    notificationPermission,
    notificationsOn,
    enableNotifications,
    disableNotifications
  } = useTerminalBridge({ supabase, channel, enabled });
  const [input, setInput] = (0, import_react2.useState)("");
  const listRef = (0, import_react2.useRef)(null);
  (0, import_react2.useEffect)(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isStreaming]);
  const submit = () => {
    const t = input.trim();
    if (!t) return;
    setInput("");
    void sendMessage(t);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
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
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("style", { children: "@keyframes tb-blink{0%,49%{opacity:1}50%,100%{opacity:0}}.tb-caret{animation:tb-blink 1s step-end infinite;margin-left:1px}" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
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
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontWeight: 600 }, children: title }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
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
                    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
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
              notificationPermission !== "unsupported" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
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
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { ref: listRef, style: { flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 10 }, children: [
            messages.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { color: "#6b7280", textAlign: "center", marginTop: 24 }, children: online ? "Liga-te ao Claude Code da tua m\xE1quina. Escreve abaixo." : "\xC0 espera do terminal\u2026" }),
            messages.map((m) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
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
                  m.tools && m.tools.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { marginBottom: m.content ? 6 : 0, display: "flex", flexDirection: "column", gap: 2 }, children: m.tools.map((t, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { color: "#9ca3af", fontSize: 12, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }, children: [
                    "\u25B8 ",
                    t
                  ] }, i)) }),
                  m.content,
                  m.streaming && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { opacity: 0.6 }, className: "tb-caret", children: "\u258B" })
                ]
              },
              m.id
            )),
            isStreaming && !messages.some((m) => m.streaming) && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { alignSelf: "flex-start", color: "#9ca3af", fontStyle: "italic" }, children: "a pensar\u2026" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { display: "flex", gap: 8, padding: 10, borderTop: "1px solid #1f2937" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
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
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  TerminalChat,
  useTerminalBridge
});
//# sourceMappingURL=index.cjs.map