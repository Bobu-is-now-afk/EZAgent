#!/bin/sh
# Uses installed dependencies only. No engine/model installation or download.
set -eu
cd "$(dirname "$0")/.."
python3 -m unittest discover -s tests/local-ai -p '*_test.py'
node_modules/.bin/tsc --noEmit --noUnusedLocals --noUnusedParameters
check_root=$(mktemp -d "${TMPDIR:-/tmp}/ezagent-check.XXXXXX")
node_modules/.bin/tsc --noEmit false --incremental false --strict --skipLibCheck \
  --resolveJsonModule --target ES2022 --module commonjs --moduleResolution node \
  --esModuleInterop --outDir "$check_root" tests/agent/*.test.ts \
  tests/local-ai/*.test.ts tests/yolanda-review/*.test.ts
NODE_PATH="$PWD/node_modules" node --test "$check_root"/tests/agent/*.test.js \
  "$check_root"/tests/local-ai/*.test.js "$check_root"/tests/yolanda-review/*.test.js
git diff --check
