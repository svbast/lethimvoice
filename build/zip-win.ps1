# Zip each Windows release artifact next to the bare .exe. Chrome's download
# filter hard-blocks unsigned executables (dangerous-type class for the client
# OS); archives fall into a milder class and download normally. Run-time
# SmartScreen is unaffected: only a code-signing certificate removes that warning.
$release = Join-Path $PSScriptRoot '..\release'
Get-ChildItem $release -Filter '*.exe' -File | ForEach-Object {
  $zip = $_.FullName -replace '\.exe$', '.zip'
  Compress-Archive -Force -Path $_.FullName -DestinationPath $zip
  Write-Host "  - zipped: $(Split-Path $zip -Leaf)"
}
