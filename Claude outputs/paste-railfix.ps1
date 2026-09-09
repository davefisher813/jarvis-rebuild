# JARVIS delivery, small paste. The code travels as a file, not as text.
# Save jarvis-railfix.bundle anywhere normal (Downloads, Desktop, or C:\jarvis-clean) first.
$ErrorActionPreference = "Stop"
cd C:\jarvis-clean
if (-not (Test-Path .git)) { Write-Host "WRONG FOLDER - no .git here. Stop." -ForegroundColor Red; exit 1 }
Remove-Item -Force .git\index.lock, .git\ORIG_HEAD.lock, .git\objects\maintenance.lock -ErrorAction SilentlyContinue

$name = "jarvis-railfix.bundle"
$spots = @("$env:USERPROFILE\Downloads\$name", "$env:USERPROFILE\Desktop\$name", "C:\jarvis-clean\$name", "$env:USERPROFILE\$name")
$found = $spots | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $found) { $found = (Get-ChildItem -Path $env:USERPROFILE -Filter $name -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1).FullName }
if (-not $found) { Write-Host "CANNOT FIND $name - save it to your Downloads folder, then run this again." -ForegroundColor Red; exit 1 }
Write-Host "Using $found"

$sha = (Get-FileHash -Algorithm SHA256 $found).Hash
if ($sha -ne "0E4A8AA286266BF09D492247F439CE4246424B642CAA38A2529219D36AE2A5BC") { Write-Host "FILE IS NOT THE RIGHT ONE (or the download was cut short). Nothing was written - tell Claude: bundle checksum mismatch." -ForegroundColor Red; exit 1 }

git fetch origin
if ($LASTEXITCODE -ne 0) { Write-Host "FETCH FAILED - tell Claude: fetch failed." -ForegroundColor Red; exit 1 }
git reset --hard origin/main
if ($LASTEXITCODE -ne 0) { Write-Host "RESET FAILED - tell Claude: reset failed." -ForegroundColor Red; exit 1 }
$head = git rev-parse HEAD
if ($head -ne "cd802bca2f8e6941262d96a1f637bbcfb2a44704") { Write-Host "ORIGIN HAS MOVED (head=$head) - not the expected base - tell Claude: origin moved, expected cd802bc." -ForegroundColor Red; exit 1 }

git bundle verify $found
if ($LASTEXITCODE -ne 0) { Write-Host "BUNDLE VERIFY FAILED - tell Claude: bundle verify failed." -ForegroundColor Red; exit 1 }
git fetch $found HEAD
if ($LASTEXITCODE -ne 0) { Write-Host "BUNDLE FETCH FAILED - tell Claude: bundle fetch failed." -ForegroundColor Red; exit 1 }
$fh = git rev-parse FETCH_HEAD
if ($fh -ne "421a3befbecef6c766db5c2a73ad4837cca49309") { Write-Host "BUNDLE CONTENTS UNEXPECTED (fetch_head=$fh) - tell Claude: bundle fetch_head mismatch." -ForegroundColor Red; exit 1 }

git merge --ff-only FETCH_HEAD
if ($LASTEXITCODE -ne 0) { git reset --hard origin/main; Write-Host "FAST-FORWARD FAILED - nothing was pushed - tell Claude: fast-forward merge failed." -ForegroundColor Red; exit 1 }
$final = git rev-parse 'HEAD^{tree}'
if ($final -ne "91f6e82fc37cc62c172075e0ce3cda7e1dc476dc") { git reset --hard origin/main; Write-Host "TREE MISMATCH - nothing was pushed - tell Claude: tree mismatch." -ForegroundColor Red; exit 1 }
$ahead = git rev-list --count "origin/main..HEAD"
if ($ahead -ne "1") { Write-Host "COMMITS DID NOT LAND (ahead=$ahead) - tell Claude: commits did not land." -ForegroundColor Red; exit 1 }

git push origin main
if ($LASTEXITCODE -ne 0) { Write-Host "PUSH FAILED - commit is local only, tell Claude before retrying - tell Claude: push failed." -ForegroundColor Red; exit 1 }
Write-Host ""
Write-Host "DONE - The green rail is gone. Vercel will rebuild in a minute or two." -ForegroundColor Green
