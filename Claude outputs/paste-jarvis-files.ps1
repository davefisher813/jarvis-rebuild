# JARVIS delivery, FILE FOLDER version. Everything since your last landed push,
# as plain files instead of a git bundle.
#
# Save jarvis-files.zip somewhere normal (Downloads, Desktop, or C:\jarvis-clean)
# first, then run this. You do NOT need to unzip it yourself.
#
# This lands all 10 commits' worth of code as ONE commit. The code is identical
# (verified by tree hash below); only the history granularity differs.

$ErrorActionPreference = "Stop"
cd C:\jarvis-clean
if (-not (Test-Path .git)) { Write-Host "WRONG FOLDER - no .git here. Stop." -ForegroundColor Red; exit 1 }
Remove-Item -Force .git\index.lock, .git\ORIG_HEAD.lock, .git\objects\maintenance.lock -ErrorAction SilentlyContinue

$name = "jarvis-files.zip"
$spots = @("$env:USERPROFILE\Downloads\$name", "$env:USERPROFILE\Desktop\$name", "C:\jarvis-clean\$name", "$env:USERPROFILE\$name")
$found = $spots | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $found) { $found = (Get-ChildItem -Path $env:USERPROFILE -Filter $name -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1).FullName }
if (-not $found) { Write-Host "CANNOT FIND $name - save it to your Downloads folder, then run this again." -ForegroundColor Red; exit 1 }
Write-Host "Using $found"

$sha = (Get-FileHash -Algorithm SHA256 $found).Hash
if ($sha -ne "1D301F9F1036ECFA640D55E70DD9B2AC8F692024485CC79381CCAF5F55A15753") { Write-Host "ZIP IS NOT THE RIGHT ONE (or the download was cut short). Nothing was written - tell Claude: zip checksum mismatch." -ForegroundColor Red; exit 1 }

# Unpack to a scratch folder, never into the repo.
$stage = Join-Path $env:TEMP ("jarvis-files-" + [guid]::NewGuid().ToString("N").Substring(0,8))
New-Item -ItemType Directory -Path $stage -Force | Out-Null
Expand-Archive -Path $found -DestinationPath $stage -Force
$src = Join-Path $stage "jarvis-files"
if (-not (Test-Path $src)) { Write-Host "ZIP LAYOUT UNEXPECTED - tell Claude: zip layout wrong." -ForegroundColor Red; exit 1 }

# Every file checked against the manifest before anything is copied.
$manifest = Join-Path $src "MANIFEST.sha256"
if (-not (Test-Path $manifest)) { Write-Host "NO MANIFEST IN ZIP - tell Claude: manifest missing." -ForegroundColor Red; exit 1 }
$rows = Get-Content $manifest | Where-Object { $_.Trim() -ne "" }
if ($rows.Count -ne 27) { Write-Host "MANIFEST HAS $($rows.Count) ROWS, EXPECTED 27 - tell Claude: manifest row count wrong." -ForegroundColor Red; exit 1 }
foreach ($row in $rows) {
  $want = $row.Substring(0, 64).ToUpper()
  $rel  = $row.Substring(66).Trim()
  $file = Join-Path $src $rel
  if (-not (Test-Path $file)) { Write-Host "MISSING FROM ZIP: $rel - tell Claude: file missing from zip." -ForegroundColor Red; exit 1 }
  $got = (Get-FileHash -Algorithm SHA256 $file).Hash
  if ($got -ne $want) { Write-Host "CHECKSUM MISMATCH: $rel - nothing was written - tell Claude: file checksum mismatch." -ForegroundColor Red; exit 1 }
}
Write-Host "All 27 files verified."

git fetch origin
if ($LASTEXITCODE -ne 0) { Write-Host "FETCH FAILED - tell Claude: fetch failed." -ForegroundColor Red; exit 1 }
git reset --hard origin/main
if ($LASTEXITCODE -ne 0) { Write-Host "RESET FAILED - tell Claude: reset failed." -ForegroundColor Red; exit 1 }
$head = git rev-parse HEAD
if ($head -ne "82d01148b36d75b586c135aabbeb76c4a5736776") { Write-Host "ORIGIN HAS MOVED (head=$head) - not the expected base - tell Claude: origin moved, expected 82d0114." -ForegroundColor Red; exit 1 }

