//! Install script template served from `GET /install?token=...&name=...`.

pub fn render(http_url: &str, ws_url: &str, token: &str, name_hint: Option<&str>) -> String {
    let name_default = name_hint.unwrap_or("");
    format!(
        r#"#!/bin/sh
set -eu
HTTP_URL="{http_url}"
WS_URL="{ws_url}"
TOKEN="{token}"
NAME="${{GLOVE_NAME:-{name_default}}}"
if [ -z "$NAME" ]; then
  NAME="c$(date +%s | tail -c 6)"
fi
STATE="${{GLOVE_STATE_DIR:-${{XDG_CACHE_HOME:-$HOME/.cache}}/glove}}"
mkdir -p "$STATE"

PIDFILE="$STATE/client-$NAME.pid"
LOGFILE="$STATE/client-$NAME.log"
BIN="$STATE/glove"

# Kill any existing daemon for this name (avoid multiple instances / stale server URL).
if [ -f "$PIDFILE" ]; then
  OLDPID=$(cat "$PIDFILE" 2>/dev/null || true)
  if [ -n "${{OLDPID:-}}" ] && kill -0 "$OLDPID" 2>/dev/null; then
    kill -TERM "$OLDPID" 2>/dev/null || true
    # Give it a moment to shut down.
    i=0
    while kill -0 "$OLDPID" 2>/dev/null; do
      i=$((i + 1))
      if [ "$i" -gt 20 ]; then
        kill -KILL "$OLDPID" 2>/dev/null || true
        break
      fi
      sleep 0.1
    done
  fi
  rm -f "$PIDFILE"
fi

# Download binary
TMPBIN="$STATE/glove.dl"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$HTTP_URL/bin" -o "$TMPBIN"
else
  wget -qO "$TMPBIN" "$HTTP_URL/bin"
fi
chmod +x "$TMPBIN"
mv -f "$TMPBIN" "$BIN"

# Start daemon detached (setsid + nohup; q4 = setsid+nohup, no on-disk token: q5).
GLOVE_TOKEN="$TOKEN" \
GLOVE_STATE_DIR="$STATE" \
setsid nohup "$BIN" _client --server "$WS_URL" --name "$NAME" \
  >"$LOGFILE" 2>&1 </dev/null &
PID=$!
echo "$PID" > "$PIDFILE"

# Wait briefly for liveness.
i=0
while ! kill -0 "$PID" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -gt 50 ]; then
    echo "glove client failed to start; see $LOGFILE" >&2
    exit 1
  fi
  sleep 0.1
done
echo "glove client started: name=$NAME pid=$PID log=$LOGFILE"
"#
    )
}
