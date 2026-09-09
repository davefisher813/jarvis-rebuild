# JARVIS delivery, small paste. The code travels as a file, not as text.
# Save jarvis-everything.bundle anywhere normal (Downloads, Desktop, or C:\jarvis-clean) first.
$ErrorActionPreference = "Stop"
cd C:\jarvis-clean
if (-not (Test-Path .git)) { Write-Host "WRONG FOLDER - no .git here. Stop." -ForegroundColor Red; exit 1 }
Remove-Item -Force .git\index.lock, .git\ORIG_HEAD.lock, .git\objects\maintenance.lock -ErrorAction SilentlyContinue

$name = "jarvis-everything.bundle"
$spots = @("$env:USERPROFILE\Downloads\$name", "$env:USERPROFILE\Desktop\$name", "C:\jarvis-clean\$name", "$env:USERPROFILE\$name")
$found = $spots | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $found) { $found = (Get-ChildItem -Path $env:USERPROFILE -Filter $name -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1).FullName }
if (-not $found) { Write-Host "CANNOT FIND $name - save it to your Downloads folder, then run this again." -ForegroundColor Red; exit 1 }
Write-Host "Using $found"

$sha = (Get-FileHash -Algorithm SHA256 $found).Hash
if ($sha -ne "A45AF3552DA81660696DA7C622396AA929DFC4B7FC2141CCA17D1AF9ED2B1447") { Write-Host "FILE IS NOT THE RIGHT ONE (or the download was cut short). Nothing was written - tell Claude: bundle checksum mismatch." -ForegroundColor Red; exit 1 }

git fetch origin
if ($LASTEXITCODE -ne 0) { Write-Host "FETCH FAILED - tell Claude: fetch failed." -ForegroundColor Red; exit 1 }
git reset --hard origin/main
if ($LASTEXITCODE -ne 0) { Write-Host "RESET FAILED - tell Claude: reset failed." -ForegroundColor Red; exit 1 }
$head = git rev-parse HEAD
if ($head -ne "e4367de2c6b37130557f8abd83e4550f3023f960") { Write-Host "ORIGIN HAS MOVED (head=$head) - not the expected base - tell Claude: origin moved, expected e4367de." -ForegroundColor Red; exit 1 }

git bundle verify $found
if ($LASTEXITCODE -ne 0) { Write-Host "BUNDLE VERIFY FAILED - tell Claude: bundle verify failed." -ForegroundColor Red; exit 1 }
git fetch $found HEAD
if ($LASTEXITCODE -ne 0) { Write-Host "BUNDLE FETCH FAILED - tell Claude: bundle fetch failed." -ForegroundColor Red; exit 1 }
$fh = git rev-parse FETCH_HEAD
if ($fh -ne "cd802bca2f8e6941262d96a1f637bbcfb2a44704") { Write-Host "BUNDLE CONTENTS UNEXPECTED (fetch_head=$fh) - tell Claude: bundle fetch_head mismatch." -ForegroundColor Red; exit 1 }

git merge --ff-only FETCH_HEAD
if ($LASTEXITCODE -ne 0) { git reset --hard origin/main; Write-Host "FAST-FORWARD FAILED - nothing was pushed - tell Claude: fast-forward merge failed." -ForegroundColor Red; exit 1 }
$final = git rev-parse 'HEAD^{tree}'
if ($final -ne "3db4b5a0839dadb6fc71a1adbe701b0dc3eedbfd") { git reset --hard origin/main; Write-Host "TREE MISMATCH - nothing was pushed - tell Claude: tree mismatch." -ForegroundColor Red; exit 1 }
$ahead = git rev-list --count "origin/main..HEAD"
if ($ahead -ne "312") { Write-Host "COMMITS DID NOT LAND (ahead=$ahead) - tell Claude: commits did not land." -ForegroundColor Red; exit 1 }

git push origin main
if ($LASTEXITCODE -ne 0) { Write-Host "PUSH FAILED - commit is local only, tell Claude before retrying - tell Claude: push failed." -ForegroundColor Red; exit 1 }
Write-Host ""
Write-Host "DONE - Everything landed: 267 catalog items plus 83 upgrades, 312 commits." -ForegroundColor Green
