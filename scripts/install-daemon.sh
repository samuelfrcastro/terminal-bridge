#!/usr/bin/env bash
# Instala o daemon terminal-bridge como LaunchAgent para um site.
# Uso: terminal-bridge install            (corre na raiz do site)
#  ou: bash install-daemon.sh /caminho/do/site
set -euo pipefail

SITE="${1:-$PWD}"
SITE="$(cd "$SITE" && pwd)"
NAME="$(basename "$SITE")"
LABEL="com.terminalbridge.$NAME"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
BUN="$(command -v bun || echo "$HOME/.bun/bin/bun")"
CLAUDE_DIR="$(dirname "$(command -v claude 2>/dev/null || echo "$HOME/.local/bin/claude")")"
DAEMON="$SITE/node_modules/terminal-bridge/daemon/terminal-bridge.mjs"

if [ ! -f "$SITE/.env.agent" ]; then
  echo "✗ Falta $SITE/.env.agent (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + BRIDGE_CHANNEL)."; exit 1
fi
if [ ! -f "$DAEMON" ]; then
  echo "✗ terminal-bridge não instalado em $SITE (corre 'npm i' primeiro)."; exit 1
fi

echo "→ a gerar $PLIST"
cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$BUN</string>
    <string>--env-file=.env.agent</string>
    <string>run</string>
    <string>$DAEMON</string>
  </array>
  <key>WorkingDirectory</key><string>$SITE</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$CLAUDE_DIR:$HOME/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin</string>
    <key>AGENT_PROJECT_ROOT</key><string>$SITE</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>/tmp/terminal-bridge-$NAME.log</string>
  <key>StandardErrorPath</key><string>/tmp/terminal-bridge-$NAME.err</string>
</dict>
</plist>
PLISTEOF

echo "→ a (re)carregar"
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
sleep 3
launchctl list | grep "$LABEL" || echo "(não aparece ainda)"
echo "✓ daemon instalado para '$NAME'. Logs: /tmp/terminal-bridge-$NAME.log"
echo "  ⚠️ Para printscreens em background, concede 'Screen Recording' + 'Automation' ao bun."
