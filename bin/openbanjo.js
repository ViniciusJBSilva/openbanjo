#!/usr/bin/env node

import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { spawn, spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { getTarget, getVendorBinaryPath, unsupportedMessage } from "../scripts/platform.js"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const args = process.argv.slice(2)
const target = getTarget()

const help = `OpenBanjo

Usage:
  openbanjo              Start the OpenBanjo desktop app
  openbanjo --help       Show this help

The npm package currently ships a prebuilt Linux x64 AppImage.
`

if (args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
  console.log(help)
  process.exit(0)
}

if (!target) {
  console.error(unsupportedMessage())
  process.exit(1)
}

const binaryPath = getVendorBinaryPath(root, target)

if (!existsSync(binaryPath)) {
  console.error("OpenBanjo binary was not found. Trying to download it now...\n")

  const install = spawnSync(process.execPath, [resolve(root, "scripts", "install-binary.js")], {
    cwd: root,
    env: { ...process.env, OPENBANJO_FORCE_DOWNLOAD: "1" },
    stdio: "inherit"
  })

  if (install.status !== 0 || !existsSync(binaryPath)) {
    console.error("\nFailed to prepare the OpenBanjo binary.")
    console.error("Try reinstalling with: npm install -g openbanjo@latest")
    process.exit(install.status ?? 1)
  }
}

const child = spawn(binaryPath, args, {
  stdio: "inherit",
  env: process.env
})

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 0)
})

child.on("error", (error) => {
  console.error(`Failed to start OpenBanjo: ${error.message}`)
  process.exit(1)
})
