#!/usr/bin/env node

import { spawn } from "node:child_process"

import { commandExists, printMissingCargoMessage, withCargoPath } from "./env.js"

const tauri = process.platform === "win32" ? "tauri.cmd" : "tauri"
const env = withCargoPath(process.env)

if (!commandExists("cargo", env)) {
  printMissingCargoMessage()
  process.exit(1)
}

const child = spawn(tauri, process.argv.slice(2), {
  env,
  stdio: "inherit"
})

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 1)
})

child.on("error", (error) => {
  console.error(`Failed to run Tauri CLI: ${error.message}`)
  process.exit(1)
})
