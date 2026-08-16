/**
 * Curated learning data for the Arch Lens units: concept tree, turn sequence,
 * and core event catalog. These are packaged defaults maintained with the
 * harness documentation; the sequence and events derive from
 * docs/architecture.md.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/curated
 */

/** One concept-tree node: a concept with optional children and an optional backing package id. */
export interface ConceptNode {
  id: string
  name: string
  desc: string
  inside?: string
  pkg?: string
  children?: ConceptNode[]
}

/** Desc fallback for concept nodes that only group children. */
const GROUP_DESC = ''

/** The curated concept hierarchy for deepseek-harness. */
export const CONCEPT_TREE: ConceptNode[] = [
  {
    id: 'cordis', name: '🧱 Cordis 框架', desc: '插件运行时：一切皆插件，无特权核心',
    inside: '插件 = 函数对象（可选 inject + apply(ctx)）。ctx 是服务仓库 + 事件总线；所有注册都是可逆效果（ctx.effect / ctx.on），插件卸载自动解开。',
    children: [
      { id: 'cordis.ctx', name: '上下文 Context', desc: 'ctx：服务仓库 + 事件总线' },
      { id: 'cordis.service', name: '服务 Service', desc: 'provide 注册 / get·inject 消费；加载顺序由服务依赖决定' },
      { id: 'cordis.event', name: '事件 Event', desc: 'emit / waterfall / parallel / serial', inside: 'waterfall 监听者必须调用 next() 放行，否则短路整条链——策略插件就挂在这里。' },
      { id: 'cordis.effect', name: '效果 effect', desc: '可逆注册：注册时即声明卸载方式' },
    ],
  },
  {
    id: 'core', name: '⚙️ 核心层 core/*', desc: '会话、Agent、主循环、提示词、工具、作用域',
    inside: '核心层通过两条腿调度：服务调用（ctx.get / inject，同步能力访问）与事件（关键节点发射，插件挂载观察或改写）。事件分三域：会话事件（durable）、agent 事件（live）、能力事件（策略）。',
    children: [
      { id: 'core.session', name: '会话日志', pkg: 'session', desc: '一切之源：追加式日志', inside: 'SessionEvent 追加式日志；deriveMessages() 投影模型历史；「模型可见 ⟺ 已记录」是硬不变量。' },
      { id: 'core.agent', name: '活体 Agent', pkg: 'agent', desc: '注册表 + agent/* 事件' },
      { id: 'core.loop', name: '主循环', pkg: 'agent-loop', desc: 'turn/step 驱动', inside: '一次 step = 一次模型请求 + 它调用的工具。inbox 认领输入 → pre-step 瀑布 → llm/stream → 工具管线 → 结果入日志 → 欠工作则下一步。' },
      { id: 'core.prompt', name: '提示词组装', pkg: 'system-prompt', desc: '提示词段 + 工具 schema' },
      { id: 'core.tools', name: '工具管线', pkg: 'tools', desc: 'pre/execute/post 三段' },
      { id: 'core.scope', name: '作用域', pkg: 'scope', desc: '每代理独立注册空间' },
    ],
  },
  {
    id: 'sandbox', name: '🛡️ 沙箱与权限', desc: '进程约束缝：三种模式 + 平台 runner + fail-closed',
    inside: '沙箱只管文件效果：read-only / workspace-write / danger-full-access。策略按调用逐次解析（显式模式 > 会话 sandbox/mode 事件 > 部署默认），workspace root 来自会话不可变 cwd。受限模式无可用后端 → SANDBOX_UNAVAILABLE，静默无隔离透传永不合法。',
    children: [
      { id: 'sandbox.seam', name: '沙箱缝 ctx.sandbox', pkg: 'sandbox', desc: 'confine(argv, policy) → 受限 argv' },
      { id: 'sandbox.policy', name: '策略解析 ctx.sandboxPolicy', pkg: 'sandbox-policy', desc: '模式优先级 + root 回退' },
      { id: 'sandbox.local', name: '平台后端', pkg: 'sandbox-local', desc: 'Linux bwrap/Landlock · macOS Seatbelt · Windows ACL', inside: '多 runner 链用功能探测仲裁；每个后端把拒绝方言（EROFS/EACCES/EPERM/ACL）映射成 denialSignatures 供消费方分类。' },
      { id: 'sandbox.bash', name: 'bash 沙箱消费方', pkg: 'bash-sandbox', desc: 'bash 执行器包装 argv' },
      { id: 'sandbox.pwsh', name: 'pwsh 沙箱消费方', pkg: 'pwsh-sandbox', desc: 'PowerShell 执行器包装 argv' },
      { id: 'sandbox.fs', name: '文件系统沙箱', pkg: 'fs-sandbox', desc: 'fs 后端的写入栅栏（FS_SANDBOX_DENIED）' },
      { id: 'sandbox.preset', name: '权限预设', pkg: 'permission-presets', desc: '把 sandbox 模式 + 审批策略捆绑成具名预设' },
    ],
  },
  {
    id: 'llm', name: '🔌 LLM 能力 llm/*', desc: '适配器注册表 + 提供方', children: [
      { id: 'llm.core', name: '适配器注册表', pkg: 'llm', desc: 'ctx.llm' },
      { id: 'llm.ds', name: 'DeepSeek 提供方', pkg: 'llm-deepseek', desc: '真实 API' },
      { id: 'llm.pi', name: 'pi-ai 提供方', pkg: 'llm-pi-ai', desc: '历史转请求（含图像）' },
      { id: 'llm.retry', name: '重试', pkg: 'llm-retry', desc: '失败策略' },
    ],
  },
  {
    id: 'persist', name: '💾 持久化', desc: '落盘与查询', children: [
      { id: 'persist.sp', name: '持久化抽象', pkg: 'session-persistence', desc: 'append-only 接口' },
      { id: 'persist.jsonl', name: 'JSONL 实现', pkg: 'session-persistence-jsonl', desc: '本地文件' },
      { id: 'persist.sq', name: '会话查询', pkg: 'session-query', desc: 'searchSessions / searchEvents' },
    ],
  },
  {
    id: 'seam-fs', name: '🗂️ 能力缝：文件系统', desc: '定义 / 提供 / 消费', children: [
      { id: 'seam-fs.def', name: '服务定义', pkg: 'fs', desc: 'ctx.fs 契约' },
      { id: 'seam-fs.local', name: '本地提供方', pkg: 'fs-local', desc: '真实实现' },
      { id: 'seam-fs.tool', name: 'read/read_image/write/edit', pkg: 'tool-fs', desc: '模型可见工具' },
      { id: 'seam-fs.policy', name: '观察策略', pkg: 'fs-observation-policy', desc: 'fs/* 事件门禁' },
    ],
  },
  {
    id: 'seam-shell', name: '⌨️ 能力缝：命令执行', desc: GROUP_DESC, children: [
      { id: 'seam-shell.def', name: 'shell 服务', pkg: 'shell', desc: 'ctx.shell' },
      { id: 'seam-shell.tool', name: 'bash 工具', pkg: 'tool-bash', desc: '命令执行' },
      { id: 'seam-shell.sub', name: '子进程层', pkg: 'subprocess', desc: 'spawn / PTY' },
    ],
  },
  {
    id: 'seam-web', name: '🌐 能力缝：网络', desc: GROUP_DESC, children: [
      { id: 'seam-web.def', name: 'web 服务', pkg: 'web', desc: 'ctx.web' },
      { id: 'seam-web.tool', name: 'web 工具', pkg: 'tool-web', desc: 'search / fetch' },
    ],
  },
  {
    id: 'subagent', name: '🤝 子代理 subagent', desc: '同一接口多提供方', children: [
      { id: 'subagent.core', name: '子代理服务', pkg: 'subagent', desc: 'ctx.subagents' },
      { id: 'subagent.tool', name: 'subagent 工具', pkg: 'tool-subagent', desc: '模型可见委托' },
    ],
  },
  {
    id: 'gui', name: '🖥️ Web GUI client/*', desc: '浏览器插件表 + UI', children: [
      { id: 'gui.modules', name: '客户端模块表', pkg: 'client-modules', desc: '扫描 dsh.client 组合启动图' },
    ],
  },
  {
    id: 'api', name: '🔀 API 面', desc: '外部接入', children: [
      { id: 'api.gw', name: 'API 网关', pkg: 'api-gateway', desc: 'Typert RPC' },
      { id: 'api.acp', name: 'ACP 服务', pkg: 'acp', desc: '自动化协议' },
    ],
  },
]

