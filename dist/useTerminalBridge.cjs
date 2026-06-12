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

// src/useTerminalBridge.ts
var useTerminalBridge_exports = {};
__export(useTerminalBridge_exports, {
  DEFAULT_HUB: () => DEFAULT_HUB,
  useTerminalBridge: () => useTerminalBridge
});
module.exports = __toCommonJS(useTerminalBridge_exports);
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEFAULT_HUB,
  useTerminalBridge
});
//# sourceMappingURL=useTerminalBridge.cjs.map