import { SupabaseClient } from '@supabase/supabase-js';
import * as react from 'react';

interface BridgeMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
}
interface UseTerminalBridgeOptions {
    /** Cliente Supabase do site (já autenticado). */
    supabase: SupabaseClient;
    /** Nome do canal Realtime — único por site (ex. 'bridge-iocmanager'). */
    channel?: string;
    /** Liga/desliga a ponte (default true). */
    enabled?: boolean;
    /** No telemóvel, capturar a própria página e enviá-la ao daemon (default true). */
    captureMobileScreen?: boolean;
}
interface TerminalBridge {
    messages: BridgeMessage[];
    isStreaming: boolean;
    /** true enquanto o daemon (Claude Code) estiver presente no canal. */
    online: boolean;
    sendMessage: (content: string) => Promise<void>;
}
/**
 * Liga o chat ao Claude Code que corre na máquina do owner, via Supabase Realtime.
 * Online/offline por Presence (sem mensagens periódicas). Genérico: serve qualquer site.
 */
declare function useTerminalBridge(opts: UseTerminalBridgeOptions): TerminalBridge;

interface TerminalChatProps {
    /** Cliente Supabase do site (já autenticado). */
    supabase: SupabaseClient;
    /** Canal Realtime único por site (ex. 'bridge-iocmanager'). */
    channel?: string;
    /** Liga/desliga a ponte (default true). */
    enabled?: boolean;
    /** Título no cabeçalho. */
    title?: string;
    /** Texto do placeholder do input. */
    placeholder?: string;
}
/**
 * Painel de chat auto-contido que fala com o Claude Code local (via daemon).
 * Estilos inline → funciona em qualquer site sem depender do design system dele.
 * Marcado com data-terminal-bridge-ignore para não aparecer nas capturas de ecrã.
 */
declare function TerminalChat({ supabase, channel, enabled, title, placeholder, }: TerminalChatProps): react.JSX.Element;

export { type BridgeMessage, type TerminalBridge, TerminalChat, type TerminalChatProps, type UseTerminalBridgeOptions, useTerminalBridge };
