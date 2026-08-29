<#
.SYNOPSIS
  Arch Lens 一键装卸开关：在 DSH profile 的 cordis.patch.yml 里
  启用(on) / 停用(off) arch-lens 挂载行，重启主服务后生效。

.DESCRIPTION
  on  = 完整挂载：禁用 bundle 自带 arch-lens 行 + 注入本地三行
        (backend / ui / code-index-tree-sitter) + typert-loader 包声明。
  off = 彻底不加载：bundle arch-lens 行保持禁用，本地注入行与
        typert-loader 覆盖全部移除；无关的 mcp-browser 行原样保留。
  两种模式都不碰 junction、不删工作区数据（ARCH-NOTES / index 缓存原样留着）。
  切换前自动备份当前 patch 到同目录 cordis.patch.yml.bak。

.EXAMPLE
  pnpm exec pwsh -File scripts/toggle-arch-lens.ps1 -Mode off
  # 然后重启 DSH 主服务；再开浏览器就是无 Arch Lens 的干净 DSH。
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateSet('on', 'off')][string]$Mode,
  [string]$PatchFile = "$env:USERPROFILE\.dsh\profiles\web\cordis.patch.yml"
)

if ($Mode -eq 'on') {
  $content = @'
# Your patch layer for this dsh profile, applied after every bundle layer.
# managed by arch-lens repo: scripts/toggle-arch-lens.ps1 (mode=on)
- id: arch-lens-backend
  disabled: true
- id: ui-arch-lens
  disabled: true
# The code-index seam also comes from the standalone build: the harness copy
# only discovers the two-level packages/<group>/<pkg> layout, so flat-layout
# workspaces (arch-lens itself) index to zero packages and every index-based
# figure falls back to curated DSH data. The local build carries the
# flat-layout discovery fix.
- id: code-index-tree-sitter
  disabled: true
- insert:
    - id: arch-lens-backend-local
      # Relative path through this profile's node_modules (junction into the
      # standalone arch-lens repo). The source-launch host resolves bare
      # @deepseek-ai names through the harness tsconfig paths, so only a
      # relative specifier reaches the local build.
      name: './node_modules/@deepseek-ai/dsh-arch-lens-backend/lib/index.js'
    - id: ui-arch-lens-local
      name: '@deepseek-ai/dsh-client-arch-lens'
    - id: code-index-tree-sitter-local
      name: './node_modules/@deepseek-ai/dsh-code-index-tree-sitter/lib/index.js'
    - id: mcp-browser
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: browser
        transport: stdio
        command: npx
        args: ['-y', '@playwright/mcp@latest']
# The typert route table must keep coming from the standalone build: with the
# backend mounted by file path the typert-loader can no longer derive the
# package artifact from the entry name, so declare the package explicitly.
- id: typert-loader
  config:
    packages:
      - '@deepseek-ai/dsh-arch-lens-backend'
'@
}
else {
  $content = @'
# Your patch layer for this dsh profile, applied after every bundle layer.
# managed by arch-lens repo: scripts/toggle-arch-lens.ps1 (mode=off)
# arch-lens fully unloaded: bundle rows stay disabled, local mounts removed.
- id: arch-lens-backend
  disabled: true
- id: ui-arch-lens
  disabled: true
- insert:
    - id: mcp-browser
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: browser
        transport: stdio
        command: npx
        args: ['-y', '@playwright/mcp@latest']
'@
}

if (-not (Test-Path $PatchFile)) {
  Write-Error "patch 文件不存在：$PatchFile（profile 路径对吗？）"
  exit 1
}
Copy-Item $PatchFile "$PatchFile.bak" -Force
Set-Content -Path $PatchFile -Value $content -Encoding utf8NoBOM
Write-Host "cordis.patch.yml 已切换为 mode=$Mode（旧文件备份于 $PatchFile.bak）" -ForegroundColor Green
Write-Host '▶ 重启 DSH 主服务后生效；浏览器再 Ctrl+F5。' -ForegroundColor Yellow
