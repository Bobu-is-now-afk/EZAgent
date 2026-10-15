#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT_DIR="${EZAGENT_OUTPUT_DIR:-$ROOT/outputs/phase2/macos-arm64}"
VERSION="${EZAGENT_DEV_VERSION:-0.2.0-dev.2}"
BUILD_NUMBER="${EZAGENT_BUILD_NUMBER:-20261015.2}"
NODE_BIN="$(node -p 'process.execPath')"
SDK_VERSION="$(xcrun --show-sdk-version)"
MACOS_VERSION="$(sw_vers -productVersion)"
NODE_VERSION="$(node --version)"
SOURCE_REVISION="$(git -C "$ROOT" rev-parse --verify HEAD)"
BUILD_ID="ezagent-${VERSION}-${SOURCE_REVISION}"
MINIMUM_MACOS_VERSION="$SDK_VERSION"

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-dev\.[0-9]+)?$ || ! "$BUILD_NUMBER" =~ ^[0-9]+(\.[0-9]+)*$ || ! "$MINIMUM_MACOS_VERSION" =~ ^[0-9]+\.[0-9]+(\.[0-9]+)?$ ]]; then
  echo "[ERROR] Version, build number, or minimum macOS version has an invalid format."
  exit 2
fi

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "[ERROR] Build this development app on an Apple silicon Mac."
  exit 2
fi
if [[ -e "$OUTPUT_DIR/EZAgent-$VERSION-macos-arm64.zip" || -e "$OUTPUT_DIR/EZAgent-$VERSION-macos-arm64.zip.sha256" ]]; then
  echo "[ERROR] Output already exists; choose another EZAGENT_DEV_VERSION or inspect the existing artifact."
  exit 2
fi
if [[ ! -x "$NODE_BIN" ]] || ! command -v corepack >/dev/null 2>&1; then
  echo "[ERROR] Node.js and Corepack with the pinned pnpm version are required on the build machine."
  exit 2
fi
PNPM_VERSION="$(COREPACK_ENABLE_NETWORK=0 corepack pnpm --version)"
if [[ "$PNPM_VERSION" != "12.3.4" ]]; then
  echo "[ERROR] Expected cached pnpm 12.3.4; found $PNPM_VERSION. No package manager was downloaded."
  exit 2
fi

BUILD_TMP="$(mktemp -d "$ROOT/.macos-build.XXXXXX")"
trap 'rm -rf "$BUILD_TMP"' EXIT
export SOURCE_DATE_EPOCH="$(git -C "$ROOT" show -s --format=%ct HEAD)"
export TZ=UTC
export LC_ALL=C
export COREPACK_ENABLE_NETWORK=0
SOURCE="$BUILD_TMP/source"
APP="$BUILD_TMP/payload/EZAgent-$VERSION.app"
RESOURCES="$APP/Contents/Resources"
mkdir -p "$SOURCE" "$RESOURCES/RuntimeTemplate" "$APP/Contents/MacOS" "$OUTPUT_DIR"

for item in app components lib public models.manifest.json next-env.d.ts package.json pnpm-lock.yaml pnpm-workspace.yaml postcss.config.mjs tsconfig.json components.json next.config.mjs proxy.ts; do
  if [[ -e "$ROOT/$item" ]]; then cp -R "$ROOT/$item" "$SOURCE/"; fi
done
mkdir -p "$SOURCE/scripts"
cp "$ROOT/scripts/bootstrap_ui.mjs" "$SOURCE/scripts/"
printf 'node-linker=hoisted\n' > "$SOURCE/.npmrc"
(cd "$SOURCE" && corepack pnpm install --offline --frozen-lockfile --ignore-scripts)
(cd "$SOURCE" && corepack pnpm exec tsc --noEmit)

# Build an isolated standalone output without changing the repository's Next config.
cat > "$SOURCE/next.config.mjs" <<'EOF'
const buildId = process.env.EZAGENT_BUILD_ID
if (!buildId) throw new Error('EZAGENT_BUILD_ID is required for a reproducible build')

