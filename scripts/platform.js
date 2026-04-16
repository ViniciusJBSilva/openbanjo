import { join } from "node:path"

const TARGETS = {
  "linux-x64": {
    assetName: "openbanjo-linux-x64.AppImage"
  }
}

export function getPlatformKey() {
  return `${process.platform}-${process.arch}`
}

export function getTarget() {
  return TARGETS[getPlatformKey()] ?? null
}

export function getVendorBinaryPath(root, target) {
  return join(root, "vendor", target.assetName)
}

export function unsupportedMessage() {
  return `OpenBanjo via npm currently supports Linux x64 only.

Current platform: ${process.platform} ${process.arch}

Download other builds from GitHub Releases when available:
  https://github.com/ViniciusJBSilva/openbanjo/releases
`
}
