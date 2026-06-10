// src/useTerminalBridge.ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
var DEFAULT_HUB = {
  url: "https://pzlakqqnkvogtfvippvx.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB6bGFrcXFua3ZvZ3RmdmlwcHZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NTQzOTYsImV4cCI6MjA5MzAzMDM5Nn0.uHbz-Ft4MCLbcMPAS-tFMQhDny7XCkevUD-fBgW0euQ"
};
var uid = () => typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
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
  const { supabase, channel = "terminal-bridge", enabled = true, captureMobileScreen = true } = opts;
  const client = useMemo(
    () => supabase ?? createClient(DEFAULT_HUB.url, DEFAULT_HUB.anonKey, { auth: { persistSession: false } }),
    [supabase]
  );
  const [messages, setMessages] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [online, setOnline] = useState(false);
  const channelRef = useRef(null);
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
  return { messages, isStreaming, online, sendMessage };
}

// src/TerminalChat.tsx
import { useEffect as useEffect2, useRef as useRef2, useState as useState2 } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
function TerminalChat({
  supabase,
  channel,
  enabled = true,
  title = "Terminal",
  placeholder = "Escreve uma mensagem\u2026"
}) {
  const { messages, isStreaming, online, sendMessage } = useTerminalBridge({ supabase, channel, enabled });
  const [input, setInput] = useState2("");
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
              )
            ]
          }
        ),
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
      ]
    }
  );
}
export {
  TerminalChat,
  useTerminalBridge
};
//# sourceMappingURL=index.js.map