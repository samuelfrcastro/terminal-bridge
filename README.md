# terminal-bridge

Plugin reutilizável: liga o **chat de um site** ao **Claude Code que corre na tua máquina**, via Supabase Realtime. Inclui indicador online/offline (Presence), printscreen da página (desktop e telemóvel) e continuidade de sessão.

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
