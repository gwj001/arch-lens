<#
.SYNOPSIS
  Arch Lens 本地产物挂载：把仓库三包登记为 DSH web profile 的 link: 依赖并安装。
  作用、用法见 scripts/scripts.md。幂等——重复执行只补齐缺失项。
#>
[CmdletBinding()]
param(
  [string]$ProfileDir = ''
)

$ErrorActionPreference = 'Stop'

# profile 定位与 toggle-arch-lens.ps1 同一套优先级：DSH_HOME > USERPROFILE > HOME，
# 命中 ~/.dsh/profiles/web（cordis.patch.yml 里 './node_modules/…' 行的解析锚点）。
if ($ProfileDir -eq '') {
  $dshHome = if ($env:DSH_HOME -ne '' -and $null -ne $env:DSH_HOME) { $env:DSH_HOME }
    elseif ($env:USERPROFILE) { Join-Path $env:USERPROFILE '.dsh' }
    else { Join-Path $env:HOME '.dsh' }
  $ProfileDir = Join-Path (Join-Path $dshHome 'profiles') 'web'
}
if (-not (Test-Path -LiteralPath $ProfileDir)) {
  Write-Error "profile 目录不存在：$ProfileDir（先跑一次 dsh web 生成 profile）"
}

# 仓库根 = scripts 目录上级；以脚本位置为锚，不写死任何人本机地址。
$RepoRoot = Split-Path -Parent $PSScriptRoot

# profile node_modules 包名 -> 仓库包目录（patch 三行 + typert 路由表所需）。
$PACKAGES = [ordered]@{
  'dsh-arch-lens-backend'      = 'packages\arch-lens-backend'
  'dsh-client-arch-lens'       = 'packages\client-arch-lens'
  'dsh-code-index-tree-sitter' = 'packages\code-index-tree-sitter'
}

foreach ($name in $PACKAGES.Keys) {
  $dir = Join-Path $RepoRoot $PACKAGES[$name]
  if (-not (Test-Path -LiteralPath $dir)) {
    Write-Error "缺少包目录（脚本不在 arch-lens 仓库里？）：$dir"
  }
  if (-not (Test-Path -LiteralPath (Join-Path $dir 'lib'))) {
    Write-Warning "$($PACKAGES[$name]) 无 lib/ 产物——先 pnpm run build（挂载照旧，产物就位即可加载）"
  }
}

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Write-Error '未找到 pnpm（README 环境要求：pnpm 11）'
}

# pnpm add 的 link: spec 幂等：package.json 与 lock 已一致时无变更，顺带完成安装。
$specs = foreach ($name in $PACKAGES.Keys) {
  $path = (Resolve-Path -LiteralPath (Join-Path $RepoRoot $PACKAGES[$name])).Path -replace '\\', '/'
  "@deepseek-ai/$name@link:$path"
}
Write-Host "挂载到 $ProfileDir" -ForegroundColor Cyan
Push-Location -LiteralPath $ProfileDir
try {
  & pnpm add @specs
  if ($LASTEXITCODE -ne 0) { Write-Error "pnpm add 失败（exit $LASTEXITCODE）" }
} finally {
  Pop-Location
}

# 验证挂载结果：服务端按 profile 内这些路径直读产物。
$mountMissing = @()
foreach ($name in $PACKAGES.Keys) {
  $pkgDir = Join-Path (Join-Path (Join-Path $ProfileDir 'node_modules') '@deepseek-ai') $name
  if (-not (Test-Path -LiteralPath (Join-Path $pkgDir 'lib'))) { $mountMissing += $name }
}
if ($mountMissing.Count -gt 0) {
  Write-Error "安装后仍不可解析：$($mountMissing -join ', ')（检查 pnpm install 是否被拦截）"
}
Write-Host '✓ 三包已挂载：' -ForegroundColor Green
foreach ($name in $PACKAGES.Keys) { Write-Host "    @deepseek-ai/$name" }
Write-Host '生效：重启 DSH 主服务；此后前端产物变更只需浏览器 Ctrl+F5。' -ForegroundColor Yellow