/** One turn-sequence message. */
export interface SequenceMessage {
  from: string
  to: string
  label: string
}

/** One sequence participant lane. */
export interface SequenceActor {
  name: string
}

/** The curated actors of the turn flow. */
export const SEQUENCE_ACTORS: string[] = ['User', 'agent-loop', 'Plugins', 'LLM', 'Tools', 'Session']

/** The curated turn message flow (derived from docs/architecture.md). */
export const SEQUENCE: SequenceMessage[] = [
  { from: 'User', to: 'agent-loop', label: '输入（下一步消息）' },
  { from: 'agent-loop', to: 'Plugins', label: 'agent/pre-step（waterfall：改写或拒绝）' },
  { from: 'Plugins', to: 'agent-loop', label: 'next() 决定：enter / reject' },
  { from: 'agent-loop', to: 'Session', label: 'user/message 入日志' },
  { from: 'agent-loop', to: 'LLM', label: 'agent/request（提示词段 + 工具 schema）' },
  { from: 'LLM', to: 'agent-loop', label: 'llm/stream：assistant/chunk* 流式' },
  { from: 'agent-loop', to: 'Tools', label: 'tool/call（pre-execute → execute → post-execute）' },
  { from: 'Tools', to: 'agent-loop', label: 'tool/result（入日志）' },
  { from: 'agent-loop', to: 'agent-loop', label: '还欠工作？→ 下一步；否则回合结束' },
  { from: 'agent-loop', to: 'User', label: '回答（turn/end）' },
]

