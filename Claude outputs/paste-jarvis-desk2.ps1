# JARVIS delivery. Three commits: Auto-Sweep line, At a Desk, and the
# Plan My Day context-assembly fix.
# Save jarvis-desk2.bundle anywhere normal (Downloads, Desktop, or C:\jarvis-clean) first.
$ErrorActionPreference = "Stop"
cd C:\jarvis-clean
if (-not (Test-Path .git)) { Write-Host "WRONG FOLDER - no .git here. Stop." -ForegroundColor Red; exit 1 }
Remove-Item -Force .git\index.lock, .git\ORIG_HEAD.lock, .git\objects\maintenance.lock -ErrorAction SilentlyContinue

$name = "jarvis-desk2.bundle"
$spots = @("$env:USERPROFILE\Downloads\$name", "$env:USERPROFILE\Desktop\$name", "C:\jarvis-clean\$name", "$env:USERPROFILE\$name")
$found = $spots | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $found) { $found = (Get-ChildItem -Path $env:USERPROFILE -Filter $name -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1).FullName }
if (-not $found) { Write-Host "CANNOT FIND $name - save it to your Downloads folder, then run this again." -ForegroundColor Red; exit 1 }
Write-Host "Using $found"

$sha = (Get-FileHash -Algorithm SHA256 $found).Hash
if ($sha -ne "709BAF843E47DDF1C414CE84952C16EF85F0CE6F49F2D3C7FFAB7D04FB32F053") { Write-Host "FILE IS NOT THE RIGHT ONE (or the download was cut short). Nothing was written - tell Claude: bundle checksum mismatch." -ForegroundColor Red; exit 1 }

git fetch origin
if ($LASTEXITCODE -ne 0) { Write-Host "FETCH FAILED - tell Claude: fetch failed." -ForegroundColor Red; exit 1 }
git reset --hard origin/main
if ($LASTEXITCODE -ne 0) { Write-Host "RESET FAILED - tell Claude: reset failed." -ForegroundColor Red; exit 1 }
$head = git rev-parse HEAD
if ($head -ne "7a1a06727cfc8b3b7eaca24ea84516f4b613d9c3") { Write-Host "ORIGIN HAS MOVED (head=$head) - not the expected base - tell Claude: origin moved, expected 7a1a067." -ForegroundColor Red; exit 1 }

git bundle verify $found
if ($LASTEXITCODE -ne 0) { Write-Host "BUNDLE VERIFY FAILED - tell Claude: bundle verify failed." -ForegroundColor Red; exit 1 }
git fetch $found HEAD
if ($LASTEXITCODE -ne 0) { Write-Host "BUNDLE FETCH FAILED - tell Claude: bundle fetch failed." -ForegroundColor Red; exit 1 }
$fh = git rev-parse FETCH_HEAD
if ($fh -ne "430d5d492a85a332aeeda7ed6f02b41eedb5407a") { Write-Host "BUNDLE CONTENTS UNEXPECTED (fetch_head=$fh) - tell Claude: bundle fetch_head mismatch." -ForegroundColor Red; exit 1 }

git merge --ff-only FETCH_HEAD
if ($LASTEXITCODE -ne 0) { git reset --hard origin/main; Write-Host "FAST-FORWARD FAILED - nothing was pushed - tell Claude: fast-forward merge failed." -ForegroundColor Red; exit 1 }
$final = git rev-parse 'HEAD^{tree}'
if ($final -ne "515c9d915be79a488ed65d0851efa02003666eb6") { git reset --hard origin/main; Write-Host "TREE MISMATCH - nothing was pushed - tell Claude: tree mismatch." -ForegroundColor Red; exit 1 }
$ahead = git rev-list --count "origin/main..HEAD"
if ($ahead -ne "3") { Write-Host "COMMITS DID NOT LAND (ahead=$ahead) - tell Claude: commits did not land." -ForegroundColor Red; exit 1 }

git push origin main
if ($LASTEXITCODE -ne 0) { Write-Host "PUSH FAILED - commits are local only, tell Claude before retrying - tell Claude: push failed." -ForegroundColor Red; exit 1 }
Write-Host ""
Write-Host "DONE - Auto-Sweep line gone, At a Desk shipped, Plan My Day failure path fixed." -ForegroundColor Green
