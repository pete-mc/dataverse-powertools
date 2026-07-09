<#
.SYNOPSIS
  One-time toolchain setup for running the Dataverse PowerTools e2e suites on a fresh
  Windows VM (VMware/Hyper-V/etc.), isolated from your main desktop.

.DESCRIPTION
  Installs Node, the .NET SDK, the .NET Framework 4.x developer pack (for the net462
  plugin build + XrmDefinitelyTyped), Git, the Power Platform CLI (pac), and the global
  npm build tools the webresource flow uses. Run from an elevated PowerShell:

      powershell -ExecutionPolicy Bypass -File scripts\setup-vm-e2e.ps1

  Then (NOT in this script — creds never live in the repo):
    1. Copy your gitignored sandbox\.env into the repo's sandbox\ folder.
    2. npm install
    3. npm run test:e2e        # literal-UI ExTester suite (needs the VM desktop visible)
       npm run test:live       # command-level lifecycle suites (headless, no desktop)

  Keep the VMware console window open and the VM logged in while test:e2e runs —
  Selenium drives the real VS Code window, so the desktop must be interactive.
#>
$ErrorActionPreference = "Stop"

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
  Write-Error "winget not found. Install 'App Installer' from the Microsoft Store, then re-run."
}

# All packages below live in the 'winget' community source. Pin to it with --source so
# winget never touches the 'msstore' source, which on a fresh VM often fails cert
# validation (0x8a15005e) — usually because the VM clock is wrong. If you still hit that
# error, fix the VM's date/time first (Settings > Time & Language > set automatically).
try { winget source update --name winget --accept-source-agreements | Out-Null } catch { }

function Install-WinGet($id) {
  Write-Host "== winget install $id =="
  winget install -e --id $id --source winget --accept-source-agreements --accept-package-agreements --silent
}

Install-WinGet "OpenJS.NodeJS.LTS"
Install-WinGet "Microsoft.DotNet.SDK.8"
Install-WinGet "Microsoft.DotNet.Framework.DeveloperPack_4"   # net462 targeting + 4.8 dev pack
Install-WinGet "Git.Git"
Install-WinGet "Microsoft.PowerAppsCLI"                        # pac (standalone; extension runs it via cmd.exe /c)

# Refresh PATH for this session so the following commands resolve.
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# The scaffolded webresource build shells out to a global `webpack`; the requirement
# scan also checks these globals.
Write-Host "== npm i -g webpack webpack-cli typescript jest =="
npm install -g webpack webpack-cli typescript jest

Write-Host ""
Write-Host "=== versions ==="
foreach ($c in @("node --version","npm --version","dotnet --version","git --version")) {
  try { Write-Host ("{0}: {1}" -f $c, (Invoke-Expression $c)) } catch { Write-Host ("{0}: MISSING (reopen a new shell so PATH refreshes)" -f $c) }
}
Write-Host ""
Write-Host "Done. Open a NEW terminal (so PATH refreshes), then: copy sandbox\.env, npm install, npm run test:e2e"