/** One core interaction event row. */
export interface CoreEvent {
  event: string
  mode: string
  producers: string[]
  consumers: string[]
  note: string
}

/** The curated core event catalog (derived from docs/architecture.md). */
export const CORE_EVENTS: CoreEvent[] = [
  { event: 'agent/pre-step', mode: 'waterfall', producers: ['agent-loop'], consumers: ['权限/策略插件', '观测插件'], note: '每步模型输入的前置决策点：改写或拒绝' },
  { event: 'agent/request', mode: 'waterfall', producers: ['agent-loop'], consumers: ['审计插件'], note: '请求发出前的拦截点' },
  { event: 'llm/stream', mode: 'waterfall', producers: ['llm'], consumers: ['llm-retry', 'token-meter', '遥测'], note: '模型流式输出的包装点' },
  { event: 'tools/*', mode: 'waterfall', producers: ['ctx.tools'], consumers: ['工具守卫', '审计'], note: '工具执行管线三段' },
  { event: 'session/event', mode: 'emit', producers: ['会话层'], consumers: ['UI 投影', '持久化', '遥测'], note: '所有 durable 会话事实的出口' },
  { event: 'agent/*', mode: 'emit', producers: ['core/agent'], consumers: ['goals', 'subagent'], note: 'agent 生命周期：created / disposed / status' },
  { event: 'fs/*', mode: 'emit', producers: ['tool-fs'], consumers: ['fs-observation-policy'], note: '文件系统观察（read/write/edit 后触发）' },
  { event: 'telemetry/*', mode: 'emit', producers: ['session-telemetry'], consumers: ['otel 导出'], note: '遥测附加点' },
]