const nextConfig = {
  typescript: { ignoreBuildErrors: true },
  images: { unoptimized: true },
  experimental: { proxyClientMaxBodySize: '1mb' },
  output: 'standalone',
  outputFileTracingRoot: process.cwd(),
  generateBuildId: async () => buildId,
}
export default nextConfig
EOF

(
  cd "$SOURCE"
  EZAGENT_BUILD_ID="$BUILD_ID" corepack pnpm exec next build --webpack
)
if [[ "$(cat "$SOURCE/.next/BUILD_ID")" != "$BUILD_ID" ]]; then
  echo "[ERROR] Next.js build ID did not match the source revision."
  exit 2
fi
if [[ ! -f "$SOURCE/.next/standalone/server.js" ]]; then
  echo "[ERROR] Next standalone output has no root server.js; refusing to package a broken app."
  exit 2
fi
cp -R "$SOURCE/.next/standalone/." "$RESOURCES/RuntimeTemplate/"
mkdir -p "$RESOURCES/RuntimeTemplate/.next/static"
cp -R "$SOURCE/.next/static/." "$RESOURCES/RuntimeTemplate/.next/static/"
if [[ -d "$SOURCE/public" ]]; then cp -R "$SOURCE/public" "$RESOURCES/RuntimeTemplate/"; fi
mkdir -p "$RESOURCES/RuntimeTemplate/scripts"
cp "$SOURCE/scripts/bootstrap_ui.mjs" "$RESOURCES/RuntimeTemplate/scripts/"
cp "$SOURCE/models.manifest.json" "$RESOURCES/RuntimeTemplate/"
cp "$NODE_BIN" "$RESOURCES/node"
cp "$(dirname "$NODE_BIN")/../LICENSE" "$RESOURCES/THIRD_PARTY_NOTICES_NODE.txt"
cat > "$RESOURCES/BUILD-INFO.txt" <<EOF
EZAgent macOS arm64 development build
Product version: $VERSION
Build number: $BUILD_NUMBER
Source commit: $SOURCE_REVISION
Build ID: $BUILD_ID
Build host macOS: $MACOS_VERSION
Build SDK: $SDK_VERSION
Node.js: $NODE_VERSION
pnpm: $PNPM_VERSION
Dependency preparation: offline, frozen lockfile, lifecycle scripts disabled
EOF

node - "$RESOURCES/RuntimeTemplate" <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const root = fs.realpathSync(process.argv[2])
if (!fs.existsSync(path.join(root, 'server.js'))) throw new Error('standalone root server.js missing')
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const pathname = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) {
      const resolved = fs.realpathSync(pathname)
      if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error(`external symlink in app bundle: ${pathname}`)
    } else if (entry.isDirectory()) walk(pathname)
  }
}
walk(root)
NODE

"$(xcrun --find swiftc)" -sdk "$(xcrun --show-sdk-path)" -parse-as-library -O \
  -framework AppKit -framework Foundation \
  "$ROOT/scripts/EZAgentApp.swift" -o "$APP/Contents/MacOS/EZAgent"

cat > "$APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>EZAgent</string>
<key>CFBundleIdentifier</key><string>com.cantonet.ezagent.development</string>
<key>CFBundleName</key><string>EZAgent development build</string>
<key>CFBundleDisplayName</key><string>EZAgent (Development)</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>$VERSION</string>
<key>CFBundleVersion</key><string>$BUILD_NUMBER</string>
<key>LSMinimumSystemVersion</key><string>$MINIMUM_MACOS_VERSION</string>
<key>NSHighResolutionCapable</key><true/>
<key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
</dict></plist>
EOF

cat > "$BUILD_TMP/payload/README-FIRST-RUN.txt" <<EOF
EZAgent $VERSION development build — macOS Apple silicon

This is a development preview with a local ad hoc signature. It is not signed by a developer identity or notarized. If macOS blocks the app, control-click it in Finder and choose Open. No terminal commands are required to start it.

