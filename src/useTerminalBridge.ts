import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface BridgeMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export interface UseTerminalBridgeOptions {
  /** Cliente Supabase do site (já autenticado). */
  supabase: SupabaseClient;
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
export function useTerminalBridge(opts: UseTerminalBridgeOptions): TerminalBridge {
  const { supabase, channel = 'terminal-bridge', enabled = true, captureMobileScreen = true } = opts;

  const [messages, setMessages] = useState<BridgeMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [online, setOnline] = useState(false);
  const channelRef = useRef<ReturnType<SupabaseClient['channel']> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const ch = supabase.channel(channel, { config: { broadcast: { self: false } } });

    ch.on('broadcast', { event: 'assistant_msg' }, ({ payload }: any) => {
      setMessages((m) => [
        ...m,
        { id: (payload.id || uid()) + '-a', role: 'assistant', content: payload.text },
      ]);
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
      supabase.removeChannel(ch);
      channelRef.current = null;
      setOnline(false);
    };
  }, [supabase, channel, enabled]);

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
