#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
host="${NUC_SSH_HOST:-nuc-kep}"
desktop_host_root="${DSH_DESKTOP_HOST_ROOT:-}"
if [[ -z "$desktop_host_root" ]]; then
  echo 'Set DSH_DESKTOP_HOST_ROOT to the already-built Windows desktop-host payload before running this workflow.' >&2
  exit 2
fi
if [[ ! -d "$desktop_host_root" ]]; then
  echo "DSH_DESKTOP_HOST_ROOT is not a directory: $desktop_host_root" >&2
  exit 2
fi
temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/dsh-rpgmaker-nuc-install.XXXXXX")"
archive="$temp_dir/DSH-RPGMaker-MV-from-mac.zip"
remote_archive='/mnt/c/Users/white/AppData/Local/Temp/DSH-RPGMaker-MV-from-mac.zip'

cleanup() {
  rm -rf "$temp_dir"
}
trap cleanup EXIT

cd "$root"
bun run release:zip -- "$archive" --desktop-host-root "$desktop_host_root"
scp "$archive" "$host:$remote_archive"
WINDOWS_SSH_HOST="$host" nuc-powershell dev/install-from-mac-to-nuc.ps1
