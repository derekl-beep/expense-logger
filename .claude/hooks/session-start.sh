#!/bin/bash
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# The sandbox's preinstalled uv predates Python 3.14's stable release, so it
# only knows about the 3.14.0rc2 prerelease (which crashes on fastapi/pydantic
# import). Upgrade uv via pip so `uv sync` resolves the real 3.14 release.
pip install --quiet --upgrade uv
ln -sf /usr/local/bin/uv /root/.local/bin/uv

uv sync

cd frontend
npm install
