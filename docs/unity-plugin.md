# A-Eyes Unity Plugin

> **Status:** Planning — Phase 1 in scope (#23), Phase 2 deferred (#24)
> **Author:** Florian Priegnitz
> **Date:** 2026-03-17
> **A-Eyes Version:** v0.x (Commit 41da159, 177 Tests, 8 MCP Tools)
> **Unity Version:** Unity 6.x (Hub v3.16.4, URP)
> **Target Project:** space_2063

---

## 1. Problem Statement

Claude Code is blind to Unity. It can write C# scripts, but it cannot:

- See if the code compiles
- Read runtime exceptions from Play Mode
- Understand the scene hierarchy (what GameObjects exist, what Components they have)
- Start or stop Play Mode
- Trigger Editor methods

The result: every compile error, every NullReferenceException, every "it spawns in the wrong place" requires **manual feedback from the developer**. This breaks the agentic workflow and turns Claude Code into a blind typist.

---

## 2. Solution: Unity Plugin for A-Eyes

Extend A-Eyes with a Unity-specific plugin that closes the feedback loop. The plugin follows A-Eyes' existing patterns:

- WSL2 → Windows interop via PowerShell `execFile` (no shell interpolation) where needed
- Deny-by-default security model with explicit config
- Tamper-resistant audit logging (JSONL, append-only)
- Zod schema validation on all inputs
- **Plugin is only active when `plugins.unity.enabled: true` in config — zero overhead otherwise**

### What A-Eyes already provides (relevant to Unity)

| Existing Tool | Unity Use Case |
|---|---|
| `capture` | Screenshot Game View, Scene View, Inspector |
| `see` | Read UI elements in Unity Editor via UIAutomation |
| `clipboard` | Copy/paste between Claude Code and Unity |
| `processes` | Check if Unity Editor is running |
| `check_status` | Verify WSL2 interop health |
| `query` | "What do you see in this Game View screenshot?" |

### What the plugin adds

| Tool | Purpose | Phase |
|---|---|---|
| `unity_console` | Parse Editor.log for compile errors, warnings, runtime exceptions | 1 ✅ |
| `unity_scene` | Parse .unity/.prefab YAML files into structured hierarchy | 1 ✅ |
| `unity_compile` | Trigger recompilation, return structured error list | 2 ⏳ |
| `unity_play` | Start / Stop / Pause Play Mode | 2 ⏳ |
| `unity_exec` | Call static C# Editor methods via Unity CLI | 2 ⏳ |
| `unity_watch` | Monitor project files for changes | 3 ⏳ |

---

## 3. Architecture

```
Claude Code (WSL2)
    │
    ▼
A-Eyes MCP Server (WSL2, Node.js, stdio transport)
    │
    ├── Core Tools (capture, see, clipboard, processes, ...)  ← unchanged
    │
    └── Unity Plugin (loaded only when plugins.unity.enabled: true)
        │
        ├── unity_console ──→ /mnt/c/.../Editor.log  (direct file read, no PowerShell)
        ├── unity_scene   ──→ /mnt/c/.../Assets/*.unity  (direct file read + YAML parse)
        │
        │   — Phase 2 (IPC design required before implementing) —
        ├── unity_compile ──→ AEyesBridge (IPC) or Unity.exe -batchmode
        ├── unity_play    ──→ AEyesBridge (IPC)
        ├── unity_exec    ──→ AEyesBridge (IPC) or Unity.exe -executeMethod
        └── unity_watch   ──→ powershell.exe FileSystemWatcher (execFile)
```

### Key Design Decisions

**Phase 1: Direct file access only.** `unity_console` and `unity_scene` read files directly from the Windows filesystem via `/mnt/c/`. No PowerShell hop, no IPC, no Unity process interaction. Fast, simple, zero risk.

**Phase 2: IPC design required first.** The action tools (compile, play, exec) need to control a *running* Unity Editor. `Unity.exe -batchmode -executeMethod` opens a *new* process — it cannot control an open Editor and will fail with a project lock error. See [Open Questions](#7-open-questions) for IPC design options.

**PowerShell only for actions (Phase 2+).** When actions are needed, use `execFile` with argv arrays — consistent with existing A-Eyes pattern, no shell interpolation.

**Plugin registration.** Unity tools are registered only when `plugins.unity.enabled: true` in config. Without config, zero Unity tools appear in the MCP tool list.

---

## 4. Configuration

```json
{
  "allowlist": ["Unity"],
  "plugins": {
    "unity": {
      "enabled": true,
      "project_path": "C:\\Users\\Florian\\Projects\\space_2063",
      "editor_version": "6000.x.xf1",
      "editor_path": "auto",
      "editor_log": "auto",
      "watch_extensions": [".cs", ".unity", ".prefab", ".asset", ".shader"],
      "console_max_entries": 200,
      "allowed_methods": []
    }
  }
}
```

| Field | Default | Description |
|---|---|---|
| `enabled` | `false` | Master switch — no Unity tools without this |
| `project_path` | — | **Required.** Windows path to Unity project root |
| `editor_version` | — | Optional. Used for log format detection |
| `editor_path` | `"auto"` | Path to Unity.exe. `"auto"` = detect via Hub |
| `editor_log` | `"auto"` | Path to Editor.log. `"auto"` = `%LOCALAPPDATA%\Unity\Editor\Editor.log` (resolved via PowerShell on first use) |
| `watch_extensions` | `[".cs"]` | File extensions to monitor in Phase 3 |
| `console_max_entries` | `200` | Max log entries returned |
| `allowed_methods` | `[]` | Allowlist for `unity_exec` (Phase 2). Empty = tool disabled |

### Security Model

- **Phase 1 tools (console, scene):** Read-only. Paths constrained to `project_path` and `editor_log`. Path traversal protection enforced in TypeScript before file access.
- **Phase 2 — unity_compile/play:** Constrained to configured `project_path`. No arbitrary paths.
- **Phase 2 — unity_exec:** Most sensitive. Gated by `allowed_methods` allowlist. Empty list = tool is entirely disabled. Method names validated as `[A-Za-z0-9_.]+` only.

All tools write to the existing A-Eyes audit log.

---

## 5. Phase 1 Tool Specifications

### 5.1 unity_console

**Purpose:** Read Unity Editor console — compile errors, warnings, runtime exceptions.

**Data Source:** `Editor.log` — default path: `C:\Users\<User>\AppData\Local\Unity\Editor\Editor.log`
**Access:** Direct file read via `/mnt/c/Users/<User>/AppData/Local/Unity/Editor/Editor.log`
**Note:** `%LOCALAPPDATA%` path is resolved once via PowerShell on first use and cached in config.

**Input Schema:**

```typescript
{
  filter: z.enum(["all", "errors", "warnings", "exceptions"]).default("errors"),
  last_n: z.number().int().positive().max(500).default(20),
  since: z.string().datetime().optional(),
  pattern: z.string().max(200).optional(), // regex — validated against ReDoS
  include_stacktrace: z.boolean().default(true)
}
```

**Output:**

```json
{
  "status": "compilation_errors",
  "summary": "2 errors, 1 warning, 0 exceptions",
  "unity_version": "6000.0.32f1",
  "entries": [
    {
      "level": "error",
      "code": "CS0246",
      "message": "The type or namespace name 'AsteroidConfig' could not be found",
      "file": "Assets/Scripts/AsteroidSpawner.cs",
      "line": 12,
      "column": 18,
      "timestamp": "2026-03-17T21:34:12"
    }
  ]
}
```

**Unity 6 Log Format Patterns:**

```
# Compile Error
Assets/Scripts/Foo.cs(12,18): error CS0246: The type or namespace name '...'

# Compile Warning
Assets/Scripts/Foo.cs(5,1): warning CS0168: The variable '...'

# Runtime Exception (multi-line)
NullReferenceException: Object reference not set to an instance of an object
  at Foo.Bar () [0x00012] in /path/to/Assets/Scripts/Foo.cs:42

# Compilation result markers
-----CompilerOutput:-stdout--compilationhaserrors
-----CompilerOutput:-stdout--compilationfinished
```

**Implementation Notes:**
- Read from end of file (reverse scan) — Editor.log can be hundreds of MB
- Parse multi-line stack traces by detecting indented continuation lines
- Cache file position to avoid re-reading on repeated calls
- `pattern` validated as safe regex before use

---

### 5.2 unity_scene

**Purpose:** Parse Unity scene/prefab files into a structured GameObject hierarchy.

**Data Source:** `.unity` and `.prefab` files in `project_path/Assets/`
**Access:** Direct file read via `/mnt/c/`

**Input Schema:**

```typescript
{
  scene: z.string().optional(),
  depth: z.number().int().min(1).max(10).default(3),
  include_components: z.boolean().default(true),
  include_transform: z.boolean().default(false),
  filter_tag: z.string().optional(),
  filter_name: z.string().optional()
}
```

**Output:**

```json
{
  "scene": "Assets/Scenes/MainScene.unity",
  "root_count": 5,
  "hierarchy": [
    {
      "name": "Player",
      "tag": "Player",
      "active": true,
      "components": ["Transform", "Rigidbody2D", "PlayerController"],
      "children": [
        { "name": "ShieldGenerator", "components": ["Transform", "ShieldController"], "children": [] }
      ]
    }
  ]
}
```

**Unity YAML Parsing — Important:**

Unity scene files are not standard YAML:

```yaml
%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &1234567890
GameObject:
  m_ObjectHideFlags: 0
```

Standard YAML parsers (`js-yaml`) fail on the `%TAG` directive and `!u!NNN` type tags.

**Fix:** Preprocess before parsing:
1. Remove `%YAML 1.1` and `%TAG !u!` lines
2. Replace `--- !u!NNN &fileID` with `--- # type:NNN id:fileID`
3. Then parse with `js-yaml`

This is straightforward (3 regex replacements) and avoids adding a Unity-specific YAML dependency.

**Implementation Notes:**
- Hierarchy built from `m_Children`/`m_Father` fileID references in Transform components
- Component type from the `!u!NNN` tag (e.g., `!u!114` = MonoBehaviour, `!u!4` = Transform)
- Use streaming/line-by-line reading for large scenes
- Path traversal protection: all resolved paths must be within `project_path`

---

## 6. Phase 2 Design (Deferred)

Phase 2 tools (`unity_compile`, `unity_play`, `unity_exec`) require controlling a **running** Unity Editor. This requires an IPC mechanism. See [Open Questions](#7-open-questions).

### AEyesBridge.cs (to be installed in Phase 2)

The **only file A-Eyes places in the Unity project**. Lives in `Assets/Editor/` (Editor-only, excluded from builds).

```csharp
// Assets/Editor/AEyesBridge.cs
using UnityEditor;
using System.IO;

public static class AEyesBridge
{
    public static void Play()  => EditorApplication.isPlaying = true;
    public static void Stop()  => EditorApplication.isPlaying = false;
    public static void Pause() => EditorApplication.isPaused = !EditorApplication.isPaused;
    public static void Step()  => EditorApplication.Step();

    public static void WriteStatus()
    {
        File.WriteAllText(
            Path.Combine(Path.GetTempPath(), "a-eyes-unity-status.json"),
            $"{{\"isPlaying\":{EditorApplication.isPlaying.ToString().ToLower()}," +
            $"\"isPaused\":{EditorApplication.isPaused.ToString().ToLower()}," +
            $"\"isCompiling\":{EditorApplication.isCompiling.ToString().ToLower()}}}"
        );
    }
}
```

---

## 7. Open Questions

### OQ-1: IPC Mechanism for Phase 2 (blocking)

How does the MCP server trigger the Bridge when the Editor is already running?

| Option | Latency | Complexity | Recommendation |
|---|---|---|---|
| (a) Command-file polling via `EditorApplication.update` | ~500ms | Low | **Phase 2 default** |
| (b) TCP socket in AEyesBridge | <10ms | Medium | Phase 3+ |
| (c) FileSystemWatcher in AEyesBridge | ~100ms | Low-Medium | Alternative to (a) |

Decision required before Phase 2 implementation starts.

### OQ-2: Multiple Unity Editor instances

If multiple projects are open, `Editor.log` is shared across all instances. Should `unity_console` filter log entries by `project_path`?

### OQ-3: Unity 6 Logging API

Unity 6 introduced `Unity.Logging` package alongside the legacy `Debug.Log`. Investigate if Editor.log format changed — may need separate parser paths.

### OQ-4: Bridge script installation

Should `unity_play` auto-install `AEyesBridge.cs` on first use, or require manual setup? Recommendation: auto-install with explicit user confirmation via MCP response.

---

## 8. Plugin File Structure

```
a-eyes/
├── src/
│   └── plugins/
│       └── unity/
│           ├── index.ts              # Plugin registration (conditional on config)
│           ├── config.ts             # Unity config schema (Zod)
│           ├── tools/
│           │   ├── console.ts        # unity_console
│           │   ├── scene.ts          # unity_scene
│           │   ├── compile.ts        # unity_compile (Phase 2)
│           │   ├── play-mode.ts      # unity_play (Phase 2)
│           │   ├── exec.ts           # unity_exec (Phase 2)
│           │   └── watcher.ts        # unity_watch (Phase 3)
│           ├── parsers/
│           │   ├── editor-log.ts     # Editor.log line parser + state machine
│           │   └── scene-yaml.ts     # Unity YAML preprocessor + hierarchy builder
│           └── bridge/
│               └── AEyesBridge.cs   # C# Editor script (Phase 2, installed into Unity project)
├── scripts/
│   └── unity/
│       ├── Invoke-UnityMethod.ps1   # Phase 2: executeMethod wrapper
│       ├── Watch-ProjectFiles.ps1   # Phase 3: FileSystemWatcher
│       └── Get-UnityEditorPath.ps1  # Auto-detect Unity.exe via Hub
└── tests/
    └── plugins/
        └── unity/
            ├── console.test.ts
            ├── scene-parser.test.ts
            ├── config.test.ts
            └── fixtures/
                ├── editor-log-compile-error.txt
                ├── editor-log-runtime-exception.txt
                ├── editor-log-clean.txt
                ├── sample-scene.unity
                └── sample-prefab.prefab
```

---

## 9. The Autonomous Workflow (End State — Phase 2 complete)

```
Developer: "Add an asteroid field that spawns rocks from the edges of the screen"

Claude Code:
  1. unity_scene → reads MainScene hierarchy
     "Found: GameManager, Player (Rigidbody2D + PlayerController), Camera"

  2. Writes AsteroidSpawner.cs, Asteroid.cs, AsteroidConfig.cs

  3. unity_console(filter: "errors") → "0 errors, compilation successful"

  4. unity_exec(method: "SetupAsteroids.Run") → creates prefab + scene setup

  5. unity_play(action: "play") → starts Play Mode

  6. capture(window: "Unity") + query → "Asteroids spawn from top edge only — fixing"

  7. unity_play(action: "stop") → fix code → unity_console → 0 errors
     unity_play(action: "play") → capture → "All edges working"
```

---

## 10. References

- [A-Eyes Repository](https://github.com/florian-priegnitz/A-Eyes)
- [GitHub Issue #23 — Phase 1](https://github.com/florian-priegnitz/A-Eyes/issues/23)
- [GitHub Issue #24 — Phase 2 IPC Design](https://github.com/florian-priegnitz/A-Eyes/issues/24)
- [Unity 6 CLI Arguments](https://docs.unity3d.com/6000.0/Documentation/Manual/EditorCommandLineArguments.html)
- [Unity YAML Scene Format](https://docs.unity3d.com/6000.0/Documentation/Manual/FormatDescription.html)
- [Peekaboo (macOS equivalent)](https://github.com/steipete/Peekaboo)
