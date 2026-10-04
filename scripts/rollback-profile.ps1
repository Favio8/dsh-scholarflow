<#
.SYNOPSIS
  ScholarFlow G0 回滚脚本：把 DSH profile 的控制文件还原到安装前的备份快照。

.DESCRIPTION
  仅做「从备份复制回原路径」，不删除任何文件。执行前会打印解析后的绝对路径供人工核对，
  并在复制前校验源文件存在、目标目录存在。

  这是 plugin_manager 卸载路径之外的兜底手段：当插件导致 profile 无法正常加载、
  连插件管理 UI 都打不开时使用。

.PARAMETER ProfileDir
  目标 profile 目录，例如 <USER_HOME>\.dsh\profiles\desktop

.PARAMETER BackupDir
  备份目录，例如 <USER_HOME>\.dsh\backups\g0-20261004-183500

.EXAMPLE
  .\scripts\rollback-profile.ps1 `
    -ProfileDir "<USER_HOME>\.dsh\profiles\desktop" `
    -BackupDir  "<USER_HOME>\.dsh\backups\g0-20261004-183500"
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ProfileDir,
  [Parameter(Mandatory = $true)][string]$BackupDir
)

$ErrorActionPreference = 'Stop'

$profile = (Resolve-Path -LiteralPath $ProfileDir).Path
$backup  = (Resolve-Path -LiteralPath $BackupDir).Path

Write-Host "profile : $profile"
Write-Host "backup  : $backup"

# 只还原备份中确实存在的文件；不做任何删除。
$restored = @()
foreach ($file in Get-ChildItem -LiteralPath $backup -File) {
  $target = Join-Path $profile $file.Name
  if (-not (Test-Path -LiteralPath $profile)) {
    throw "profile 目录不存在：$profile"
  }
  Copy-Item -LiteralPath $file.FullName -Destination $target -Force
  $restored += $target
  Write-Host "restored: $target"
}

if ($restored.Count -eq 0) {
  Write-Warning "备份目录中没有文件，未做任何改动：$backup"
}

Write-Host ''
Write-Host '下一步（按需执行）：'
Write-Host '  1) 在 profile 目录执行依赖重装： pnpm install'
Write-Host '  2) 重启 DSH，使 profile 组合重新加载。'
Write-Host '  3) 若只想移除单个插件，优先用插件管理界面 / plugin_manager 卸载，'
Write-Host '     本脚本是加载失败时的兜底路径。'