/** English concept hierarchy (mirror of CONCEPT_TREE, shown when the role language is English). */
export const CONCEPT_TREE_EN: ConceptNode[] = [
  {
    id: 'cordis', name: '🧱 Cordis runtime', desc: 'Plugin runtime: everything is a plugin, no privileged core',
    inside: 'A plugin is a function object (optional inject + apply(ctx)). ctx is a service registry + event bus; every registration is a reversible effect (ctx.effect / ctx.on) that unwinds automatically when the plugin unloads.',
    children: [
      { id: 'cordis.ctx', name: 'Context', desc: 'ctx: service registry + event bus' },
      { id: 'cordis.service', name: 'Service', desc: 'provide registers / get·inject consumes; load order follows service dependencies' },
      { id: 'cordis.event', name: 'Event', desc: 'emit / waterfall / parallel / serial', inside: 'waterfall listeners must call next() to pass on, otherwise the chain short-circuits — policy plugins hook in here.' },
      { id: 'cordis.effect', name: 'effect', desc: 'Reversible registration: the unregister path is declared at registration time' },
    ],
  },
  {
    id: 'core', name: '⚙️ Core layer core/*', desc: 'Session, agent, main loop, prompts, tools, scope',
    inside: 'The core schedules on two legs: service calls (ctx.get / inject, synchronous capability access) and events (emitted at key points; plugins observe or rewrite). Events live in three domains: session events (durable), agent events (live), capability events (policy).',
    children: [
      { id: 'core.session', name: 'Session log', pkg: 'session', desc: 'Source of everything: append-only log', inside: 'Append-only SessionEvent log; deriveMessages() projects the model history; "model-visible ⟺ logged" is a hard invariant.' },
      { id: 'core.agent', name: 'Live agent', pkg: 'agent', desc: 'Registry + agent/* events' },
      { id: 'core.loop', name: 'Main loop', pkg: 'agent-loop', desc: 'turn/step driven', inside: 'One step = one model request + the tools it calls. inbox claims input → pre-step waterfall → llm/stream → tool pipeline → results logged → next step if work remains.' },
      { id: 'core.prompt', name: 'Prompt assembly', pkg: 'system-prompt', desc: 'prompt sections + tool schemas' },
      { id: 'core.tools', name: 'Tool pipeline', pkg: 'tools', desc: 'pre/execute/post stages' },
      { id: 'core.scope', name: 'Scope', pkg: 'scope', desc: 'per-agent registration space' },
    ],
  },
  {
    id: 'sandbox', name: '🛡️ Sandbox & permissions', desc: 'Process confinement seam: three modes + platform runners + fail-closed',
    inside: 'The sandbox governs file effects only: read-only / workspace-write / danger-full-access. Policy resolves per call (explicit mode > session sandbox/mode events > deployment default); the workspace root comes from the session\'s immutable cwd. Restricted mode without an available backend → SANDBOX_UNAVAILABLE; silently running without isolation is never legal.',
    children: [
      { id: 'sandbox.seam', name: 'Sandbox seam ctx.sandbox', pkg: 'sandbox', desc: 'confine(argv, policy) → restricted argv' },
      { id: 'sandbox.policy', name: 'Policy ctx.sandboxPolicy', pkg: 'sandbox-policy', desc: 'mode priority + root fallback' },
      { id: 'sandbox.local', name: 'Platform backends', pkg: 'sandbox-local', desc: 'Linux bwrap/Landlock · macOS Seatbelt · Windows ACL', inside: 'A runner chain arbitrates by feature probing; each backend maps its denial dialect (EROFS/EACCES/EPERM/ACL) into denialSignatures for consumers to classify.' },
      { id: 'sandbox.bash', name: 'bash sandbox consumer', pkg: 'bash-sandbox', desc: 'bash executor wraps argv' },
      { id: 'sandbox.pwsh', name: 'pwsh sandbox consumer', pkg: 'pwsh-sandbox', desc: 'PowerShell executor wraps argv' },
      { id: 'sandbox.fs', name: 'Filesystem sandbox', pkg: 'fs-sandbox', desc: 'write barrier on the fs backend (FS_SANDBOX_DENIED)' },
      { id: 'sandbox.preset', name: 'Permission presets', pkg: 'permission-presets', desc: 'bundles sandbox mode + approval policy into named presets' },
    ],
  },
  {
    id: 'llm', name: '🔌 LLM capability llm/*', desc: 'adapter registry + providers', children: [
      { id: 'llm.core', name: 'Adapter registry', pkg: 'llm', desc: 'ctx.llm' },
      { id: 'llm.ds', name: 'DeepSeek provider', pkg: 'llm-deepseek', desc: 'real API' },
      { id: 'llm.pi', name: 'pi-ai provider', pkg: 'llm-pi-ai', desc: 'history → request (incl. images)' },
      { id: 'llm.retry', name: 'Retry', pkg: 'llm-retry', desc: 'failure policy' },
    ],
  },
  {
    id: 'persist', name: '💾 Persistence', desc: 'disk + query', children: [
      { id: 'persist.sp', name: 'Persistence abstraction', pkg: 'session-persistence', desc: 'append-only interface' },
      { id: 'persist.jsonl', name: 'JSONL implementation', pkg: 'session-persistence-jsonl', desc: 'local files' },
      { id: 'persist.sq', name: 'Session query', pkg: 'session-query', desc: 'searchSessions / searchEvents' },
    ],
  },
  {
    id: 'seam-fs', name: '🗂️ Capability seam: filesystem', desc: 'definition / provider / consumer', children: [
      { id: 'seam-fs.def', name: 'Service definition', pkg: 'fs', desc: 'ctx.fs contract' },
      { id: 'seam-fs.local', name: 'Local provider', pkg: 'fs-local', desc: 'real implementation' },
      { id: 'seam-fs.tool', name: 'read/read_image/write/edit', pkg: 'tool-fs', desc: 'model-visible tools' },
      { id: 'seam-fs.policy', name: 'Observation policy', pkg: 'fs-observation-policy', desc: 'fs/* event gate' },
    ],
  },
  {
    id: 'seam-shell', name: '⌨️ Capability seam: command execution', desc: GROUP_DESC, children: [
      { id: 'seam-shell.def', name: 'shell service', pkg: 'shell', desc: 'ctx.shell' },
      { id: 'seam-shell.tool', name: 'bash tool', pkg: 'tool-bash', desc: 'command execution' },
      { id: 'seam-shell.sub', name: 'Subprocess layer', pkg: 'subprocess', desc: 'spawn / PTY' },
    ],
  },
  {
    id: 'seam-web', name: '🌐 Capability seam: network', desc: GROUP_DESC, children: [
      { id: 'seam-web.def', name: 'web service', pkg: 'web', desc: 'ctx.web' },
      { id: 'seam-web.tool', name: 'web tool', pkg: 'tool-web', desc: 'search / fetch' },
    ],
  },
  {
    id: 'subagent', name: '🤝 Subagent subagent', desc: 'one interface, multiple providers', children: [
      { id: 'subagent.core', name: 'Subagent service', pkg: 'subagent', desc: 'ctx.subagents' },
      { id: 'subagent.tool', name: 'subagent tool', pkg: 'tool-subagent', desc: 'model-visible delegation' },
    ],
  },
  {
    id: 'gui', name: '🖥️ Web GUI client/*', desc: 'browser plugin table + UI', children: [
      { id: 'gui.modules', name: 'Client module table', pkg: 'client-modules', desc: 'scans dsh.client composition boot graph' },
    ],
  },
  {
    id: 'api', name: '🔀 API surface', desc: 'external integration', children: [
      { id: 'api.gw', name: 'API gateway', pkg: 'api-gateway', desc: 'Typert RPC' },
      { id: 'api.acp', name: 'ACP service', pkg: 'acp', desc: 'automation protocol' },
    ],
  },
]

