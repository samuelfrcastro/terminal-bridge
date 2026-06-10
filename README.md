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
```

Depois:

```sh
npx terminal-bridge install     # instala como LaunchAgent (arranca sozinho)
# ou, para testar à mão:
npx terminal-bridge daemon
```

> Para printscreens em background, concede **Screen Recording** + **Automation** ao `bun` nas Definições de Privacidade.

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

## Propagar melhorias a todos os sites

```sh
cp sites.example.json sites.json   # ajusta os caminhos/canais
npx terminal-bridge release        # atualiza o package + deploy de todos
```

## Env do daemon

| Var | Default | Função |
|-----|---------|--------|
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | — | obrigatórias |
| `BRIDGE_CHANNEL` | `terminal-bridge` | canal único do site |
| `AGENT_PROJECT_ROOT` | cwd | raiz do site |
| `BRIDGE_MODEL` | (do CLI) | modelo do Claude Code |
| `BRIDGE_FLAG` | `claude` | marca da aba a capturar (`?claude=1`) |
| `BRIDGE_APP_HOSTS` | localhost/lovable/vercel | regex de hosts da app |
