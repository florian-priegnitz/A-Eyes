#!/usr/bin/env bash
set -euo pipefail

# A-Eyes install script
# Installs dependencies, builds, and registers MCP server

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== A-Eyes Installer ==="
echo ""

# 1. Check Node.js
if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js is not installed. Install Node.js 18+ first."
  echo "  https://nodejs.org/"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/^v//')
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "ERROR: Node.js 18+ required, found v$NODE_VERSION"
  exit 1
fi
echo "OK  Node.js v$NODE_VERSION"

# 2. Determine package manager
if command -v pnpm &>/dev/null; then
  PM="pnpm"
elif command -v npx &>/dev/null && npx pnpm --version &>/dev/null 2>&1; then
  PM="npx pnpm"
else
  PM="npm"
fi
echo "OK  Using $PM"

# 3. Install dependencies + build
echo ""
echo "Installing dependencies..."
$PM install

echo ""
echo "Building..."
$PM run build

# 4. Health check
echo ""
echo "Running health check..."
if node dist/index.js --check; then
  echo ""
  echo "OK  Health check passed"
else
  echo ""
  echo "WARN  Health check had warnings (normal before configuring an allowlist)"
fi

# 5. Register MCP server
echo ""
ABS_PATH="$SCRIPT_DIR/dist/index.js"
if command -v claude &>/dev/null; then
  echo "Registering A-Eyes as MCP server (user-level)..."
  claude mcp add a-eyes -s user -- node "$ABS_PATH"
  echo "OK  MCP server registered"
else
  echo "WARN  Claude CLI not found — register manually:"
  echo "  claude mcp add a-eyes -s user -- node $ABS_PATH"
fi

# 6. Done
echo ""
echo "=== Installation complete ==="
echo ""
echo "Next steps:"
echo "  1. Restart Claude Code"
echo "  2. Ask Claude: \"Run the a-eyes setup tool\""
echo "     (This creates an allowlist so A-Eyes can capture windows)"
echo "  3. Try: \"Take a screenshot of Chrome\""
echo ""
echo "Verify anytime:  node dist/index.js --check"
