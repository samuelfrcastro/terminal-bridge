// src/useTerminalBridge.ts
import { useCallback, useEffect, useRef, useState } from "react";
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
function useTerminalBridge(opts) {
  const { supabase, channel = "terminal-bridge", enabled = true, captureMobileScreen = true } = opts;
  const [messages, setMessages] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [online, setOnline] = useState(false);
  const channelRef = useRef(null);
  useEffect(() => {
    if (!enabled) return;
    const ch = supabase.channel(channel, { config: { broadcast: { self: false } } });
    ch.on("broadcast", { event: "assistant_msg" }, ({ payload }) => {
      setMessages((m) => [
        ...m,
        { id: (payload.id || uid()) + "-a", role: "assistant", content: payload.text }
      ]);
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
      supabase.removeChannel(ch);
      channelRef.current = null;
      setOnline(false);
    };
  }, [supabase, channel, enabled]);
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
          messages.map((m) => /* @__PURE__ */ jsx(
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
              children: m.content
            },
            m.id
          )),
          isStreaming && /* @__PURE__ */ jsx("div", { style: { alignSelf: "flex-start", color: "#9ca3af", fontStyle: "italic" }, children: "a pensar\u2026" })
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