#!/bin/sh
set -e

# --- User mapping ---
# FJ_USER: desired username inside container (default: root)
# FJ_HOME: desired home directory (default: /root)
FJ_USER="${FJ_USER:-root}"
FJ_HOME="${FJ_HOME:-/root}"

if [ "$FJ_USER" != "root" ] || [ "$FJ_HOME" != "/root" ]; then
    # Rename root in /etc/passwd: change username and home directory
    sed -i "s|^root:\([^:]*\):\([^:]*\):\([^:]*\):[^:]*:[^:]*:|${FJ_USER}:\1:\2:\3:${FJ_USER}:${FJ_HOME}:|" /etc/passwd

    # Create the new home directory if it doesn't exist
    mkdir -p "$FJ_HOME"

    # Copy skeleton dotfiles if the home is empty
    if [ ! -f "$FJ_HOME/.bashrc" ]; then
        cp -a /etc/skel/. "$FJ_HOME/" 2>/dev/null || true
    fi

    export HOME="$FJ_HOME"
fi

# --- CA certificates ---
if ls /usr/local/share/ca-certificates/*.crt >/dev/null 2>&1; then
    update-ca-certificates -f 2>/dev/null
fi

exec "$@"
