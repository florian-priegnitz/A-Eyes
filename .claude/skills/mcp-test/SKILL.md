---
name: mcp-test
description: Test the MCP server by starting it and verifying tool registration and basic functionality.
allowed-tools: Bash(pnpm *), Bash(node *), Bash(echo *), Read
model: sonnet
---

## Test MCP Server

Verify the A-Eyes MCP server starts correctly and tools are registered.

### Steps

1. Build the project first:
   ```bash
   pnpm build
   ```

2. Test that the server starts and responds to MCP initialize:
   ```bash
   echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}' | node dist/index.js 2>/dev/null | head -1
   ```

3. Verify the response contains the expected tools (`capture`, etc.)

4. Test listing tools:
   ```bash
   echo -e '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1.0"}}}\n{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | node dist/index.js 2>/dev/null
   ```

5. Report:
   - Server starts: yes/no
   - Tools registered: list them
   - Any errors in stderr
