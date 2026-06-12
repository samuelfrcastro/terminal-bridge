import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface BridgeMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Linhas de atividade de ferramentas (ex. "Read src/Header.tsx"), durante o stream. */
  tools?: string[];
  /** true enquanto ainda chegam deltas desta resposta. */
  streaming?: boolean;
}

/**
 * Hub Realtime partilhado por todos os sites. Broadcast é efémero (sem tabelas,
 * sem dados) e os canais são isolados por site, por isso um hub comum é seguro e
 * evita depender do Realtime do Supabase de cada app (que pode estar quebrado,
 * ex. projetos Lovable Cloud). A anon key é pública por design.
 */
export const DEFAULT_HUB = {
  url: 'https://pzlakqqnkvogtfvippvx.supabase.co',
  anonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB6bGFrcXFua3ZvZ3RmdmlwcHZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NTQzOTYsImV4cCI6MjA5MzAzMDM5Nn0.uHbz-Ft4MCLbcMPAS-tFMQhDny7XCkevUD-fBgW0euQ',
};

export interface UseTerminalBridgeOptions {
  /** Cliente Supabase a usar. Se omitido, usa o hub Realtime partilhado (DEFAULT_HUB). */
  supabase?: SupabaseClient;
  /** Nome do canal Realtime — único por site (ex. 'bridge-iocmanager'). */
  channel?: string;
  /** Liga/desliga a ponte (default true). */
  enabled?: boolean;
  /** No telemóvel, capturar a própria página e enviá-la ao daemon (default true). */
  captureMobileScreen?: boolean;
  /** Mostrar notificações do browser em mensagens novas (default true; precisa de permissão). */
  notify?: boolean;
}

export interface TerminalBridge {
  messages: BridgeMessage[];
  isStreaming: boolean;
  /** true enquanto o daemon (Claude Code) estiver presente no canal. */
  online: boolean;
  sendMessage: (content: string) => Promise<void>;
  /** true quando ainda não há código de acesso guardado (chat trancado). */
  locked: boolean;
  /** Guarda o código de acesso (no localStorage, por canal) e destranca. */
  unlock: (code: string) => void;
  /** Esquece o código guardado (volta a trancar) — para corrigir um código errado. */
  relock: () => void;
  /** Estado da permissão de notificações do browser ('unsupported' se indisponível). */
  notificationPermission: NotificationPermission | 'unsupported';
  /** true quando as notificações estão activas (permissão concedida + ligadas). */
  notificationsOn: boolean;
  /** Pede permissão ao browser e liga as notificações. */
  enableNotifications: () => Promise<void>;
  /** Desliga as notificações (mantém a permissão concedida). */
  disableNotifications: () => void;
}

const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

/** Chave de localStorage do código de acesso, isolada por canal. */
const secretKey = (channel: string) => `tb-secret:${channel}`;
const readSecret = (channel: string): string => {
  try {
    return typeof window !== 'undefined' ? window.localStorage.getItem(secretKey(channel)) || '' : '';
  } catch {
    return '';
  }
};

/** Notificações disponíveis neste ambiente (browser com a API Notification). */
const notifySupported = () => typeof window !== 'undefined' && 'Notification' in window;

/** Preferência de notificações (ligadas/desligadas), por canal — default ligadas. */
const notifyPrefKey = (channel: string) => `tb-notify:${channel}`;
const readNotifyPref = (channel: string): boolean => {
  try {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem(notifyPrefKey(channel)) !== '0';
  } catch {
    return true;
  }
};
const writeNotifyPref = (channel: string, on: boolean) => {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(notifyPrefKey(channel), on ? '1' : '0');
  } catch {}
};

/** Beep curto via WebAudio (reutiliza o AudioContext). Falha em silêncio. */
let audioCtx: AudioContext | null = null;
function beep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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
  } catch {}
}

