import { useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useTerminalBridge } from './useTerminalBridge';

export interface TerminalChatProps {
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
export function TerminalChat({
  supabase,
  channel,
  enabled = true,
  title = 'Terminal',
  placeholder = 'Escreve uma mensagem…',
}: TerminalChatProps) {
  const {
    messages,
    isStreaming,
    online,
    sendMessage,
    locked,
    unlock,
    relock,
    notificationPermission,
    notificationsOn,
    enableNotifications,
    disableNotifications,
  } = useTerminalBridge({ supabase, channel, enabled });
  const [input, setInput] = useState('');
  const [code, setCode] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, isStreaming]);

  const submit = () => {
    const t = input.trim();
    if (!t) return;
    setInput('');
    void sendMessage(t);
  };

  const submitCode = () => {
    const c = code.trim();
    if (!c) return;
    setCode('');
    unlock(c);
  };

  return (
    <div
      data-terminal-bridge-ignore="true"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#0b0f17',
        color: '#e5e7eb',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 14,
      }}
    >
      <style>{'@keyframes tb-blink{0%,49%{opacity:1}50%,100%{opacity:0}}.tb-caret{animation:tb-blink 1s step-end infinite;margin-left:1px}'}</style>
      {/* Cabeçalho + estado */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          borderBottom: '1px solid #1f2937',
        }}
      >
        <span style={{ fontWeight: 600 }}>{title}</span>
        <span
          style={{
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            color: online ? '#22c55e' : '#ef4444',
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 9999,
              background: online ? '#22c55e' : '#ef4444',
              boxShadow: online ? '0 0 6px #22c55e' : 'none',
            }}
          />
          {online ? 'online' : 'offline'}
        </span>
        {notificationPermission !== 'unsupported' && (
          <button
            onClick={() => (notificationsOn ? disableNotifications() : void enableNotifications())}
            title={
              notificationPermission === 'denied'
                ? 'Notificações bloqueadas no browser — ativa-as nas definições do site'
                : notificationsOn
                ? 'Notificações ligadas — clica para desligar'
                : 'Ligar notificações de novas mensagens'
            }
            style={{
              marginLeft: 4,
              background: 'transparent',
              border: 'none',
              color: notificationsOn ? '#22c55e' : '#6b7280',
              cursor: 'pointer',
              fontSize: 13,
              padding: 0,
            }}
          >
            {notificationsOn ? '🔔' : '🔕'}
          </button>
        )}
        {!locked && (
          <button
            onClick={relock}
            title="Trocar / esquecer o código de acesso"
            style={{
              marginLeft: 4,
              background: 'transparent',
              border: 'none',
              color: '#6b7280',
              cursor: 'pointer',
              fontSize: 13,
              padding: 0,
            }}
          >
            🔓
          </button>
        )}
      </div>

      {/* Ecrã de desbloqueio — sem código, o terminal não aceita mensagens */}
      {locked ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 32 }}>🔒</div>
          <p style={{ color: '#9ca3af', margin: 0, maxWidth: 280 }}>
            Este terminal está protegido. Introduz o código de acesso para o usar.
          </p>
          <div style={{ display: 'flex', gap: 8, width: '100%', maxWidth: 320 }}>
            <input
              type="password"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submitCode();
                }
              }}
              placeholder="Código de acesso"
              autoFocus
              style={{
                flex: 1,
                background: '#111827',
                color: '#e5e7eb',
                border: '1px solid #374151',
                borderRadius: 8,
                padding: '10px 12px',
                fontSize: 14,
                outline: 'none',
              }}
            />
            <button
              onClick={submitCode}
              disabled={!code.trim()}
              style={{
                background: code.trim() ? '#2563eb' : '#374151',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '0 16px',
                cursor: code.trim() ? 'pointer' : 'default',
                fontWeight: 600,
              }}
            >
              Entrar
            </button>
          </div>
          <p style={{ color: '#4b5563', fontSize: 11, margin: 0 }}>O código fica guardado neste dispositivo.</p>
        </div>
      ) : (
      <>
      {/* Mensagens */}
      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.length === 0 && (
          <p style={{ color: '#6b7280', textAlign: 'center', marginTop: 24 }}>
            {online ? 'Liga-te ao Claude Code da tua máquina. Escreve abaixo.' : 'À espera do terminal…'}
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
              padding: '8px 12px',
              borderRadius: 12,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              background: m.role === 'user' ? '#2563eb' : '#1f2937',
              color: m.role === 'user' ? '#fff' : '#e5e7eb',
            }}
          >
            {/* Atividade de ferramentas (durante o stream), em cinzento monospace */}
            {m.tools && m.tools.length > 0 && (
              <div style={{ marginBottom: m.content ? 6 : 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {m.tools.map((t, i) => (
                  <span key={i} style={{ color: '#9ca3af', fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                    ▸ {t}
                  </span>
                ))}
              </div>
            )}
            {m.content}
            {m.streaming && <span style={{ opacity: 0.6 }} className="tb-caret">▋</span>}
          </div>
        ))}
        {/* "a pensar…" só antes do primeiro delta/tool — depois disso o próprio balão mostra o cursor */}
        {isStreaming && !messages.some((m) => m.streaming) && (
          <div style={{ alignSelf: 'flex-start', color: '#9ca3af', fontStyle: 'italic' }}>a pensar…</div>
        )}
      </div>

      {/* Input */}
      <div style={{ display: 'flex', gap: 8, padding: 10, borderTop: '1px solid #1f2937' }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          rows={1}
          style={{
            flex: 1,
            resize: 'none',
            background: '#111827',
            color: '#e5e7eb',
            border: '1px solid #374151',
            borderRadius: 8,
            padding: '8px 10px',
            fontFamily: 'inherit',
            fontSize: 14,
            outline: 'none',
          }}
        />
        <button
          onClick={submit}
          disabled={isStreaming || !input.trim()}
          style={{
            background: isStreaming || !input.trim() ? '#374151' : '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            padding: '0 16px',
            cursor: isStreaming || !input.trim() ? 'default' : 'pointer',
            fontWeight: 600,
          }}
        >
          ➤
        </button>
      </div>
      </>
      )}
    </div>
  );
}
