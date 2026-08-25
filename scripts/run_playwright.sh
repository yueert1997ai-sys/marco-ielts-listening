#!/bin/sh
set -eu

# Codex desktop can expose Node without npm/npx on PATH and with a broken
# OpenSSL default. Prefer the user's complete Node install and neutralise the
# unusable system OpenSSL config before starting Playwright.
USER_NODE_BIN="${HOME}/.local/node-current/bin"
export PATH="${USER_NODE_BIN}:/usr/local/bin:/usr/bin:/bin:${PATH}"
export OPENSSL_CONF=/dev/null

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is unavailable; install Node.js with npm before browser testing." >&2
  exit 1
fi

exec npx --yes --package @playwright/cli playwright-cli "$@"
