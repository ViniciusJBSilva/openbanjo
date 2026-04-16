#!/usr/bin/env node

import { createHash } from "node:crypto"
import { createReadStream, createWriteStream, existsSync } from "node:fs"
import { chmod, mkdir, readFile, rename, rm } from "node:fs/promises"
import http from "node:http"
import https from "node:https"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { getTarget, getVendorBinaryPath, unsupportedMessage } from "./platform.js"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"))
const version = packageJson.version
const sourceCheckout = existsSync(join(root, "src-tauri", "Cargo.toml"))
const target = getTarget()

if (process.env.OPENBANJO_SKIP_DOWNLOAD === "1") {
  console.log("Skipping OpenBanjo binary download because OPENBANJO_SKIP_DOWNLOAD=1.")
  process.exit(0)
}

if (sourceCheckout && process.env.OPENBANJO_FORCE_DOWNLOAD !== "1") {
  console.log("Skipping OpenBanjo binary download in a source checkout.")
  process.exit(0)
}

if (!target) {
  console.warn(unsupportedMessage())
  process.exit(0)
}

const baseUrl =
  process.env.OPENBANJO_DOWNLOAD_BASE_URL ??
  `https://github.com/ViniciusJBSilva/openbanjo/releases/download/v${version}`

const binaryPath = getVendorBinaryPath(root, target)
const checksumPath = `${binaryPath}.sha256`
const binaryUrl = `${baseUrl}/${target.assetName}`
const checksumUrl = `${binaryUrl}.sha256`

await mkdir(dirname(binaryPath), { recursive: true })

console.log(`Downloading OpenBanjo ${version} for Linux x64...`)

const expectedChecksum = parseChecksum(await readText(checksumUrl), target.assetName)

if (existsSync(binaryPath)) {
  const currentChecksum = await sha256File(binaryPath)

  if (currentChecksum === expectedChecksum) {
    await chmod(binaryPath, 0o755)
    console.log("OpenBanjo binary is already installed.")
    process.exit(0)
  }
}

const tmpPath = `${binaryPath}.download`

try {
  await downloadFile(binaryUrl, tmpPath)

  const actualChecksum = await sha256File(tmpPath)
  if (actualChecksum !== expectedChecksum) {
    throw new Error(
      `Checksum mismatch for ${target.assetName}: expected ${expectedChecksum}, got ${actualChecksum}`
    )
  }

  await rename(tmpPath, binaryPath)
  await chmod(binaryPath, 0o755)
  await writeChecksumFile(checksumPath, expectedChecksum, target.assetName)
  console.log("OpenBanjo binary installed.")
} catch (error) {
  await rm(tmpPath, { force: true })
  console.error(`Failed to install OpenBanjo binary: ${error.message}`)
  process.exit(1)
}

function parseChecksum(text, assetName) {
  const line = text
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find(Boolean)

  const checksum = line?.split(/\s+/)[0]

  if (!checksum || !/^[a-fA-F0-9]{64}$/.test(checksum)) {
    throw new Error(`Invalid checksum file for ${assetName}`)
  }

  return checksum.toLowerCase()
}

async function writeChecksumFile(path, checksum, assetName) {
  const { writeFile } = await import("node:fs/promises")
  await writeFile(path, `${checksum}  ${assetName}\n`)
}

function sha256File(path) {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256")
    const stream = createReadStream(path)

    stream.on("error", reject)
    stream.on("data", (chunk) => hash.update(chunk))
    stream.on("end", () => resolveHash(hash.digest("hex")))
  })
}

function readText(url) {
  if (url.startsWith("file://")) {
    return readFile(new URL(url), "utf8")
  }

  return request(url, "text")
}

function downloadFile(url, destination) {
  if (url.startsWith("file://")) {
    return new Promise((resolveCopy, reject) => {
      const input = createReadStream(new URL(url))
      const output = createWriteStream(destination, { mode: 0o755 })

      input.on("error", reject)
      output.on("error", reject)
      output.on("finish", resolveCopy)
      input.pipe(output)
    })
  }

  return request(url, "file", destination)
}

function request(url, mode, destination, redirects = 0) {
  return new Promise((resolveRequest, reject) => {
    if (redirects > 5) {
      reject(new Error(`Too many redirects while downloading ${url}`))
      return
    }

    const client = url.startsWith("http://") ? http : https
    const requestHandle = client.get(url, (response) => {
      const status = response.statusCode ?? 0

      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        const nextUrl = new URL(response.headers.location, url).toString()
        response.resume()
        request(nextUrl, mode, destination, redirects + 1).then(resolveRequest, reject)
        return
      }

      if (status !== 200) {
        response.resume()
        reject(new Error(`Download failed with HTTP ${status}: ${url}`))
        return
      }

      if (mode === "text") {
        response.setEncoding("utf8")
        let body = ""
        response.on("data", (chunk) => {
          body += chunk
        })
        response.on("end", () => resolveRequest(body))
        return
      }

      const output = createWriteStream(destination, { mode: 0o755 })
      output.on("error", reject)
      output.on("finish", resolveRequest)
      response.pipe(output)
    })

    requestHandle.on("error", reject)
  })
}
