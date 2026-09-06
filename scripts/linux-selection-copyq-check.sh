#!/usr/bin/env bash
set -euo pipefail
before_clipboard=$(copyq config copy_clipboard)
before_selection=$(copyq config copy_selection)
restore() {
  copyq config copy_clipboard "$before_clipboard"
  copyq config copy_selection "$before_selection"
}
trap restore EXIT
copyq config copy_clipboard true
copyq config copy_selection true
printf 'CopyQ synchronization enabled in both directions for this test only.\n'
timeout 90 node_modules/electron/dist/electron scripts/linux-selection-integration.js "$@"
