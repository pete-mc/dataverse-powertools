#!/usr/bin/env bash
#
# Provision a Linux box (Ubuntu/Debian) to run the e2e / UI / live suites.
# The Linux peer of setup-vm-e2e.ps1, which it replaces.
#
#   bash scripts/setup-linux-e2e.sh
#
# Then: copy your gitignored sandbox/.env in, `npm install`, `npm run test:e2e:headless`.
#
# WHY THIS IS BETTER THAN THE WINDOWS VM IT REPLACES
# --------------------------------------------------
# The e2e suite drives the real VS Code UI through Selenium, which types into whatever window has
# focus — so on a shared desktop a stray keystroke lands in the wrong field and corrupts the run
# (a client id in the URL box, etc.). On Windows the only fix was a dedicated VM nobody else
# touched. On Linux, `xvfb-run` gives the run its own X display: same isolation, no VM, and you can
# keep working on your desktop while it runs. That is what `npm run test:e2e:headless` does.
#
# Everything installed here is a genuine runtime need, not a convenience:
#   unzip          ExTester shells out to it to unpack ChromeDriver. Without it the run dies with
#                  "/bin/sh: 1: unzip: not found" before a single test executes.
#   xvfb           the isolated X display described above.
#   libnss3 &c.    Electron's shared-library dependencies; VS Code won't start without them.
#   microsoft-edge the browser the "Debug Web Resources" and PCF live-form flows drive under CDP.
#                  src/webresources/debug/browserResolver.ts already probes the Linux paths this
#                  package installs; Chrome/Chromium work too if you prefer one of those.
#   dotnet 8       builds the plug-in projects (net462 AND net8.0 — see #269) and runs the
#                  cross-platform typings tool.
#   pac            Power Platform CLI. NOTE it needs .NET 10 to INSTALL (the nupkg ships only
#                  tools/net10.0/any/), even though the extension only ever shells out to it.
#
# NOT installed, deliberately: webpack / webpack-cli / jest / typescript. They are per-project
# local devDependencies and the extension runs them through `npx`; a global install masks a broken
# project scaffold. And no mono — since #269 the scaffolded test project targets net8.0, so
# `dotnet test` (and so plug-in replay) no longer needs a .NET Framework test host.

set -euo pipefail

log() { printf '\n== %s ==\n' "$1"; }

if ! command -v apt-get >/dev/null 2>&1; then
  echo "This script targets Debian/Ubuntu (apt). On another distro, install the equivalents of:" >&2
  echo "  unzip xvfb libnss3 libgbm1 libasound2 libsecret-1-0 dotnet-sdk-8.0 nodejs, plus Edge or Chrome." >&2
  exit 1
fi

log "apt: base tooling + Electron runtime libraries"
sudo apt-get update -y
# libasound2t64 is the Ubuntu 24.04+ name; libasound2 on older releases. Try the new one, fall back.
sudo apt-get install -y \
  unzip curl ca-certificates gnupg git xvfb \
  libnss3 libgbm1 libsecret-1-0 libatk-bridge2.0-0 libatk1.0-0 libcups2 libdrm2 libxkbcommon0 \
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libpango-1.0-0 libcairo2
sudo apt-get install -y libasound2t64 || sudo apt-get install -y libasound2

if ! command -v node >/dev/null 2>&1; then
  log "apt: Node.js"
  sudo apt-get install -y nodejs npm
fi

if ! command -v dotnet >/dev/null 2>&1; then
  log "apt: .NET SDK 8"
  sudo apt-get install -y dotnet-sdk-8.0
fi

if ! command -v microsoft-edge >/dev/null 2>&1 && ! command -v google-chrome >/dev/null 2>&1 && ! command -v chromium >/dev/null 2>&1; then
  log "Microsoft Edge (for the browser-driven debug flows)"
  curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | sudo gpg --dearmor -o /usr/share/keyrings/microsoft.gpg
  echo "deb [arch=amd64 signed-by=/usr/share/keyrings/microsoft.gpg] https://packages.microsoft.com/repos/edge stable main" |
    sudo tee /etc/apt/sources.list.d/microsoft-edge.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y microsoft-edge-stable
fi

if ! command -v pac >/dev/null 2>&1; then
  log "Power Platform CLI (pac)"
  # pac's nupkg ships only tools/net10.0/any/, so installing it against an SDK 8-only machine fails
  # with "DotnetToolSettings.xml was not found". Install .NET 10 alongside 8 rather than replacing it.
  if ! dotnet --list-sdks | grep -q '^10\.'; then
    sudo apt-get install -y dotnet-sdk-10.0 || {
      echo "Could not install .NET SDK 10 from apt; see https://learn.microsoft.com/dotnet/core/install/linux" >&2
      exit 1
    }
  fi
  dotnet tool install --global Microsoft.PowerApps.CLI.Tool
  echo 'Add ~/.dotnet/tools to PATH (e.g. in ~/.bashrc): export PATH="$PATH:$HOME/.dotnet/tools"'
  export PATH="$PATH:$HOME/.dotnet/tools"
fi

log "versions"
for cmd in node npm dotnet pac unzip xvfb-run; do
  if command -v "$cmd" >/dev/null 2>&1; then
    printf '%-10s %s\n' "$cmd" "$("$cmd" --version 2>&1 | head -1)"
  else
    printf '%-10s MISSING (open a new shell so PATH refreshes, then re-check)\n' "$cmd"
  fi
done
for browser in microsoft-edge google-chrome chromium; do
  command -v "$browser" >/dev/null 2>&1 && printf '%-10s %s\n' "$browser" "$("$browser" --version 2>&1 | head -1)" && break
done

cat <<'EOF'

Done. Next:
  1. Copy your gitignored sandbox/.env into the repo (never commit it). For the interactive
     suites also set DVPT_TEST_USERNAME / DVPT_TEST_PASSWORD to an MFA-exempt test user.
  2. npm install
  3. npm run test:e2e:headless     # isolated X display via xvfb — safe to run on a working desktop

Suites self-skip without sandbox/.env, so a credential-free box still gets a useful signal.
EOF
