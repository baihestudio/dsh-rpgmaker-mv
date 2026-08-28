#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
host="${NUC_SSH_HOST:-nuc-kep}"
temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/dsh-rpgmaker-nuc-install.XXXXXX")"
archive="$temp_dir/DSH-RPGMaker-MV-from-mac.zip"
remote_archive='/mnt/c/Users/white/AppData/Local/Temp/DSH-RPGMaker-MV-from-mac.zip'

cleanup() {
  rm -rf "$temp_dir"
}
trap cleanup EXIT

cd "$root"
bun run release:zip -- "$archive"
scp "$archive" "$host:$remote_archive"
WINDOWS_SSH_HOST="$host" nuc-powershell dev/install-from-mac-to-nuc.ps1
