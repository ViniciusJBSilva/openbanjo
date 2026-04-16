# Repository Guidelines

## Project Structure & Module Organization
This repository is a Tauri 2 desktop app with a React 18 + Vite frontend and a Rust backend. Frontend entry points live in `src/main.tsx` and `src/App.tsx`, while the real app shell is in `src/app/App.tsx`. Feature code lives under `src/features/`: `workspaces` handles recent workspaces, favorites, directory picking, and the compact left navigation; `project` owns the active workspace shell, topbar, session tabs, and assistant panel placement; `terminal` owns PTY sessions, xterm rendering, CLI status, focus, resize, and follow-output state; `chatgpt` owns the ChatGPT/Claude side panel; and `usage` shows cached CLI usage details. Shared helpers and icons live in `src/shared/lib/` and `src/shared/ui/`.

The primary workspace experience is split across `WorkspaceSidebar`, `ProjectScreen`, `TerminalPane`, and `ChatGPTSidebar`. Preserve the compact sidebar behavior (collapsed, hover-expanded, and pinned), the `min-h-0`/`overflow-hidden` layout contract, terminal focus and resize rules, xterm viewport containment, and the current auto-scroll behavior. `ProjectScreen.tsx` manages multiple CLI sessions per workspace, so session-tab behavior and per-session terminal state should be preserved when iterating on that flow.

Rust code lives in `src-tauri/src/`: `commands.rs` exposes Tauri commands, `terminal.rs` manages PTY/session lifecycle, `workspaces.rs` persists recent workspaces and launches external targets, `chatgpt.rs` handles prompt-improvement requests, `models.rs` defines shared IPC payloads, and `lib.rs` wires the app together. Static assets live in `public/` and `src/assets/`. Build outputs in `dist/` and `src-tauri/target/` are generated and should not be edited manually.

## Build, Test, and Development Commands
- `npm install`: install frontend dependencies and the Tauri CLI package.
- `npm run dev`: start the Vite frontend only.
- `npm run build`: run TypeScript compilation and produce the production web build in `dist/`.
- `npm run lint`: run ESLint for all `ts` and `tsx` files with `--max-warnings 0`.
- `npm run preview`: serve the built frontend locally.
- `npm run tauri dev`: run the desktop app in development mode.
- `npm run tauri build`: create a packaged desktop build.
- `cargo check --manifest-path src-tauri/Cargo.toml`: validate Rust changes without a full desktop build.
- `cargo fmt --manifest-path src-tauri/Cargo.toml`: format Rust files after backend edits.

## Coding Style & Naming Conventions
Use 2-space indentation and omit semicolons in TypeScript to match the existing codebase. Keep React components in PascalCase files such as `ProjectScreen.tsx`, hooks in `useX` form such as `useTerminalSession.ts`, feature-local API wrappers in `api.ts`, and feature-local types in `types.ts`. Styling is primarily Tailwind utility classes with a clean dark neutral UI: near-black surfaces, subtle borders, compact spacing, small radii, low shadow, and restrained accent color. Prefer flat shell divisions over nested card/glass treatments unless a card is the actual interaction. User-facing UI copy is predominantly Portuguese, so keep new product text aligned with that unless the surrounding screen is already in English.

Rust follows standard `rustfmt` defaults: 4-space indentation, `snake_case` for functions, and `CamelCase` for structs and enums. Prefer small command handlers in `commands.rs` and keep heavier logic in the feature modules such as `terminal.rs` and `workspaces.rs`.

## Testing Guidelines
There is no automated test suite in the current checkout. At minimum, run `npm run lint`, `npm run build`, and `cargo check --manifest-path src-tauri/Cargo.toml` before opening a PR. For UI or terminal-flow changes, verify the behavior manually in `npm run tauri dev` and document the steps you exercised.

For workspace-management changes, manually cover opening a directory, updating recent workspaces, favoriting/unfavoriting, using the compact/expanded/pinned sidebar, and switching between open workspace tabs. For terminal and project-shell changes, explicitly confirm that the `xterm` viewport scroll does not push the overall window, terminal focus is restored on active sessions, resize still fits the terminal, auto-scroll pauses when the user scrolls up and resumes only when sent back to the bottom, and multiple session tabs keep their own state correctly. If you touch the ChatGPT/Claude panel or CLI usage panels, also verify those interactions manually because they do not have automated coverage.

## Commit & Pull Request Guidelines
Git history is available in this workspace, but it is too sparse to establish a meaningful repository-specific convention. Use short, imperative commit subjects such as `Add terminal resize handling`. Avoid committing generated outputs from `dist/` or `src-tauri/target/`.

PRs should include a clear summary, linked issue if applicable, manual verification steps, and screenshots or short recordings for visible UI changes. When a change touches both frontend and Rust code, mention both verification paths in the PR description.
