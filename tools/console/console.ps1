<#
  Drives a real Windows console running Claude Code with this repository's plugin, so the
  terminal UI can be read back and used without looking at the window. See README.md.

    console.ps1 launch -Dir C:\some\trusted\folder [-Cols 150] [-Lines 48] [-Font 'Cascadia Mono' [-FontSize 16]]
                       [-Claude '<command>'] [-Also <plugin folder>, ...]
    console.ps1 read [-Attrs]
    console.ps1 send -Spec 'text:/cr|enter'
    console.ps1 capture -Out shot.png [-Cells 'col,row,width,height']
    console.ps1 kill
#>
param(
  [Parameter(Mandatory = $true)][ValidateSet('launch', 'read', 'send', 'capture', 'kill')][string]$Action,
  [string]$Dir = '',
  [int]$Cols = 150,
  [int]$Lines = 48,
  [string]$Spec = '',
  [string]$Out = '',
  [string]$Cells = '',
  [switch]$Attrs,
  [switch]$Whole,
  [int]$TargetPid = 0,
  [string]$Claude = 'claude',
  [string[]]$Also = @(),
  [string]$Font = '',
  [int]$FontSize = 16
)
$ErrorActionPreference = 'Stop'
# The screen is box drawing and glyphs: hand it on as UTF-8, not the console code page.
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidFile = Join-Path $env:TEMP 'control-room-console.pid'
$screenFile = Join-Path $env:TEMP 'control-room-screen.txt'
Add-Type -Path (Join-Path $here 'ConDrive.cs') -ReferencedAssemblies System.Drawing

if ($Action -eq 'launch') {
  if ($Dir -eq '' -or -not (Test-Path $Dir)) { throw 'launch needs -Dir: an existing folder Claude Code already trusts (a trust dialog would wait for you).' }
  $plugin = (Resolve-Path (Join-Path $here '..\..\plugins\control-room')).Path
  # Started from inside a Claude Code session, the child would inherit that session's wiring (its
  # API proxy, so it reads "Not logged in") and NO_COLOR (so it draws in monochrome). Start clean.
  foreach ($n in @(Get-ChildItem env: | Where-Object { $_.Name -match '^(CLAUDE|ANTHROPIC)|^NO_COLOR$' } | ForEach-Object { $_.Name })) {
    [Environment]::SetEnvironmentVariable($n, $null, 'Process')
  }
  # Size the console before Claude Code starts: once it holds the alternate screen it cannot be resized.
  $p = Start-Process -FilePath 'conhost.exe' -ArgumentList @('cmd.exe', '/k', "mode con: cols=$Cols lines=$Lines") -WorkingDirectory $Dir -PassThru
  Start-Sleep -Milliseconds 1200
  $cmd = Get-CimInstance Win32_Process -Filter "ParentProcessId=$($p.Id) and Name='cmd.exe'" | Select-Object -First 1
  if ($null -eq $cmd) { throw "no cmd.exe under conhost $($p.Id)" }
  if ($Font -ne '') { [ConDrive]::Font([uint32]$cmd.ProcessId, $Font, [int16]$FontSize) }
  # Control Room loads first; -Also folders (the demo driver) load after it, so their hooks sit beneath its own.
  $extra = ($Also | ForEach-Object { " --plugin-dir `"$((Resolve-Path $_).Path)`"" }) -join ''
  [ConDrive]::Send([uint32]$cmd.ProcessId, "text:$Claude --plugin-dir `"$plugin`"$extra|enter")
  Set-Content -Path $pidFile -Value $cmd.ProcessId -Encoding ascii
  "console $($cmd.ProcessId): $Cols x $Lines in $Dir"
  exit 0
}

if ($TargetPid -eq 0) {
  if (-not (Test-Path $pidFile)) { throw 'no console launched; pass -TargetPid' }
  $TargetPid = [int](Get-Content $pidFile)
}

switch ($Action) {
  'read' {
    # Written to a file first: attaching to the other console detaches this process from its own.
    $text = [ConDrive]::Read([uint32]$TargetPid, [bool]$Attrs, [bool]$Whole)
    [System.IO.File]::WriteAllText($screenFile, $text, (New-Object System.Text.UTF8Encoding $false))
    Get-Content -Path $screenFile -Encoding UTF8
  }
  'send' { [ConDrive]::Send([uint32]$TargetPid, $Spec) }
  'capture' {
    if ($Out -eq '') { throw 'capture needs -Out: the PNG to write' }
    [ConDrive]::Capture([uint32]$TargetPid, [System.IO.Path]::GetFullPath($Out), $Cells)
  }
  'kill' {
    Get-CimInstance Win32_Process -Filter "ParentProcessId=$TargetPid" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Stop-Process -Id $TargetPid -Force -ErrorAction SilentlyContinue
    Remove-Item $pidFile -ErrorAction SilentlyContinue
    'stopped'
  }
}