/** English turn message flow (mirror of SEQUENCE). */
export const SEQUENCE_EN: SequenceMessage[] = [
  { from: 'User', to: 'agent-loop', label: 'Input (next message)' },
  { from: 'agent-loop', to: 'Plugins', label: 'agent/pre-step (waterfall: rewrite or reject)' },
  { from: 'Plugins', to: 'agent-loop', label: 'next() decides: enter / reject' },
  { from: 'agent-loop', to: 'Session', label: 'user/message appended to log' },
  { from: 'agent-loop', to: 'LLM', label: 'agent/request (prompt sections + tool schemas)' },
  { from: 'LLM', to: 'agent-loop', label: 'llm/stream: assistant/chunk* streaming' },
  { from: 'agent-loop', to: 'Tools', label: 'tool/call (pre-execute → execute → post-execute)' },
  { from: 'Tools', to: 'agent-loop', label: 'tool/result (logged)' },
  { from: 'agent-loop', to: 'agent-loop', label: 'More work? → next step; otherwise turn ends' },
  { from: 'agent-loop', to: 'User', label: 'Answer (turn/end)' },
]

/** English core event catalog (mirror of CORE_EVENTS). */
export const CORE_EVENTS_EN: CoreEvent[] = [
  { event: 'agent/pre-step', mode: 'waterfall', producers: ['agent-loop'], consumers: ['policy/permission plugins', 'observation plugins'], note: 'Decision point before each step\'s model input: rewrite or reject' },
  { event: 'agent/request', mode: 'waterfall', producers: ['agent-loop'], consumers: ['audit plugins'], note: 'Interception point before the request is sent' },
  { event: 'llm/stream', mode: 'waterfall', producers: ['llm'], consumers: ['llm-retry', 'token-meter', 'telemetry'], note: 'Wrapping point for the model\'s streaming output' },
  { event: 'tools/*', mode: 'waterfall', producers: ['ctx.tools'], consumers: ['tool guards', 'audit'], note: 'Three-stage tool execution pipeline' },
  { event: 'session/event', mode: 'emit', producers: ['session layer'], consumers: ['UI projections', 'persistence', 'telemetry'], note: 'The outlet for all durable session facts' },
  { event: 'agent/*', mode: 'emit', producers: ['core/agent'], consumers: ['goals', 'subagent'], note: 'Agent lifecycle: created / disposed / status' },
  { event: 'fs/*', mode: 'emit', producers: ['tool-fs'], consumers: ['fs-observation-policy'], note: 'Filesystem observation (fires after read/write/edit)' },
  { event: 'telemetry/*', mode: 'emit', producers: ['session-telemetry'], consumers: ['otel export'], note: 'Telemetry attachment point' },
]
