FROM docker.io/library/ubuntu:22.04

ARG NODE_MAJOR=20

# System packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    curl \
    gcc \
    git \
    jq \
    less \
    openssh-client \
    vim \
    wget \
    zsh \
    && rm -rf /var/lib/apt/lists/*

# Node.js LTS (required by Claude Code)
RUN curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# uv (Python package manager)
RUN curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh

# Rewrite git SSH URLs to HTTPS
RUN git config --system url."https://github.com/".insteadOf "git@github.com:" \
    && git config --system url."https://github.com/".insteadOf "ssh://git@github.com/" \
    && git config --system url."https://gitlab.com/".insteadOf "git@gitlab.com:" \
    && git config --system url."https://gitlab.com/".insteadOf "ssh://git@gitlab.com/"

# AI CLI tools
RUN npm install -g @anthropic-ai/claude-code @openai/codex

# Entrypoint: user mapping + CA trust store update
COPY scripts/jail-entrypoint.sh /usr/local/bin/jail-entrypoint.sh
RUN chmod +x /usr/local/bin/jail-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/jail-entrypoint.sh"]
CMD ["sleep", "infinity"]
