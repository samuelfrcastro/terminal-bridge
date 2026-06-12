# terminal-bridge

Plugin reutilizável: liga o **chat de um site** ao **Claude Code que corre na tua máquina**, via Supabase Realtime. Inclui **streaming ao vivo** (texto token-a-token + atividade de ferramentas), indicador online/offline (Presence), printscreen da página (desktop e telemóvel) e continuidade de sessão.

**Melhora-se uma vez → vale para todos os sites.** A lógica vive no daemon (muda na hora para todos); o frontend é fino e propaga-se com `terminal-bridge release`.

## Instalar num site

```sh
npm install github:samuelfrcastro/terminal-bridge
```

### 1. Frontend — montar o chat

```tsx
import { TerminalChat } from 'terminal-bridge';
import { supabase } from '@/integrations/supabase/client';

<TerminalChat supabase={supabase} channel="bridge-<nome-do-site>" />
```

Ou só o hook, para UI própria:

```tsx
import { useTerminalBridge } from 'terminal-bridge';
const { messages, isStreaming, online, sendMessage } = useTerminalBridge({ supabase, channel: 'bridge-x' });
```

### 2. Daemon — correr na tua máquina

Cria `.env.agent` na raiz do site:

```
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role>
BRIDGE_CHANNEL=bridge-<nome-do-site>
BRIDGE_SECRET=<código de acesso forte>
```

Depois:

```sh
npx terminal-bridge install     # instala como LaunchAgent (arranca sozinho)
# ou, para testar à mão:
npx terminal-bridge daemon
```

> Para printscreens em background, concede **Screen Recording** + **Automation** ao `bun` nas Definições de Privacidade.

## Segurança — código de acesso (v2+)

O canal Realtime é público (a anon key e o nome do canal vão no bundle do site), por isso o daemon **só corre mensagens assinadas** com o `BRIDGE_SECRET`. Sem ele, qualquer um que ligasse ao canal podia mandar prompts ao Claude Code na tua máquina.

- O daemon **recusa arrancar** sem `BRIDGE_SECRET` definido.
- O frontend pede um **código de acesso** (guardado no `localStorage` por canal, nunca no bundle) e **assina cada mensagem** com HMAC-SHA256 sobre `id.ts.text`. O daemon verifica a assinatura, rejeita timestamps fora de ±5 min e bloqueia replays.
- O código que escreves no chat **tem de ser igual** ao `BRIDGE_SECRET` do `.env.agent`. Usa o 🔓 no cabeçalho para o trocar.

Gera um código forte, por exemplo: `openssl rand -hex 24`.

## Streaming ao vivo (v1.1+)

O daemon corre o Claude Code com `--output-format stream-json` e emite os tokens à medida que chegam, em vez de esperar pela resposta completa. O `<TerminalChat>` mostra o texto a aparecer e as ferramentas a serem usadas (`▸ Read src/Header.tsx`) com um cursor a piscar — sem mais minutos de silêncio em "a pensar…".

**Protocolo (broadcast no canal do site):**

| Evento | Direção | Payload | Quando |
|--------|---------|---------|--------|
| `user_msg` | site → daemon | `{ id, text, route, device, image }` | utilizador envia |
| `assistant_delta` | daemon → site | `{ id, text }` | pedaço de texto (throttle ~120ms) |
| `tool_use` | daemon → site | `{ id, summary }` | Claude usa uma ferramenta |
| `assistant_msg` | daemon → site | `{ id, text, session, streamed }` | resposta final (autoritativa) |

Retrocompatível: clientes antigos (≤1.0.1) ignoram `assistant_delta`/`tool_use` e funcionam na mesma só com o `assistant_msg` final. A mensagem final substitui o texto streamado, corrigindo deltas eventualmente perdidos.

## Contexto de página (v1.2+)

Cada mensagem leva a rota atual (`window.location`). O daemon dá esse contexto ao Claude de três formas, combinadas quando disponíveis: **rota** (sempre), **rota→ficheiro** (`which-page` resolve o ficheiro da página) e **printscreen** (aba marcada com `?claude=1` no desktop, ou captura do DOM no telemóvel).

O `which-page` reconhece o router automaticamente:

| Router | Como deteta | Resolve |
|--------|-------------|---------|
| react-router | `src/App.tsx` com `<Route>` | `<Route path>` → componente lazy/`src/pages` |
| TanStack | `src/routes/` | file-based (flat por `.` e por pastas, `$param`→`:param`) |
| Next | `app/` ou `pages/` | `[param]`→`:param`, `[...x]`→`*`, grupos `(x)` ignorados |

## Propagar melhorias a todos os sites

```sh
cp sites.example.json sites.json   # ajusta os caminhos/canais
npx terminal-bridge release        # atualiza o package + deploy de todos
```

## Env do daemon

| Var | Default | Função |
|-----|---------|--------|
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | — | obrigatórias |
| `BRIDGE_SECRET` | — | **obrigatória** — código de acesso (HMAC) |
| `BRIDGE_CHANNEL` | `terminal-bridge` | canal único do site |
| `AGENT_PROJECT_ROOT` | cwd | raiz do site |
| `BRIDGE_MODEL` | (do CLI) | modelo do Claude Code |
| `BRIDGE_FLAG` | `claude` | marca da aba a capturar (`?claude=1`) |
| `BRIDGE_APP_HOSTS` | localhost/lovable/vercel | regex de hosts da app |
| `BRIDGE_NOTIFY` | `1` | notificar o owner em atividade do chat (`0` desliga) |
| `BRIDGE_TELEGRAM_BOT_TOKEN` | — | (opcional) token do bot p/ notificar no Telegram |
| `BRIDGE_TELEGRAM_CHAT_ID` | — | (opcional) chat id de destino no Telegram |

## Notificações (v2.2+)

Sempre que há atividade no chat de um site, és avisado nos dois lados:

- **Na tua máquina (daemon):** notificação nativa do macOS (com som) quando **chega uma mensagem** de um visitante e quando o **Claude termina a resposta**. Se definires `BRIDGE_TELEGRAM_BOT_TOKEN` + `BRIDGE_TELEGRAM_CHAT_ID`, também recebes no Telegram. Desliga com `BRIDGE_NOTIFY=0`.
- **No browser do site:** o `<TerminalChat>` usa a Web Notifications API. Com a aba em segundo plano, mostra uma notificação do browser, toca um beep e faz o título da aba piscar — em respostas do Claude e em mensagens de outros visitantes do mesmo chat. O utilizador liga/desliga no 🔔/🔕 do cabeçalho (a preferência fica no `localStorage` por canal). Passa `notify={false}` ao `<TerminalChat>`/`useTerminalBridge` para desativar de todo.