# The two files that do not exist at the base yet. Named so a rollback can
# remove them; nothing else of yours is ever touched.
$newFiles = @("jarvis-app/src/shared/StepCount.tsx", "jarvis-app/src/tasks/grouping.test.ts")
function Rollback {
  git reset --hard origin/main | Out-Null
  foreach ($n in $newFiles) { Remove-Item -Force (Join-Path "C:\jarvis-clean" $n) -ErrorAction SilentlyContinue }
}

# Copy the files in. Repo-relative paths, straight overlay, no deletions.
foreach ($row in $rows) {
  $rel = $row.Substring(66).Trim()
  $dst = Join-Path "C:\jarvis-clean" $rel
  $dir = Split-Path $dst -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  Copy-Item -Path (Join-Path $src $rel) -Destination $dst -Force
}

# Only the 27 delivered paths are staged, so anything else sitting untracked
# in your working folder stays out of this commit entirely.
foreach ($row in $rows) {
  $rel = $row.Substring(66).Trim()
  git add -- $rel
  if ($LASTEXITCODE -ne 0) { Rollback; Write-Host "ADD FAILED on $rel - nothing was pushed - tell Claude: add failed." -ForegroundColor Red; exit 1 }
}

# The strong check: the staged tree must be byte-identical to the tree Claude
# built and tested. If this passes, the code is exactly right.
$tree = git write-tree
if ($tree -ne "6ff17b1588a9499c6da488cc8d9ec72c266f1b98") { Rollback; Write-Host "TREE MISMATCH (tree=$tree) - nothing was pushed - tell Claude: tree mismatch." -ForegroundColor Red; exit 1 }
Write-Host "Tree verified: matches the tested build exactly."

$msg = @"
Ten fixes: brain patterns, task trace, notice receipts, goals tap, protect lines, voice doors, linked notes, Plan My Day brain, recurring overdue

Squashed delivery of the ten commits below (file-overlay delivery; the tree
is byte-identical to the tested build, 6ff17b1):

  adf60fe BRAIN-NOPAT-01: JARVIS can say your work spreads across the whole day
  6253cdf BRAIN-NOPAT-02: JARVIS can say that everything slips, not one area
  fef3355 TRACE-02b: a task you have already started says where you are in it, not "Start"
  098dd09 The card that asks you to accept a fact shows the fact, and its receipt
  63d45db The Health page's Goals Here card opens the goal it names
  f67a63c A Protect line on an area holds the day's re-flow again
  e7ac80e Three more MessageDraftSheet doors draft in his voice, not nobody's
  9824b70 A scoped AI prompt can finally see a linked note
  180e302 Plan My Day from Today carries the same brain Schedule's does
  2e7f0a3 Fix: only daily recurring tasks are exempt from going overdue

Gates on the final tree: tsc clean, eslint 0 errors, full vitest suite
424 files / 5014 passed / 5 skipped, DEMO and CLEAN builds green.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Erbxkzd464Jok9qF667D9R
"@
git commit -m $msg
if ($LASTEXITCODE -ne 0) { Rollback; Write-Host "COMMIT FAILED - nothing was pushed - tell Claude: commit failed." -ForegroundColor Red; exit 1 }

$ahead = git rev-list --count "origin/main..HEAD"
if ($ahead -ne "1") { Write-Host "COMMIT DID NOT LAND (ahead=$ahead) - tell Claude: commit did not land." -ForegroundColor Red; exit 1 }

git push origin main
if ($LASTEXITCODE -ne 0) { Write-Host "PUSH FAILED - commit is local only, tell Claude before retrying - tell Claude: push failed." -ForegroundColor Red; exit 1 }

Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
Write-Host ""
Write-Host "DONE - all 10 fixes landed and pushed as one commit." -ForegroundColor Green
