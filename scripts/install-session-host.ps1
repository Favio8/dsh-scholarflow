param([Parameter(Mandatory=$true)][string]$Artifact, [string]$ProjectRoot = 'C:\Users\19949\Desktop\科技论文写作test1', [switch]$PrepareOnly)
$ErrorActionPreference='Stop'
$sfWorkspace=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$sfArtifact=(Resolve-Path -LiteralPath $Artifact).Path
$sfArtifactBoundary=[IO.Path]::GetFullPath((Join-Path $sfWorkspace '.dsh-tmp\session-host-build'))+[IO.Path]::DirectorySeparatorChar
if(-not $sfArtifact.StartsWith($sfArtifactBoundary,[StringComparison]::OrdinalIgnoreCase)){throw 'Artifact must be an isolated repair build.'}
$sfInstall=[IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness'))
$sfBackup=Join-Path $sfWorkspace ('.dsh-tmp\session-host-install-backups\'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $sfBackup -Force | Out-Null
if(Test-Path -LiteralPath (Join-Path $ProjectRoot '.scholarflow\drafts\editor-buffers')){
  $sfDirty=Get-ChildItem -LiteralPath (Join-Path $ProjectRoot '.scholarflow\drafts\editor-buffers') -Filter '*.json' | Where-Object {(Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json).state -eq 'dirty'}
  if($sfDirty){throw 'Save pending paper edits before installing the repair.'}
}
Copy-Item -LiteralPath (Join-Path $sfInstall 'resources\app.asar') -Destination (Join-Path $sfBackup 'app.asar')
Copy-Item -LiteralPath (Join-Path $sfInstall 'resources\app.asar.unpacked') -Destination (Join-Path $sfBackup 'app.asar.unpacked') -Recurse
Copy-Item -LiteralPath (Join-Path $sfInstall 'DeepSeek Harness.exe') -Destination (Join-Path $sfBackup 'DeepSeek Harness.exe')
if($PrepareOnly){[pscustomobject]@{Backup=$sfBackup;Prepared=$true}|ConvertTo-Json;exit 0}
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class ScholarFlowAppMenu {
  [DllImport("user32.dll")] public static extern IntPtr GetMenu(IntPtr window);
  [DllImport("user32.dll")] public static extern IntPtr GetSubMenu(IntPtr menu,int position);
  [DllImport("user32.dll")] public static extern int GetMenuItemCount(IntPtr menu);
  [DllImport("user32.dll")] public static extern uint GetMenuItemID(IntPtr menu,int position);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetMenuString(IntPtr menu,uint item,StringBuilder text,int max,uint flags);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window,uint message,IntPtr wParam,IntPtr lParam);
}
'@
function Find-ScholarFlowQuit([IntPtr]$sfMenu){
  for($sfPosition=0;$sfPosition -lt [ScholarFlowAppMenu]::GetMenuItemCount($sfMenu);$sfPosition++){
    $sfLabel=[Text.StringBuilder]::new(300)
    [void][ScholarFlowAppMenu]::GetMenuString($sfMenu,$sfPosition,$sfLabel,300,0x400)
    $sfCaption=$sfLabel.ToString().Split("`t")[0].Replace('&','').Trim()
    if($sfCaption -match '^(退出(?: DeepSeek Harness)?|Quit(?: DeepSeek Harness)?|Exit(?: DeepSeek Harness)?)$'){return [ScholarFlowAppMenu]::GetMenuItemID($sfMenu,$sfPosition)}
    $sfChild=[ScholarFlowAppMenu]::GetSubMenu($sfMenu,$sfPosition)
    if($sfChild -ne [IntPtr]::Zero){$sfFound=Find-ScholarFlowQuit $sfChild;if($null -ne $sfFound){return $sfFound}}
  }
}
$sfWindows=Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowHandle -ne [IntPtr]::Zero -and $_.Path -eq (Join-Path $sfInstall 'DeepSeek Harness.exe')}
foreach($sfWindow in $sfWindows){
  $sfQuit=Find-ScholarFlowQuit ([ScholarFlowAppMenu]::GetMenu($sfWindow.MainWindowHandle))
  if($null -eq $sfQuit){
    # Normal WM_CLOSE lets the app enforce its save/exit handling; never kill it.
    if(-not $sfWindow.CloseMainWindow()){throw 'Cannot request a normal window close; save and exit Harness normally, then rerun.'}
  }else{
    [void][ScholarFlowAppMenu]::PostMessage($sfWindow.MainWindowHandle,0x111,[IntPtr]([long]$sfQuit),[IntPtr]::Zero)
  }
}
$sfDeadline=(Get-Date).AddSeconds(20)
do{$sfRunning=Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue | Where-Object {$_.Path -eq (Join-Path $sfInstall 'DeepSeek Harness.exe')};if(-not $sfRunning){break};Start-Sleep -Milliseconds 250}while((Get-Date) -lt $sfDeadline)
if($sfRunning){throw 'Harness is still running; finish its save/exit dialog. No installation files were replaced.'}
$sfHome=Join-Path $env:USERPROFILE '.dsh'
foreach($sfDirectory in @('sessions','storages')){Copy-Item -LiteralPath (Join-Path $sfHome $sfDirectory) -Destination (Join-Path $sfBackup $sfDirectory) -Recurse}
Copy-Item -LiteralPath $ProjectRoot -Destination (Join-Path $sfBackup 'paper-project') -Recurse
$sfProfile=Join-Path $sfHome 'profiles\desktop'
New-Item -ItemType Directory -Path (Join-Path $sfBackup 'desktop-profile') -Force | Out-Null
Get-ChildItem -LiteralPath $sfProfile -File | Copy-Item -Destination (Join-Path $sfBackup 'desktop-profile')
$sfOriginalPaperHash=(Get-FileHash -LiteralPath (Join-Path $ProjectRoot 'manuscript-1\paper.md') -Algorithm SHA256).Hash
Copy-Item -LiteralPath (Join-Path $sfArtifact 'resources\app.asar.unpacked') -Destination (Join-Path $sfInstall 'resources') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $sfArtifact 'resources\app.asar') -Destination (Join-Path $sfInstall 'resources\app.asar') -Force
$sfArchiveHash=(Get-FileHash -LiteralPath (Join-Path $sfInstall 'resources\app.asar') -Algorithm SHA256).Hash
if($sfArchiveHash -ne (Get-FileHash -LiteralPath (Join-Path $sfArtifact 'resources\app.asar') -Algorithm SHA256).Hash){throw 'Installed archive hash does not match verified artifact; restore the retained backup.'}
if($sfOriginalPaperHash -ne (Get-FileHash -LiteralPath (Join-Path $ProjectRoot 'manuscript-1\paper.md') -Algorithm SHA256).Hash){throw 'Paper changed during installation; retained backup is available.'}
$sfRecord=[pscustomobject]@{Installed=$true;SessionFormat=5;Backup=$sfBackup;Install=$sfInstall;ArchiveSHA256=$sfArchiveHash;PaperSHA256=$sfOriginalPaperHash}
$sfRecord | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $sfBackup 'installation.json') -Encoding utf8
Start-Process -FilePath (Join-Path $sfInstall 'DeepSeek Harness.exe') -WindowStyle Hidden
$sfRecord | ConvertTo-Json
