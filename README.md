# OpenBanjo

<p align="center">
  <img src="public/openbanjo.png" alt="OpenBanjo" width="420" />
</p>

<p align="center">
  <strong>A local desktop workspace for Codex and Claude coding sessions.</strong>
</p>

<p align="center">
  <img alt="Tauri 2" src="https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white" />
  <img alt="React 18" src="https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=111111" />
  <img alt="Rust" src="https://img.shields.io/badge/Rust-2021-000000?logo=rust&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white" />
  <img alt="Vite" src="https://img.shields.io/badge/Vite-5-646CFF?logo=vite&logoColor=white" />
</p>

OpenBanjo is a Tauri desktop app that keeps your local projects, AI coding
CLIs, terminal sessions, and assistant side panels in one compact workspace. It
is built for developers who already use tools like Codex, Claude Code, ChatGPT,
Claude, and local editors, and want a focused shell around their project flow.

## Highlights

- Open local project folders and keep recent workspaces close.
- Favorite projects and switch between open workspaces from a compact sidebar.
- Start isolated Codex or Claude CLI sessions inside the active workspace.
- Keep multiple AI sessions open as tabs, with per-session terminal state.
- Use an xterm-powered terminal that preserves viewport containment and focus.
- Preview file changes made during each session.
- Open ChatGPT or Claude in a docked side panel.
- Detect Git branch, latest commit details, and common project stacks.
- Switch to existing Git branches or create a new branch from the app.
- Launch the current workspace in VS Code, Cursor, Antigravity, Windsurf, or Zed
  when their CLIs are available in `PATH`.
- Check cached Codex and Claude usage status from isolated CLI calls.

## Quick Start

### Requirements

- Node.js and npm.
- Linux x64 for the npm-installed AppImage.
- Git for workspace metadata and branch actions.
- Optional: `codex` and `claude` CLIs in `PATH` to enable AI session launchers.
- Optional: editor CLIs such as `code`, `cursor`, `antigravity`, `windsurf`, or
  `zed` in `PATH`.

### Install from npm

```bash
npm install -g openbanjo
openbanjo
```

The npm package downloads the prebuilt Linux x64 AppImage from GitHub Releases
during install. Rust, Cargo, and the Tauri CLI are only required for local
development or release builds.

### Run from source

Source development requires Node.js, npm, Rust/Cargo, and the Tauri 2 system
dependencies for your operating system.

```bash
git clone https://github.com/ViniciusJBSilva/openbanjo.git
cd openbanjo
npm install
npm run tauri dev
```

`npm run tauri dev` starts the Vite frontend and opens the Tauri desktop app.

## Development

Run the frontend only:

```bash
npm run dev
```

Build the frontend:

```bash
npm run build
```

Run ESLint:

```bash
npm run lint
```

Check the Rust backend:

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Create a packaged desktop build:

```bash
npm run tauri build
```

Check the npm package contents before publishing:

```bash
npm run pack:check
```

## Project Structure

- `src/` contains the React app, feature modules, shared UI, and i18n resources.
- `src/features/workspaces/` manages recent projects, favorites, sidebar state,
  directory selection, editor launching, and Git branch actions.
- `src/features/project/` owns the active workspace shell, topbar, session tabs,
  and assistant panel placement.
- `src/features/terminal/` owns PTY sessions, xterm rendering, CLI status,
  terminal focus, resize behavior, follow-output state, and change previews.
- `src/features/chatgpt/` owns the ChatGPT and Claude side panel integration.
- `src/features/usage/` shows cached Codex and Claude usage details.
- `src-tauri/src/` contains the Rust command handlers, PTY/session lifecycle,
  workspace persistence, assistant webview windows, and shared IPC models.
- `public/` stores public frontend assets, including the OpenBanjo README image.

Generated outputs such as `dist/` and `src-tauri/target/` should not be edited
manually.

## Status

OpenBanjo is early-stage, local-first desktop software. It does not bundle
Codex, Claude, ChatGPT, Claude.ai, or external editors. Install and authenticate
those tools separately, then make sure their command line launchers are
available to the app through `PATH`.

## Contributing

Before opening a pull request, run:

```bash
npm run lint
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

For UI, workspace, terminal, or assistant panel changes, also verify the flow
manually in `npm run tauri dev`.
