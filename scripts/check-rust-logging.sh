#!/usr/bin/env bash
# Fails when app code prints instead of logging.
#
# Linty's backend logs through the `log` crate (src-tauri/src/logging.rs) so
# output reaches the local log file and follows the redaction rule: never log
# transcript text, clipboard contents, API keys or dictionary words.
# build.rs and examples/ are exempt; they are not part of the app.
set -euo pipefail

cd "$(dirname "$0")/.."

pattern='\b(e?print(ln)?|dbg)!\s*\('
if matches=$(grep -rnE "$pattern" src-tauri/src --include='*.rs'); then
  echo "Use log::{error,warn,info,debug}! instead of print macros:"
  echo "$matches"
  exit 1
fi
echo "No print macros in src-tauri/src."
