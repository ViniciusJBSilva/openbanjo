import { spawnSync } from "node:child_process"
import { delimiter, join } from "node:path"
import { homedir } from "node:os"

export function withCargoPath(baseEnv) {
  const env = { ...baseEnv }
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH"
  const cargoBin = join(homedir(), ".cargo", "bin")
  const currentPath = env[pathKey] ?? ""
  const entries = currentPath.split(delimiter).filter(Boolean)

  if (!entries.includes(cargoBin)) {
    env[pathKey] = [cargoBin, ...entries].join(delimiter)
  }

  return env
}

export function commandExists(command, env) {
  const probe = process.platform === "win32" ? "where" : "command"
  const args = process.platform === "win32" ? [command] : ["-v", command]
  const result = spawnSync(probe, args, {
    env,
    shell: process.platform !== "win32",
    stdio: "ignore"
  })

  return result.status === 0
}

export function printMissingCargoMessage() {
  console.error(`Cargo was not found.

Local OpenBanjo development and Tauri builds require Rust/Cargo.

Install Rust from:
  https://www.rust-lang.org/tools/install

After installing, open a new terminal and check:
  cargo --version

Then retry the Tauri command.
`)
}