Requirements: tested on macOS $MACOS_VERSION on Apple silicon; this build declares macOS $MINIMUM_MACOS_VERSION as its minimum. The default Qwen 3.5 9B model requires 16 GB RAM and 8 GB free model storage. The app includes its Node.js server runtime and does not require Python. Ollama must be installed separately from https://ollama.com/download/mac. EZAgent never installs Ollama or downloads a model silently. The explicit Prepare local AI button may download the selected allowlisted model. Download size depends on the selected model and Ollama's current model package.

First run: drag EZAgent-$VERSION.app to Applications and open it. EZAgent opens the Documents workbench at http://127.0.0.1:3210/documents. To use custom-description suggestions, install Ollama from its official installer, then use the explicit Prepare local AI button to start Ollama and, if needed, download the selected model. Failure keeps the workbench available and can be retried from Local AI setup. Structured orders and drafts do not need model setup. This build has not passed an all-interfaces-disconnected test; do not claim fully offline behavior.

The app server binds to 127.0.0.1:3210 and the Ollama endpoint is fixed to 127.0.0.1:11434. Model preparation contacts the local Ollama API; Ollama may contact its model registry when the user explicitly starts a download. Host-wide outbound attempts have not been independently measured.

Documents are stored at ~/Library/Application Support/CantoNet/EZAgent/Runtime/.ezagent/documents/. They persist across refresh and relaunch until you delete them. Clear synthetic data removes orders, drafts and sample records, preserves the sample-number sequence, and does not delete exported files from Downloads. Removing the app does not remove this data or Ollama models in ~/.ollama/models. Reinstalling the same app version preserves data. To remove all app data, quit EZAgent, remove the app, then remove the CantoNet/EZAgent Application Support folder; remove Ollama models separately through Ollama.

This preview was built on Apple silicon with existing project dependencies in offline/frozen mode. It has not been validated under a separate clean macOS account. Build inputs and source commit are listed in EZAgent-$VERSION.app/Contents/Resources/BUILD-INFO.txt. Rebuild with EZAGENT_DEV_VERSION=$VERSION EZAGENT_BUILD_NUMBER=$BUILD_NUMBER ./scripts/package_macos_dev.sh. The build host needs Node.js, Corepack with cached pnpm 12.3.4, Swift/Xcode Command Line Tools, and all locked packages available in its local pnpm store.
EOF
cp "$ROOT/docs/macos-first-run.svg" "$BUILD_TMP/payload/FIRST-RUN.svg"

touch -t 198001010000 "$APP/Contents/Info.plist" "$APP/Contents/MacOS/EZAgent"
codesign --force --deep --sign - --options runtime --timestamp=none "$APP"
find "$BUILD_TMP/payload" -exec touch -t 198001010000 {} +
ditto -c -k --sequesterRsrc --keepParent "$BUILD_TMP/payload" "$OUTPUT_DIR/EZAgent-$VERSION-macos-arm64.zip"
if ! "$NODE_BIN" - "$OUTPUT_DIR/EZAgent-$VERSION-macos-arm64.zip" "$VERSION" <<'NODE'
const { execFileSync } = require('node:child_process')
const archive = process.argv[2]
const version = process.argv[3]
const entries = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).split(/\r?\n/)
const expected = `payload/EZAgent-${version}.app/Contents/Resources/RuntimeTemplate/server.js`
if (!entries.includes(expected)) process.exit(1)
NODE
then
  echo "[ERROR] Final ZIP does not contain the runnable standalone server at its expected root."
  exit 2
fi
(cd "$OUTPUT_DIR" && shasum -a 256 "EZAgent-$VERSION-macos-arm64.zip" > "EZAgent-$VERSION-macos-arm64.zip.sha256")
echo "[OK] Development artifact: $OUTPUT_DIR/EZAgent-$VERSION-macos-arm64.zip"
echo "[OK] SHA-256: $OUTPUT_DIR/EZAgent-$VERSION-macos-arm64.zip.sha256"
