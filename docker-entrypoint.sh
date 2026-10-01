#!/bin/sh
set -eu
mkdir -p "$FILES_DIR" "$TMP_DIR"
exec "$@"
