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
}

export interface TerminalBridge {
  messages: BridgeMessage[];
  isStreaming: boolean;
  /** true enquanto o daemon (Claude Code) estiver presente no canal. */
  online: boolean;
  sendMessage: (content: string) => Promise<void>;
}

const uid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

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
  const { supabase, channel = 'terminal-bridge', enabled = true, captureMobileScreen = true } = opts;

  // Usa o supabase fornecido, ou cria (uma vez) um client do hub partilhado.
  const client = useMemo(
    () => supabase ?? createClient(DEFAULT_HUB.url, DEFAULT_HUB.anonKey, { auth: { persistSession: false } }),
    [supabase]
  );

  const [messages, setMessages] = useState<BridgeMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [online, setOnline] = useState(false);
  const channelRef = useRef<ReturnType<SupabaseClient['channel']> | null>(null);

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
      await channelRef.current?.send({
        type: 'broadcast',
        event: 'user_msg',
        payload: { id, text, route, device, image },
      });
    },
    [isStreaming, online, captureMobileScreen]
  );

  return { messages, isStreaming, online, sendMessage };
}
