# A-Eyes — Product Roadmap

> **Stand:** 2026-03-17
> **Maintainer:** Florian Priegnitz
> **Repo:** github.com/florian-priegnitz/A-Eyes
> **Commit:** `41da159`
> **Lizenz:** MIT

---

## Aktueller Stand

**177 Tests · 8 MCP-Tools · TypeScript · WSL2**

A-Eyes hat sich vom reinen Screenshot-Server zu einer **AI-Agent Sensor Platform** entwickelt: Screen, System, Input — alles über ein MCP-Interface.

### Aktive Tools

| Tool | Beschreibung |
|------|-------------|
| `capture` | Screenshot mit JPEG-Support, Crop/Region, max_width, process_name, frontmost Window |
| `list_windows` | Sichtbare Fenster auflisten, +/- Marker für Allowlist-Status |
| `query` | Screenshot + Frage an Claude weiterleiten |
| `see` | UI-Automation via Windows UIAutomation API — Element-Tree + Textextraktion |
| `check_status` | Health-Check: WSL-Interop, PowerShell, Config-Validität |
| `setup` | Interaktiver First-Run-Setup |
| `clipboard` | Read (Text/Image/Empty) + Write via System.Windows.Forms |
| `processes` | Get-Process mit CPU, RAM, PID, Name-Filter, sort_by |

### Abgeschlossene Infrastruktur

- [x] CHANGELOG.md (Keep a Changelog)
- [x] Conventional Commits
- [x] Rate Limiting (`max_captures_per_minute`)
- [x] npm-Paket-Felder in package.json
- [x] Tamper-resistant Audit Log (JSONL, append-only, tägliche Rotation)
- [x] Deny-by-default Allowlist mit Zod-Validierung
- [x] Region-of-Interest Capture (crop/region Parameter)
- [x] Health-Check Endpoint
- [x] Setup-Wizard
- [x] Frontmost-Window-Capture (kein Titel nötig)

---

## Strategische Positionierung

A-Eyes ist nicht "Peekaboo für Windows". A-Eyes ist ein **sicherheitsgehärteter Sensor-Layer für AI-Agents**, der Screen, System und Input über ein einheitliches MCP-Interface exponiert — mit Deny-by-Default, Audit Trail und Policy-Kontrolle.

**Differentiator-Stack:**

```
Peekaboo (macOS)         A-Eyes
─────────────────        ─────────────────────────────
Screenshots              Screenshots
                         + UI-Automation (see)
                         + System-Sensoren (processes)
                         + Input-Bridge (clipboard)
                         + Audit Logging
                         + Policy Engine
                         + [geplant] Content Redaction
                         + [geplant] Signed Audit Logs
                         + [geplant] Watch Mode
```

---

## Priorisierungslogik

1. **Bugs und Stabilität** — Vertrauen in bestehende Tools festigen
2. **CI zuerst** — Fundament für alle weiteren Änderungen
3. **Security-Differentiator vertiefen** — Signed Logs, Policies, Redaction
4. **Sensor-Coverage ausbauen** — Fullscreen, OCR, Watch Mode, Events
5. **Distribution & Community** — npm-Publish, Registry, Sichtbarkeit
6. **Plattform-Abstraktion** — Cross-Platform als v2.0-Horizont

---

## Phase 1 — Bugs, Stabilität & CI (v0.next)

**Ziel:** Bestehende Tools zuverlässig machen und CI aufsetzen, bevor neue Features dazukommen.
**Aufwand:** 1 Wochenende
**GitHub Issues:** #8, #6, #11, #18

### 1.1 · GitHub Actions CI Pipeline — #18 (High)

- Workflow: `ci.yml` mit Matrix-Build (Node 18, 20, 22)
- Steps: Install → Lint (Biome) → Type-Check (tsc) → Test (Vitest)
- Trigger: Push auf `main`, alle PRs
- CI-Badge im README
- **Warum zuerst:** Ohne CI ist jede nachfolgende Änderung an Phase 2/3 blind. CI ist das Fundament, nicht die Krönung.

### 1.2 · Fix: Falsches Fenster bei mehreren Treffern — #8 (Bug, Medium)

- Problem: Wenn mehrere Fenster auf den Titel-Substring matchen, wird nicht deterministisch das richtige ausgewählt
- Lösungsoptionen:
  - (a) Exakter Match hat Vorrang vor Substring-Match
  - (b) `list_windows` zeigt PID/Handle, `capture` akzeptiert PID als alternativen Selektor
  - (c) Bei >1 Treffer: Liste zurückgeben statt stillem Fallback
- Empfehlung: (b) + (c) kombinieren
- Akzeptanzkriterium: Bei 3 offenen Chrome-Fenstern wird zuverlässig das richtige erfasst

### 1.3 · Richer list_windows — #11 (Medium)