/** HMAC-SHA256(secret, msg) em hex, via WebCrypto. Assina cada mensagem sem expor o código. */
async function hmacHex(secret: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Captura a página atual como JPEG pequeno (base64) para o daemon ler. Lazy-load da lib. */
async function captureScreenSmall(maxB64 = 180_000): Promise<string | null> {
  try {
    const { domToJpeg } = await import('modern-screenshot');
    const vw = window.innerWidth || 720;
    const scale = Math.min(1, 720 / vw);
    for (const quality of [0.6, 0.45, 0.3]) {
      const dataUrl = await domToJpeg(document.body, {
        quality,
        scale,
        backgroundColor: '#ffffff',
        filter: (node: Node) =>
          !(node instanceof HTMLElement && node.dataset?.terminalBridgeIgnore === 'true'),
      });
      const b64 = dataUrl.split(',')[1] || '';
      if (b64.length <= maxB64) return dataUrl;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Liga o chat ao Claude Code que corre na máquina do owner, via Supabase Realtime.
 * Online/offline por Presence (sem mensagens periódicas). Genérico: serve qualquer site.
 */
export function useTerminalBridge(opts: UseTerminalBridgeOptions = {}): TerminalBridge {
  const { supabase, channel = 'terminal-bridge', enabled = true, captureMobileScreen = true, notify = true } = opts;

  // Usa o supabase fornecido, ou cria (uma vez) um client do hub partilhado.
  const client = useMemo(
    () => supabase ?? createClient(DEFAULT_HUB.url, DEFAULT_HUB.anonKey, { auth: { persistSession: false } }),
    [supabase]
  );

  const [messages, setMessages] = useState<BridgeMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [online, setOnline] = useState(false);
  const channelRef = useRef<ReturnType<SupabaseClient['channel']> | null>(null);

  // Código de acesso (HMAC). Guardado no localStorage por canal; nunca vai no bundle.
  const [secret, setSecret] = useState<string>(() => readSecret(channel));
  useEffect(() => { setSecret(readSecret(channel)); }, [channel]);
  const unlock = useCallback(
    (code: string) => {
      const c = code.trim();
      try { if (typeof window !== 'undefined') window.localStorage.setItem(secretKey(channel), c); } catch {}
      setSecret(c);
    },
    [channel]
  );
  const relock = useCallback(() => {
    try { if (typeof window !== 'undefined') window.localStorage.removeItem(secretKey(channel)); } catch {}
    setSecret('');
  }, [channel]);

  // Notificações do browser: permissão + toggle (guardado por canal).
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    notifySupported() ? Notification.permission : 'unsupported'
  );
  const [notifyOn, setNotifyOn] = useState<boolean>(() => readNotifyPref(channel));
  useEffect(() => {
    setPermission(notifySupported() ? Notification.permission : 'unsupported');
    setNotifyOn(readNotifyPref(channel));
  }, [channel]);

  const notificationsOn = notify && notifyOn && permission === 'granted';

  const enableNotifications = useCallback(async () => {
    if (!notifySupported()) return;
    let p = Notification.permission;
    if (p === 'default') {
      try { p = await Notification.requestPermission(); } catch {}
    }
    setPermission(p);
    if (p === 'granted') { setNotifyOn(true); writeNotifyPref(channel, true); }
  }, [channel]);

  const disableNotifications = useCallback(() => {
    setNotifyOn(false);
    writeNotifyPref(channel, false);
  }, [channel]);

  // Flash do título da aba até voltar ao foco — chama a atenção mesmo noutro separador.
  const flashRef = useRef<{ timer: ReturnType<typeof setInterval>; original: string } | null>(null);
  const stopFlash = useCallback(() => {
    if (flashRef.current) {
      clearInterval(flashRef.current.timer);
      document.title = flashRef.current.original;
      flashRef.current = null;
    }
  }, []);
  const startFlash = useCallback((label: string) => {
    if (typeof document === 'undefined' || flashRef.current) return;
    const original = document.title;
    let on = false;
    const timer = setInterval(() => { document.title = (on = !on) ? label : original; }, 1000);
    flashRef.current = { timer, original };
  }, []);
  useEffect(() => {
    const onVisible = () => { if (typeof document !== 'undefined' && !document.hidden) stopFlash(); };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    if (typeof window !== 'undefined') window.addEventListener('focus', onVisible);
    return () => {
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
      if (typeof window !== 'undefined') window.removeEventListener('focus', onVisible);
      stopFlash();
    };
  }, [stopFlash]);

  // Dispara a notificação (só com a aba em segundo plano, para não duplicar o que já se vê).
  const pushNotification = useCallback(
    (title: string, body: string) => {
      if (!notificationsOn) return;
      if (typeof document !== 'undefined' && !document.hidden) return;
      try { new Notification(title, { body: (body || '').slice(0, 180), tag: channel }); } catch {}
      beep();
      startFlash('💬 ' + title);
    },
    [notificationsOn, channel, startFlash]
  );
  // Ref para os listeners do canal usarem sempre a versão actual sem re-subscrever.
  const notifyRef = useRef(pushNotification);
  notifyRef.current = pushNotification;

  useEffect(() => {
    if (!enabled) return;
    const ch = client.channel(channel, { config: { broadcast: { self: false } } });

    // Chave da mensagem do assistente para um dado pedido (id da mensagem do user).
    const akey = (id?: string) => (id || uid()) + '-a';

    // Upsert: aplica `mut` à mensagem do assistente existente, ou cria uma nova.
    const upsertAssistant = (id: string, mut: (msg: BridgeMessage) => BridgeMessage, seed?: Partial<BridgeMessage>) =>
      setMessages((m) => {
        const key = akey(id);
        const idx = m.findIndex((x) => x.id === key);
        if (idx === -1) {
          return [...m, mut({ id: key, role: 'assistant', content: '', ...seed })];
        }
        const copy = m.slice();
        copy[idx] = mut(copy[idx]);
        return copy;
      });

    // Token de texto (throttled no daemon): acumula no balão e mantém o estado de stream.
    ch.on('broadcast', { event: 'assistant_delta' }, ({ payload }: any) => {
      upsertAssistant(payload.id, (msg) => ({ ...msg, content: msg.content + (payload.text || ''), streaming: true }));
      setIsStreaming(true);
    });

    // Atividade de ferramenta (ex. "Read src/Header.tsx") — linha cinzenta acima do texto.
    ch.on('broadcast', { event: 'tool_use' }, ({ payload }: any) => {
      if (!payload.summary) return;
      upsertAssistant(payload.id, (msg) => ({ ...msg, tools: [...(msg.tools || []), payload.summary], streaming: true }));
      setIsStreaming(true);
    });

    // Mensagem final autoritativa: substitui o texto streamado e termina o stream.
    ch.on('broadcast', { event: 'assistant_msg' }, ({ payload }: any) => {
      upsertAssistant(payload.id, (msg) => ({ ...msg, content: payload.text, streaming: false }));
      setIsStreaming(false);
      notifyRef.current('Resposta do terminal', payload.text || '');
    });

    // Mensagem de outro visitante no mesmo chat (self:false → nunca o eco do próprio).
    // Mostra-a também na lista, para o chat ficar coerente entre quem o estiver a ver.
    ch.on('broadcast', { event: 'user_msg' }, ({ payload }: any) => {
      if (!payload?.id) return;
      setMessages((m) => (m.some((x) => x.id === payload.id) ? m : [...m, { id: payload.id, role: 'user', content: payload.text || '' }]));
      notifyRef.current('Nova mensagem no chat', payload.text || '');
    });

    // Presence: online = o daemon "terminal" está presente. Sem batimentos periódicos.
    const refresh = () => {
      const state = ch.presenceState() as Record<string, unknown[]>;
      setOnline(Object.keys(state).length > 0);
    };
    ch.on('presence', { event: 'sync' }, refresh);
    ch.on('presence', { event: 'join' }, refresh);
    ch.on('presence', { event: 'leave' }, refresh);

    ch.subscribe();
    channelRef.current = ch;

    return () => {
      client.removeChannel(ch);
      channelRef.current = null;
      setOnline(false);
    };
  }, [client, channel, enabled]);

  const sendMessage = useCallback(
    async (content: string) => {
      const text = content.trim();
      if (!text || isStreaming) return;
      if (!secret) {
        setMessages((m) => [
          ...m,
          { id: uid() + '-lock', role: 'assistant', content: '🔒 Introduz o código de acesso para usar o terminal.' },
        ]);
        return;
      }
      const id = uid();
      setMessages((m) => [...m, { id, role: 'user', content: text }]);

      if (!online) {
        setMessages((m) => [
          ...m,
          {
            id: id + '-off',
            role: 'assistant',
            content:
              '⚠️ O terminal está offline — liga o Mac e confirma que o daemon está a correr (o indicador fica verde). Depois tenta de novo.',
          },
        ]);
        return;
      }

      setIsStreaming(true);
      const route = window.location.pathname + window.location.search;
      const device = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? 'mobile' : 'desktop';
      const image = device === 'mobile' && captureMobileScreen ? await captureScreenSmall() : null;
      // Assina a mensagem com o código (HMAC + timestamp) — o daemon só corre se bater certo.
      const ts = Date.now();
      const sig = await hmacHex(secret, `${id}.${ts}.${text}`);
      await channelRef.current?.send({
        type: 'broadcast',
        event: 'user_msg',
        payload: { id, text, route, device, image, ts, sig },
      });
    },
    [isStreaming, online, captureMobileScreen, secret]
  );

  return {
    messages,
    isStreaming,
    online,
    sendMessage,
    locked: !secret,
    unlock,
    relock,
    notificationPermission: permission,
    notificationsOn,
    enableNotifications,
    disableNotifications,
  };
}
