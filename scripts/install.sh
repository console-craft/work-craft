#!/bin/sh
set -eu

bin_dir="${WORK_CRAFT_BIN_DIR:-"$HOME/.local/bin"}"

mkdir -p "$bin_dir"
install -m 755 dist/work-craft "$bin_dir/work-craft"

printf 'Installed work-craft to %s\n' "$bin_dir"

case ":$PATH:" in
  *":$bin_dir:"*) ;;
  *)
    printf 'Warning: %s is not on PATH.\n' "$bin_dir"
    printf 'Add %s to PATH in your shell configuration.\n' "$bin_dir"
    ;;
esac
