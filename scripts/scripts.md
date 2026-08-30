# scripts · 脚本手册

本目录脚本只做 arch-lens 仓库的**维护动作**，不参与插件运行时。各脚本头部不再
内嵌说明（agent 懒加载），完整文档在此。

**执行方式**：先在 **arch-lens 项目根目录**（本 README 所在目录，即你 clone 本
仓库的位置）打开终端，下面的命令直接粘贴即可，无需替换任何内容。脚本以自身
位置为锚推算路径，不写死任何人本机地址；想从任意目录执行则把命令中的
`scripts\...` 换成脚本的绝对路径即可。

---

## toggle-arch-lens.ps1 — 启用 / 停用 arch-lens 插件

**什么时候用**：日常随时切换。研究代码时 `on`，平时 `off` 让 DSH 干净启动。

**行为**：只对 DSH web profile 的 `cordis.patch.yml` 做追加 / 变更——缺 arch-lens
行才补，已有则只翻转 `disabled`；**mcp-browser 及其它任何配置原样不动**。切换前
自动备份 `cordis.patch.yml.bak`。开关段带 `# >>>>>> arch-lens 开关段` 标记，脚本只
重写这一段。

**用法**（Windows，cmd 或 PowerShell 都行）：

```cmd
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\toggle-arch-lens.ps1 -Mode on
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\toggle-arch-lens.ps1 -Mode off
```

**用法**（macOS / Linux，需先装 PowerShell 7：`brew install --cask powershell`）：

```bash
pwsh -NoProfile -File scripts/toggle-arch-lens.ps1 -Mode on
pwsh -NoProfile -File scripts/toggle-arch-lens.ps1 -Mode off
```

**生效方式**：配置热生效；但浏览器端插件拉取发生在页面加载时——切换后**浏览器
Ctrl+F5 强刷**；若涉及后端（`arch-lens-backend-local` 首次挂载、typert 路由表），
或出现"切了没生效/怪报错"，**重启 `pnpm dsh web`** 兜底。

**参数**：`-Mode on|off`（必填）；`-PatchFile`（可选，默认按平台解析 DSH 用户目录：
`$DSH_HOME` 环境变量优先，其次 Windows `%USERPROFILE%`、macOS/Linux `$HOME` 的
`~/.dsh`，即 `profiles\web\cordis.patch.yml`）。

**注意**：停用 ≠ 删除——junction、`ARCH-NOTES.md`、`index/` 缓存、已保存动态图
全保留，`on` 秒恢复；停用后旧标签页学习台 RPC 报错，Ctrl+F5 后消失，正常。

---

## check-contract.cmd / check-contract.mjs — Remote 契约一致性校验

**什么时候用**：**改动过后端 `@Remote` 方法集（增/删/改名，含值结构变化）之后
必跑**，发布前跑一遍。

**作用**：对比 `packages/arch-lens-backend/src/index.ts` 的 `@Remote` 方法名与
**本仓库** `packages/client-arch-lens/lib/client.js`（浏览器 bundle 内联的
typert codec 表）是否一致，并抽查 `archLens_sequence` 结果 schema 是否带
`source` 字段。独立运行，**不需要 harness 路径**。

**退出码**：`0` = 同步（可放心继续）；非 `0` = 落后（LAG）/ 残留（STALE）。
**同步方式**：`pnpm build`（重新生成 typert 产物 + 内联它们的 client bundle），
然后重跑校验。重启 DSH 主服务后生效。

**用法**（双击脚本，或命令行）：

```cmd
check-contract.cmd
node scripts\check-contract.mjs
```

---

## gen-typert.mjs — 独立生成 typert 产物

**什么时候用**：需要**绕过 tsdown 集成**、单独重新生成后端的 typert 产物时
（平时 `pnpm build` 已包含该步骤，一般用不到）。

**作用**：直接在 `packages/arch-lens-backend/lib/` 写出
`typert.host.js` / `typert.host.d.ts`（含 remote-client 对）。

**用法**：

```bash
node scripts/gen-typert.mjs
```

---

## verify-dsh-web.cmd — 独立实例验证

**什么时候用**：改完 arch-lens 构建产物（`packages/*/lib`），想**不动主服务**、
先起一个独立实例冒烟验证。

**作用**：在独立端口（默认 3081，避开主服务 3080）前台启动 DSH Web，通过
`profiles/web` 补丁层加载本地 arch-lens 新产物。前台运行，**关闭窗口即停止**。

**用法**（harness 目录解析顺序：`argv > $DSH_HARNESS_DIR > 同级推断（本仓库
`..\..` 下的 deepseek-harness）> 报错`）：

```cmd
verify-dsh-web.cmd [port] [harnessDir]
:: 例：verify-dsh-web.cmd 3082
```

**验证步骤**：窗口出现 `dsh web: http://127.0.0.1:<port>` → 浏览器打开该地址 →
页面出现 🤖 悬浮机器人 = 插件加载成功 → 关窗停止 → 再重启你的主服务。
（注意：`--no-open`/浏览器交接行为与主实例相同；端口被占时先结束残留 node 进程。）