# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Tauri desktop application** — React/TypeScript frontend + Rust backend — providing an interactive workspace client with an embedded terminal (PTY-backed xterm.js).

## Commands

```bash
npm install                                        # Install frontend & Tauri CLI deps
npm run dev                                        # Vite frontend dev server only
npm run build                                      # TypeScript compile + production web build
npm run lint                                       # ESLint (--max-warnings 0, warnings fail)
npm run tauri dev                                  # Full desktop app in development mode
npm run tauri build                                # Packaged desktop build
cargo check --manifest-path src-tauri/Cargo.toml  # Validate Rust without full build
```

**Minimum checks before any PR**: `npm run lint`, `npm run build`, `cargo check`.

## Architecture

### Frontend (`src/`)
- `app/App.tsx` — top-level routing between home, workspaces, and project view
- `features/` — self-contained feature modules, each with `components/`, `api.ts`, `types.ts`, and `hooks/`
  - `terminal/` — xterm.js terminal with sticky composer (`TerminalPane.tsx`)
  - `workspaces/` — workspace creation, listing, selection
  - `project/` — project-level view
- `shared/lib/tauri.ts` — typed `invokeCommand<T>()` wrapper around Tauri IPC; use this instead of calling `invoke` directly
- `shared/ui/` — shared icon components

### Backend (`src-tauri/src/`)
- `commands.rs` — all `#[tauri::command]` handlers registered via `generate_handler!`
- `workspaces.rs` — workspace persistence and business logic
- `terminal.rs` — PTY/session management via `portable-pty`
- `models.rs` — serde-serialized data structs shared across IPC; all use `#[serde(rename_all = "camelCase")]`
- `lib.rs` — Tauri app setup and plugin initialization

### IPC Pattern
Frontend calls `invokeCommand<ReturnType>("command_name", { ...args })` → Rust `#[tauri::command]` fn → returns `Result<T, String>`. Terminal output streams via Tauri `Channel<TerminalEvent>`.

## Key Constraints

- **`TerminalPane.tsx` layout**: preserves a `min-h-0`/`overflow-hidden` contract so the composer stays visible and the xterm viewport does not push the overall window. Do not break this when modifying terminal or chat UX.
- **Auto-scroll behavior**: auto-scroll must pause when the user scrolls up and resume only when scrolled back to the bottom.
- **No test suite**: verify UI/terminal changes manually in `npm run tauri dev`.

## Code Style

| Language | Indent | Semis | Naming |
|---|---|---|---|
| TypeScript | 2 spaces | omit | PascalCase components, `useX` hooks, `types.ts` for feature types |
| Rust | 4 spaces (rustfmt) | — | `snake_case` functions, `CamelCase` structs/enums |
