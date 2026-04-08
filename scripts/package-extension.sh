#!/bin/sh

set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
BUILD_DIR="$ROOT_DIR/apps/extension/build/chrome-mv3-prod"
OUTPUT_DIR="$ROOT_DIR/apps/web/public/downloads"
OUTPUT_ZIP="$OUTPUT_DIR/tb-pdd-image-extension.zip"

npm run build --workspace @tb-pdd-image/extension

mkdir -p "$OUTPUT_DIR"
ditto -c -k --keepParent "$BUILD_DIR" "$OUTPUT_ZIP"

printf 'Packaged extension ZIP at %s\n' "$OUTPUT_ZIP"