- Felder ergänzen: `is_active`, `pid`, `window_count` (Fenster pro Prozess)
- Ermöglicht: Unterscheidbarkeit bei mehreren Fenstern desselben Prozesses
- Unterstützt Fix #8 (PID als Selektor)
- Breaking-Change-Risiko: Gering, da additive Felder

### 1.4 · DPI/Retina Scaling — #6 (Medium)

- Problem: Screenshots auf HiDPI-Displays liefern falsche Dimensionen
- Fix: DPI-Awareness in PowerShell-Scripts (`SetProcessDPIAware`)
- Crop-Koordinaten müssen DPI-Factor berücksichtigen
- Akzeptanzkriterium: Identische Ausgabe auf 100%, 125%, 150%, 200% Skalierung

---

## Phase 2 — Security Policy Engine (v0.next+1)

**Ziel:** Von einfacher Allowlist zu produktionsreifem Policy-Layer.
**Aufwand:** 2–3 Wochenenden
**GitHub Issues:** #19, #20

### 2.1 · Pattern-basierte Policies — #19 (High)

- Regex-Support für Window-Titel statt reinem Substring-Matching
- Explizite Deny-Regeln (nicht nur "alles was nicht in der Allowlist steht")
- First-Match-Wins-Evaluation (Firewall-Regellogik)
- Neu: `tools`-Feld — granulare Steuerung welche Tools pro Pattern erlaubt sind
- Konfiguration:
  ```json
  {
    "policies": [
      { "pattern": ".*Password.*",  "action": "deny" },
      { "pattern": "^VS Code.*",    "action": "allow", "tools": ["capture", "see"] },
      { "pattern": "^Chrome.*",     "action": "allow", "tools": ["capture"] }
    ]
  }
  ```
- Migration: Bestehende `allowlist`-Syntax bleibt funktional, wird intern zu Policies konvertiert

### 2.2 · Zeitfenster-Policies

- `schedule`-Feld in Policy-Regeln:
  ```json
  { "pattern": "^Chrome.*", "action": "allow", "schedule": {
      "hours": { "from": "08:00", "to": "18:00" },
      "days": ["Mon", "Tue", "Wed", "Thu", "Fri"]
  }}
  ```
- Außerhalb des Zeitfensters: Eigener Error-Code
- Timezone-Handling: System-Timezone als Default, override per Config

### 2.3 · Tool-spezifisches Rate Limiting

- Bestehendes Rate Limiting erweitern: pro Tool und pro Pattern
  ```json
  { "pattern": "^Chrome.*", "action": "allow",
    "rate_limit": { "capture": 10, "see": 5, "query": 3 }
  }
  ```
- Fallback-Kette: Tool-spezifisch → Pattern-spezifisch → Global

### 2.4 · Signed Audit Logs — #20 (Medium)

- HMAC-SHA256-Signatur pro Log-Eintrag
- Signatur-Input: JSON-Eintrag + Hash des vorherigen Eintrags (Chain)
- Key-Management: `A_EYES_AUDIT_KEY` Env-Var oder `~/.a-eyes/audit.key`
- CLI: `node dist/index.js verify-logs [--date YYYY-MM-DD]`
- Dokumentation: `/docs/audit-integrity.md` mit Threat-Model

### 2.5 · Policy-as-Code

- JSON Schema für `a-eyes.config.json` veröffentlichen
- `$schema`-Referenz im Config für IDE-Autocompletion
- CLI: `node dist/index.js validate` — prüft Config gegen Schema

---

## Phase 3 — Content Redaction (v0.next+2)

**Ziel:** PII und sensible Inhalte automatisch unkenntlich machen, bevor Bilddaten Claude erreichen.
**Aufwand:** 2–3 Wochenenden
**GitHub Issues:** #21
**Strategischer Wert:** Kein anderer MCP-Screenshot-Server bietet das.

### 3.1 · Region-basierte Redaction — #21 (Medium)

- Konfigurierbare Bounding Boxes pro Fenster-Policy:
  ```json
  {
    "pattern": "^Chrome.*Bank.*",
    "action": "allow",
    "redactions": [
      { "x": 100, "y": 200, "width": 300, "height": 50, "method": "blur" }
    ]
  }
  ```
- Methoden: `blur`, `pixelate`, `blackout`
- Implementierung: Sharp (Node.js) als optionale Peer-Dependency
- Pipeline-Position: Nach Capture, vor Base64-Encoding
- Performance-Budget: < 200ms für Region-Redaction

### 3.2 · Smart Redaction via OCR

- Texterkennung im Screenshot-Image, Pattern-Matching auf erkanntem Text
- Vordefinierte Presets: `"auto_redact": ["pii"]` aktiviert E-Mail, IBAN, Kreditkarte, Telefon
- Bounding-Box von OCR → Blur-Region automatisch
- Performance-Budget: < 500ms inklusive OCR

