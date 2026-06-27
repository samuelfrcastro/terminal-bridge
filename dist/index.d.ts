import { SupabaseClient } from '@supabase/supabase-js';
import * as react from 'react';

interface BridgeMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    /** Linhas de atividade de ferramentas (ex. "Read src/Header.tsx"), durante o stream. */
    tools?: string[];
    /** true enquanto ainda chegam deltas desta resposta. */
    streaming?: boolean;
}
/** Modo de execução do pedido — escolhido por mensagem, todos correm no alvo mac-3. */
type BridgeMode = 'direct' | 'queue' | 'terminal';
interface UseIframeMacOptions {
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
    /** Modo inicial se o browser ainda não tiver preferência guardada (default 'direct'). */
    defaultMode?: BridgeMode;
}
interface IframeMac {
    messages: BridgeMessage[];
    isStreaming: boolean;
    /** true enquanto o daemon (Claude Code) estiver presente no canal. */
    online: boolean;
    sendMessage: (content: string) => Promise<void>;
    /** Modo de execução atual (direct/queue/terminal) — guardado por canal. */
    mode: BridgeMode;
    /** Muda o modo de execução (persiste no localStorage por canal). */
    setMode: (m: BridgeMode) => void;
    /** true se não há segredo configurado neste browser (mensagens serão rejeitadas pelo daemon). */
    locked: boolean;
    /** Guarda o segredo HMAC para este canal neste browser. */
    unlock: (secret: string) => void;
    /** Estado da permissão de notificações do browser ('unsupported' se indisponível). */
    notificationPermission: NotificationPermission | 'unsupported';
    /** true quando as notificações estão activas (permissão concedida + ligadas). */
    notificationsOn: boolean;
    /** Pede permissão ao browser e liga as notificações. */
    enableNotifications: () => Promise<void>;
    /** Desliga as notificações (mantém a permissão concedida). */
    disableNotifications: () => void;
}
/**
 * Liga o chat ao Claude Code que corre na máquina do owner, via Supabase Realtime.
 * Online/offline por Presence (sem mensagens periódicas). Genérico: serve qualquer site.
 */
declare function useIframeMac(opts?: UseIframeMacOptions): IframeMac;

interface IframeMacChatProps {
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
    /** Modo inicial se o browser ainda não tiver preferência (default 'direct'). */
    defaultMode?: BridgeMode;
}
/**
 * Painel de chat auto-contido que fala com o Claude Code local (via daemon).
 * Estilos inline → funciona em qualquer site sem depender do design system dele.
 * Marcado com data-iframe-mac-ignore para não aparecer nas capturas de ecrã.
 */
declare function IframeMacChat({ supabase, channel, enabled, title, placeholder, defaultMode, }: IframeMacChatProps): react.JSX.Element;

export { type BridgeMessage, type IframeMac, IframeMacChat, type IframeMacChatProps, type UseIframeMacOptions, useIframeMac };
