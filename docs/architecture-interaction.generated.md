<!-- arch-lens generated · chapter=interaction · language=中文 · at=2026-09-01T14:07:10.603Z · 本文件由 Arch Lens 生成并整体覆盖，请勿手改 -->

# 核心交互

## 核心交互

### 职责边界与调用方向

`client-arch-lens` 作为浏览器端入口，首要职责是向用户呈现学习单元并捕获用户交互。它与 `arch-lens-backend` 之间仅有单向调用：客户端发起请求，服务端响应。二者不直接共享内部状态，所有跨端通信均通过事件或远程网关显式进行。`client-arch-lens` 同时依赖 `typert-protocol` 建立远程网关绑定，该绑定为后续生成请求提供传输通道。

`arch-lens-backend` 承担生成流程的编排者角色。它向上承接客户端的生成与中止信号，向下依赖 `code-index` 获取工作区代码索引结果；此外，它通过 `typert-protocol` 发送通知与尾部预览数据。后端内部以阶段推进方式管理生成状态：`beginGenerationStage`、`endGenerationStage` 与 `reportGeneration` 均为其内部事件，用于维护生成生命周期。

### 关键路径：从用户请求到代码索引

生成请求的黄金路径起始于 `client-arch-lens`。客户端在用户触发请求后，先经 `typert-protocol` 发起生成请求，随后 `arch-lens-backend` 收到信号，向 `code-index` 请求代码索引。`code-index` 是语言感知的接缝定义方，它并不直接实现源码解析，而是将具体工作委托给 `code-index-tree-sitter`。

该委托通过三个串行操作完成：`resolveUnder` 递归发现源码目录，`collectSources` 收集文件集合，`detectLanguage` 判定语言类型。随后树形解析器返回源码文件与调用边，`code-index` 将结果以 `CodeIndexResult` 事件回传给 `arch-lens-backend`。此路径中，`code-index` 与 `code-index-tree-sitter` 的依赖方向明确：接口在 `code-index`，实现在 `code-index-tree-sitter`，后者通过实现前者的契约返回结构化结果。

### 生成完成与通知闭环

索引完成后，`arch-lens-backend` 推进内部阶段，并在结束时通过 `notify` 事件通知客户端。同时，`tailPreview` 将尾部预览数据单独发送，供客户端渲染最终输出。客户端亦可主动调用 `abortGeneration` 中止流程，该事件直达后端，后端据此中断当前生成阶段。

### 设计取舍

`typert-protocol` 作为与编译器无关的协议层，被 `client-arch-lens` 与 `arch-lens-backend` 双侧依赖，但两侧并不直接相互依赖，而是通过该协议解耦。`code-index` 以接缝形式隔离语言解析实现，使得后端仅依赖抽象索引契约，而具体解析能力由 `code-index-tree-sitter` 按需填充。这种分层确保了后端不感知解析细节，客户端不感知后端内部状态，所有跨边界交互均收敛至协议或事件。

### 调用关系表

| 调用方 | 被调用方 | 动作 |
| --- | --- | --- |
| arch-lens-backend | code-index | 请求代码索引 |
| arch-lens-backend | typert-protocol | 发送通知与预览 |
| client-arch-lens | arch-lens-backend | 发起生成与中止请求 |
| client-arch-lens | typert-protocol | 建立网关绑定 |
| code-index-tree-sitter | code-index | 实现接缝并返回结果 |

## 图示

| 事件 | 模式 | 生产者 | 消费者 | 说明 |
| --- | --- | --- | --- | --- |
| Selection | emit | client-arch-lens | client-arch-lens | 用户选择目标节点，触发客户端内部状态更新。 |
| CoreEvent | emit | client-arch-lens | client-arch-lens | 客户端生成核心事件，驱动请求流程。 |
| generationSignal | emit | client-arch-lens | arch-lens-backend | 用户请求触发生成信号，后端收到开始处理。 |
| TypertGatewayBinding | serial | client-arch-lens | typert-protocol | 通过远程网关绑定建立调用链路。 |
| beginGenerationStage | emit | arch-lens-backend | arch-lens-backend | 后端推进生成阶段状态。 |
| CodeIndexResult | emit | code-index | arch-lens-backend | 代码索引完成后返回结果给后端。 |
| reportGeneration | emit | arch-lens-backend | arch-lens-backend | 记录生成进度。 |
| endGenerationStage | emit | arch-lens-backend | arch-lens-backend | 结束生成阶段，准备通知。 |
| notify | emit | arch-lens-backend | client-arch-lens | 通知客户端生成完成。 |
| tailPreview | emit | arch-lens-backend | client-arch-lens | 提供尾部预览数据供客户端渲染。 |
| abortGeneration | emit | client-arch-lens | arch-lens-backend | 用户中止当前生成流程。 |
| resolveUnder | serial | code-index | code-index-tree-sitter | 递归解析目录路径，发现源码文件。 |
| collectSources | serial | code-index | code-index-tree-sitter | 收集源码文件集合。 |
| detectLanguage | serial | code-index | code-index-tree-sitter | 检测源码语言类型。 |
