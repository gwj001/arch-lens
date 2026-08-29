# 贡献指南

欢迎 Issues 与 PR。提 PR 前请先读完整份指南，并遵守 [行为准则](CODE_OF_CONDUCT.md)。

## 开发环境

- Node.js `^22.19 || >=24`、pnpm 11（本仓库是 pnpm workspace，见 root `package.json`）
- 一个可运行的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（联调需要）

```bash
pnpm install
```

常用一键入口：`pnpm run typecheck` / `pnpm test` / `pnpm build` / `pnpm run verify`（= test + build）。

## 构建 / 检查 / 测试

```bash
pnpm exec tsc -b tsconfig.json                    # 类型（strict + exactOptionalPropertyTypes）
pnpm exec vitest run --pool=threads               # 全量测试
pnpm exec tsdown --config tsdown.config.ts        # host 面：产出后端 lib/index.js 等
pnpm exec tsdown --config tsdown.config.ts --env.DSH_BUILD_FACE client   # client 面
```

**lib 提交纪律**：`packages/*/lib/` 顶层产物是**分发包载荷**，随源码一起提交——
改了 `src/` 必须在同一 PR 里重新跑两面构建并提交 lib，否则部署方拿不到改动。

## 生效规则（联调时）

| 改动位置 | 生效方式 |
|---|---|
| `arch-lens-backend` 等宿主包 | 重启 DSH 主服务（宿主按启动快照加载 `lib/index.js`） |
| `client-arch-lens` | 浏览器 Ctrl+F5（client bundle 的 rev 随服务启动固定） |

## 代码约定

- TypeScript strict；`exactOptionalPropertyTypes` 打开——可选属性一律
  `x !== undefined` 判别，不写 falsy 合并。
- 前后端只经 Typert RPC（`@Remote` + `remote.ts` 手写签名）通信；类型放
  `arch-lens-backend/src/types.ts` 公共子路径，浏览器端**不得** import 宿主主入口。
- 新图种必须经 `figures.ts` 注册表登记（清单 / 权威文件名 / deps 规则 / `writeFigure`
  统一写路径）；任何模块手拼缓存名是结构性错误，回归测试会拒绝。
- 缓存一律走 `fact-cache.ts` 版本信封 `{v, deps?, data}`；写失败必须抛出（禁止静默）。
- UI 文案进 `client/i18n.ts`，**zh 与 en 双语键必须同时加**。
- 每个副作用（监听器/定时器/槽位/样式）必须挂 Fiber 生命周期可回收。

## 测试

- 测试与被测模块同 PR；量化断言（LLM 调用次数、输入字符预算）写在 `*.spec.ts`。
- 修复 bug 先写复现测试（本项目惯例：症状级回归锁）。

## PR 流程

1. `pnpm exec tsc -b && pnpm exec vitest run --pool=threads` 全绿；
2. 两面构建并提交 lib；
3. PR 描述：动机 → 方案 → 影响面（缓存/失效/线协议是否变化）→ 验证输出；
4. 一个 PR 一件事；行为变更需同步更新 `docs/`（README 界面速查 / usage / 机制文档）。

## 提交信息

`type(scope): 摘要`（中文可用），如 `fix(client-arch-lens): 概念树文字出框`。
type ∈ feat / fix / perf / refactor / docs / test / chore；scope 用包名。
