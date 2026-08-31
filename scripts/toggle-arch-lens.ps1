<#
.SYNOPSIS
  Arch Lens 启用/停用开关：见 scripts/scripts.md（作用、用法、生效方式）。
  arch-lens 相关条目只追加/变更，其余配置一概不碰。
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateSet('on', 'off')][string]$Mode,
  [string]$PatchFile = ''
)

$ErrorActionPreference = 'Stop'

# 目标文件是 DSH 的用户补丁层，位置随平台/环境走：DSH_HOME > USERPROFILE > HOME
# （Windows / macOS / Linux 的 ~/.dsh 均为 profiles/web/cordis.patch.yml）。
if ($PatchFile -eq '') {
  $dshHome = if ($env:DSH_HOME -ne '' -and $null -ne $env:DSH_HOME) { $env:DSH_HOME }
    elseif ($env:USERPROFILE) { Join-Path $env:USERPROFILE '.dsh' }
    else { Join-Path $env:HOME '.dsh' }
  $PatchFile = Join-Path $dshHome 'profiles\web\cordis.patch.yml'
}

# 开关段标记（脚本专属，勿手改）
$BLOCK_START = '# >>>>>> arch-lens 开关段（toggle-arch-lens.ps1 管理，勿手改）>>>>>>'
$BLOCK_END   = '# <<<<<< arch-lens 开关段 <<<<<<'

$ARCH_LENS_IDS = @(
  'arch-lens-backend-local',
  'ui-arch-lens-local',
  'code-index-tree-sitter-local'
)

$INSERT_ROWS = @(
  '  - id: arch-lens-backend-local',
  '    # 用相对路径而非裸包名：dsh 从源码启动（tsx）时，裸 @deepseek-ai 包名会被 harness 的 tsconfig paths 解析劫走。',
  "    name: './node_modules/@deepseek-ai/dsh-arch-lens-backend/lib/index.js'",
  '  - id: ui-arch-lens-local',
  "    name: '@deepseek-ai/dsh-client-arch-lens'",
  '  - id: code-index-tree-sitter-local',
  '    # 代码索引后端：harness 内建版只认识 packages/<组>/<包> 两级目录，本地构建带扁平布局修复。',
  "    name: './node_modules/@deepseek-ai/dsh-code-index-tree-sitter/lib/index.js'"
)

$TYPERT_LOADER_ROW = @(
  '- id: typert-loader',
  '  config:',
  '    packages:',
  "      - '@deepseek-ai/dsh-arch-lens-backend'"
)

function Read-Patch([string]$Path) {
  return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
}

