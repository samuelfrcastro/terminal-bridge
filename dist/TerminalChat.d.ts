import * as react from 'react';
import { SupabaseClient } from '@supabase/supabase-js';

interface TerminalChatProps {
    /** Cliente Supabase a usar. Se omitido, usa o hub Realtime partilhado. */
    supabase?: SupabaseClient;
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

export { TerminalChat, type TerminalChatProps };
