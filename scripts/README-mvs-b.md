# MVS-B：host 改动安全重启流程（安全网）

目标：把"用户在场手动重启"从**调试**变成**部署**——重启前验证新产物能加载，
重启后能自动发现并报告结果。零新依赖，不改变服务运行方式。

## 三个部件

| 脚本 | 用途 | 谁跑 |
|---|---|---|
| `smoke-web.mjs` | **影子冒烟**：另起一次性实例（OS 分配端口）→ 等 `dsh web:` 就绪 → HTTP 探测 → 关闭。拦截 boot 期致命错误（模块解析、插件 apply、配置错误） | agent（重启前） |
| `record-restart.mjs` | 重启前写 `~/.dsh/restart-state.json`（phase=prepared + build 指纹 + 启动命令）与 `~/.dsh/boot.json`（重启前的 boot 记录） | agent（重启前） |
| `check-restart.mjs` | 恢复后读状态文件，报告"是否重启过、上次状态、日志位置"；`phase=failed` 时退出码 3 | agent（下次会话） |
| `dsh-web.cmd` | 可选：带日志重定向的启动命令（控制台 + `~/.dsh/dsh-web.log` 双写），失败时日志留档可查 | 用户 |

## agent 的标准流程（host 改动上线）

1. 构建 + typecheck 通过
2. `node scripts/smoke-web.mjs` → 通过才继续（失败：修复，不碰 live）
3. `node scripts/record-restart.mjs`（记录 intent + 当前 boot 指纹）
4. 请用户在场重启（`Ctrl+C` 后重新启动，或 `scripts\dsh-web.cmd`）
5. 用户重启后：跑 `node scripts/check-restart.mjs` + 对比 live pid → 确认新 boot 指纹
   已生效 → 读 `~/.dsh/dsh-web.log` 尾确认无 boot 错误 → 报告"新版已上线"

## 失败路径

- 冒烟失败 → 不重启，修复后重试
- 重启后 check 发现 `phase=prepared`（重启没发生）或 `phase=failed` → 读日志挖原因，
  旧版仍可用（用户回滚/重新启动）
- 日志位置：`~/.dsh/dsh-web.log`（用 `dsh-web.cmd` 启动时持续写入）

## 升级到 MVS-A（自动重启）

把"步骤 4 用户手动重启"替换为 `scripts/dsh-web-supervisor.mjs`（约 60 行）：
监听子进程退出 → 按 restart-state 重新 spawn 新产物 → 起不来自动回滚 last-good。
冒烟/状态文件/日志设计全部复用，升级零返工。