function Write-Patch([string]$Path, [string]$Content) {
  # 保持原文件无 BOM 的 UTF-8 格式（Node 解析最稳）。
  [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

if (-not (Test-Path -LiteralPath $PatchFile)) {
  Write-Error "patch 文件不存在：$PatchFile（profile 路径对吗？）"
  exit 1
}

$content = Read-Patch $PatchFile

# ── 1. 行存在性检查：缺哪个 arch-lens 行就补哪个（不重复插入）──────────────
$missingRows = @()
foreach ($id in $ARCH_LENS_IDS) {
  if ($content -notmatch "(?m)^\s*- id: $([regex]::Escape($id))\s*$") {
    $missingRows += $id
  }
}
if ($missingRows.Count -gt 0) {
  if ($content.Trim() -ne '' -and -not $content.EndsWith("`n")) { $content += "`n" }
  $content += "`n"
  $content += "# arch-lens 本地挂载行（由 toggle-arch-lens.ps1 在缺失时追加）`n"
  $content += "- insert:`n"
  $content += ($INSERT_ROWS -join "`n") + "`n"
}

# ── 2. typert-loader：缺 packages 声明就补一个（只在完全缺失时追加）───────
$hasTypertLoader = $content -match "(?m)^\s*- id: typert-loader\s*$"
$hasBackendPackage = $content -match "(?m)^\s*- '@deepseek-ai/dsh-arch-lens-backend'\s*$"
if ($hasTypertLoader -and -not $hasBackendPackage) {
  # 已有 typert-loader 但没带后端包时，补一个 id 定位的 config 覆盖（后置补丁生效）。
  if (-not $content.EndsWith("`n")) { $content += "`n" }
  $content += "`n# typert 路由表声明（由 toggle-arch-lens.ps1 补）`n"
  $content += ($TYPERT_LOADER_ROW -join "`n") + "`n"
}
elseif (-not $hasTypertLoader) {
  if (-not $content.EndsWith("`n")) { $content += "`n" }
  $content += "`n# typert 路由表声明（由 toggle-arch-lens.ps1 补）`n"
  $content += ($TYPERT_LOADER_ROW -join "`n") + "`n"
}

# ── 3. 重写「开关段」：只改这一段的 disabled，其余文件内容一概不动 ────────
$disableValue = if ($Mode -eq 'off') { 'true' } else { 'false' }
$switchBlock = @(
  $BLOCK_START,
  '  # on = false（启用，默认）；off = true（停用，行保留）。',
  "- id: arch-lens-backend-local",
  "  disabled: $disableValue",
  "- id: ui-arch-lens-local",
  "  disabled: $disableValue",
  "- id: code-index-tree-sitter-local",
  "  disabled: $disableValue",
  $BLOCK_END
) -join "`n"

$startIdx = $content.IndexOf($BLOCK_START)
if ($startIdx -ge 0) {
  $endIdx = $content.IndexOf($BLOCK_END, $startIdx)
  if ($endIdx -ge 0) {
    $endIdx = $endIdx + $BLOCK_END.Length
  } else {
    $endIdx = $content.Length
  }
  $content = $content.Substring(0, $startIdx) + $switchBlock + $content.Substring($endIdx)
} else {
  if (-not $content.EndsWith("`n")) { $content += "`n" }
  $content += "`n$switchBlock`n"
}

# ── 4. 启用时顺手清掉开关段之外的旧禁用行（例如旧版整文件模板遗留）────────
if ($Mode -eq 'on') {
  $blockStartLiveIdx = $content.IndexOf($BLOCK_START)
  $head = if ($blockStartLiveIdx -ge 0) { $content.Substring(0, $blockStartLiveIdx) } else { $content }
  foreach ($id in $ARCH_LENS_IDS) {
    $pattern = "(?m)^(\s*)- id: $([regex]::Escape($id))\s*`r?`n\s*disabled: true\s*`r?`n"
    $head = [regex]::Replace($head, $pattern, "`$1- id: $id`n")
  }
  if ($blockStartLiveIdx -ge 0) {
    $content = $head + $content.Substring($blockStartLiveIdx)
  } else {
    $content = $head
  }
}

# ── 5. 挂载体检：patch 行只声明加载路径，产物没挂进 profile 时重启后仍会失败 ──
if ($Mode -eq 'on') {
  $mountMissing = @()
  foreach ($name in 'dsh-arch-lens-backend', 'dsh-client-arch-lens', 'dsh-code-index-tree-sitter') {
    $pkgDir = Join-Path (Join-Path (Join-Path (Split-Path -Parent $PatchFile) 'node_modules') '@deepseek-ai') $name
    if (-not (Test-Path -LiteralPath (Join-Path $pkgDir 'lib'))) { $mountMissing += $name }
  }
  if ($mountMissing.Count -gt 0) {
    Write-Host "⚠ 未挂载或缺 lib/ 产物（启用后无法加载）：$($mountMissing -join ', ')" -ForegroundColor Yellow
    Write-Host '   修复：在 arch-lens 仓库根先 pnpm run build，再运行 scripts\link-arch-lens.ps1。' -ForegroundColor Yellow
  }
}

Copy-Item -LiteralPath $PatchFile "$PatchFile.bak" -Force
Write-Patch $PatchFile $content
Write-Host "arch-lens 已切换为 mode=$Mode（仅追加/变更相关条目，备份：$PatchFile.bak）" -ForegroundColor Green
Write-Host '生效：配置热生效；前端产物变更浏览器 Ctrl+F5 即可，后端产物变更需重启 DSH 主服务。' -ForegroundColor Yellow