### 3.3 · Redaction-Audit & Reporting

- Jeder Redaction-Vorgang im Audit-Log: Anzahl Regions, Methoden, Pattern-Typen
- Kein Logging des Originalinhalts
- Neues MCP-Tool `redaction_report`: Aggregat-Statistik der letzten 24h

---

## Phase 4 — Sensor-Erweiterung (v0.next+3)

**Ziel:** Sensor-Coverage ausbauen.
**Aufwand:** 2–3 Wochenenden
**GitHub Issues:** #4, #12, #17, #13, #22

### 4.1 · Full-Screen Capture — #4 (High)

- Parameter: `capture({ target: "screen", monitor: 0 })`
- Multi-Monitor: Einzeln oder als zusammengesetztes Bild
- Policy: Eigene Regel `__fullscreen__`, Default: Deny

### 4.2 · Text-only OCR Mode — #12 (Medium)

- Leichtgewichtige Alternative zu `see`: reine Pixel-basierte Texterkennung
- Implementierung: Windows OCR API via PowerShell (`Windows.Media.Ocr`) — kein Extra-Dependency
- Rückgabe: Plain Text oder JSON mit Bounding Boxes
- Synergy: Bounding Boxes füttern direkt die Redaction-Pipeline (Phase 3)

### 4.3 · Windows Event Log Sensor — #17 (Medium)

- Tool `events`: Liest Windows Event Log via `Get-WinEvent`
- Filter: Log-Name, Level, Zeitraum
  ```
  events({ log: "Application", level: "Error", last_minutes: 60 })
  ```
- Policy-Kontrolle: Welche Event-Logs dürfen gelesen werden

### 4.4 · Browser Sensor via Chrome DevTools Protocol — #22 (Low)

- Tool `browser`: aktuelle URL + offene Tabs via CDP
- Chrome muss mit `--remote-debugging-port=9222` gestartet sein
- Kein Extra-Dependency — plain HTTP fetch gegen `localhost:9222/json`
- Config: `browser_debug_port: 9222`
- Ergänzt Screen-Sensor: URL = wo der User ist, Screenshot = was er sieht

### 4.5 · Watch Mode & Change Detection — #13 (Future)

- Tool `watch`: Polling mit pHash-Differenz-Erkennung
  ```
  watch({ title: "Grafana Dashboard", interval_ms: 10000, duration_s: 300 })
  ```
- Rückgabe bei Change: Diff-Image + Change-Percentage + Timestamp

### 4.6 · Click Automation — #9 (Future)

- Erweiterung von `see`: click, type, scroll auf Element-IDs
- Policy-Split: `allow_read` vs. `allow_interact`
- Default: `allow_read` (Interaktion explizit opt-in)

---

## Phase 4b — Unity Plugin (parallel zu Phase 4)

**Ziel:** Claude Code sieht Unity — Compile-Fehler, Szenen-Hierarchie, Play Mode.
**Aufwand:** Phase 1 ~3 Tage, Phase 2 nach IPC-Design
**GitHub Issues:** #23 (Phase 1), #24 (Phase 2)
**Vollständige Spezifikation:** [docs/unity-plugin.md](unity-plugin.md)

### Warum konservativ vorgehen

Phase 2 (compile, play, exec) hat ein ungelöstes IPC-Problem: `Unity.exe -executeMethod` öffnet einen *neuen* Prozess — es kann keinen laufenden Editor steuern. Phase 2 wird erst begonnen wenn das IPC-Design steht. Phase 1 ist vollständig sicher.

### Phase 1 (scope:next) — read-only, sicher — #23

Plugin nur aktiv wenn `plugins.unity.enabled: true` — kein Overhead ohne Config.

| Tool | Was es tut | Zugriff |
|------|-----------|---------|
| `unity_console` | Editor.log parsen: Compile-Fehler, Warnings, Exceptions | Direkter File-Read via `/mnt/c/` |
| `unity_scene` | `.unity`/`.prefab` YAML → strukturierte GameObject-Hierarchie | Direkter File-Read + YAML-Preprocessing |

**Unity YAML Preprocessing:** `%TAG !u!`-Direktiven und `!u!NNN`-Typ-Tags vor dem Parsen entfernen (3 Regex-Replacements) — kein Unity-spezifischer YAML-Parser nötig.

### Phase 2 (scope:future) — Actions, erst nach IPC-Design — #24

| Tool | Was es tut |
|------|-----------|
| `unity_compile` | Recompile triggern, Fehler strukturiert zurückgeben |
| `unity_play` | Play / Stop / Pause / Step |
| `unity_exec` | Statische C#-Methoden aufrufen (gated by `allowed_methods` Allowlist) |

