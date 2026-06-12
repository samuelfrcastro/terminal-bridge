import { SupabaseClient } from '@supabase/supabase-js';

interface BridgeMessage {
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
declare const DEFAULT_HUB: {
    url: string;
    anonKey: string;
};
interface UseTerminalBridgeOptions {
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
interface TerminalBridge {
    messages: BridgeMessage[];
    isStreaming: boolean;
    /** true enquanto o daemon (Claude Code) estiver presente no canal. */
    online: boolean;
    sendMessage: (content: string) => Promise<void>;
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
declare function useTerminalBridge(opts?: UseTerminalBridgeOptions): TerminalBridge;

export { type BridgeMessage, DEFAULT_HUB, type TerminalBridge, type UseTerminalBridgeOptions, useTerminalBridge };
