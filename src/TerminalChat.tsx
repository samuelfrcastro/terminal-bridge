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
  const { messages, isStreaming, online, sendMessage } = useTerminalBridge({ supabase, channel, enabled });
  const [input, setInput] = useState('');
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
      </div>

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
            {m.content}
          </div>
        ))}
        {isStreaming && (
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
    </div>
  );
}