**IPC-Optionen:** (a) Command-File-Polling via `EditorApplication.update` (~500ms, empfohlen), (b) TCP-Socket im Bridge-Script, (c) FileSystemWatcher im Bridge-Script. Entscheidung vor Implementierungsbeginn.

---

## Phase 5 — Distribution & Community (v1.0.0)

**Ziel:** A-Eyes für andere nutzbar und auffindbar machen.
**Aufwand:** 1–2 Wochenenden
**Voraussetzung:** Phase 1–3 abgeschlossen.

### 5.1 · npm-Publish

- Paketname: `a-eyes-mcp`
- `npx a-eyes-mcp` startet Server direkt
- `npx a-eyes-mcp init` — interaktiver Config-Wizard
- `prepublishOnly`: Build + Test + Lint

### 5.2 · MCP Registry Listing

- Voraussetzungen: npm-Paket, stabile API, MIT-Lizenz, SECURITY.md
- Positionierung: Security-first, nicht Feature-first

### 5.3 · Dokumentation & Showcase

- `CONTRIBUTING.md`, `SECURITY.md`
- Demo-Video oder animiertes GIF im README
- `/examples`: `browser-monitoring.md`, `code-review.md`, `security-audit.md`

---

## Phase 6 — Plattform-Abstraktion (v2.0.0)

**Ziel:** Von WSL2-Only zu Cross-Platform.
**Aufwand:** 3–5 Wochenenden
**Voraussetzung:** Stabile Tool-API aus Phase 1–5.

### 6.1 · Provider-Interface

```typescript
interface ScreenshotProvider {
  readonly platform: 'wsl2' | 'windows' | 'macos' | 'linux';
  capture(target: CaptureTarget, options?: CaptureOptions): Promise<Buffer>;
  listWindows(): Promise<WindowInfo[]>;
  isAvailable(): Promise<boolean>;
}
```

### 6.2 · Native Windows Provider

- Win32-APIs direkt über Node.js (ohne WSL-Umweg)
- Funktioniert auch ohne WSL2

### 6.3 · macOS Provider

- `screencapture` CLI / Swift-Helper
- Positionierung: "Peekaboo mit Security-Layer"

### 6.4 · Linux Provider

- X11: `xdotool` + `maim`
- Wayland: `grim` + `slurp`

---

## Phase 7 — Advanced & Ecosystem (v2.x)

- MCP Resources & Prompts (`a-eyes://captures/{timestamp}/{title}`)
- Screenshot-Annotations (Timestamp, Policy-Marker, Capture-ID)
- Plugin-System (Pre/Post-Capture Hooks, npm-Pakete)
- Webhook-Integration bei Policy-Violations und Watch-Triggers
- Video-Capture (WebM/GIF, max. 30s, nur bei Community-Nachfrage)

---

## Abhängigkeiten & Reihenfolge

```
Phase 1 (Bugs + CI)               ← JETZT
  ├──► Phase 2 (Security Policies)
  │      └──► Phase 3 (Redaction)
  │             └──► Phase 5 (Distribution v1.0)
  │                    └──► Phase 6 (Cross-Platform v2.0)
  │                           └──► Phase 7 (Advanced)
  └──► Phase 4 (Sensor-Erweiterung) ← parallel zu Phase 2/3
```

**Kritischer Pfad:** Phase 1 → 2 → 3 → 5 (v1.0 Release)
**Quick Wins parallel:** #4 Full-Screen, #11 Richer list_windows, #12 OCR Mode

---

## Nicht-funktionale Anforderungen

| Bereich | Anforderung |
|---------|-------------|
| Performance | Capture < 2s, Redaction < 200ms (Region) / < 500ms (OCR), see < 3s |
| Tests | Minimum 80% Line Coverage, jedes neue Tool mit Unit + Integration Tests |
| Dokumentation | JSDoc auf allen öffentlichen Funktionen, README-Sektion pro Tool |
| Security | Kein `eval()`, kein `shell: true`, alle Inputs Zod-validiert, `pnpm audit` clean |
| Kompatibilität | Node 18+ LTS, MCP SDK aktuelle Major-Version |
| Audit | Jeder Tool-Call geloggt, keine Ausnahmen, kein Opt-Out |

---

## Meilensteine & Erfolgsindikatoren

| Meilenstein | Indikator |
|-------------|-----------|
| Phase 1 done | CI grün, alle High/Medium Bugs geschlossen, 200+ Tests |
| Phase 2 done | Policy-Engine als eigenständiger Blogpost nutzbar |
| Phase 3 done | Demo-Video mit Live-PII-Redaction, klare Peekaboo-Differenzierung |
| v1.0.0 | npm-Paket publiziert, MCP Registry gelistet, erste externe Nutzer |
| v2.0.0 | Cross-Platform CI grün, macOS-Provider funktional |

---

*Lebendes Dokument. Review nach jedem Phasen-Abschluss. Letzte Aktualisierung: 2026-03-17.*
