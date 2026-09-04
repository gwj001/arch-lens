# Arch Lens 生成状态重构 —— 改动位置文档（评审稿，未改代码）

> 目标：修「关页重开生成中状态丢失 / 画完不自动出现」+ 根因「单槽覆盖」+ 用事件流替代 2s 轮询。
> 本文件只标记改动位置与前后差异，不落任何代码改动，不做 git commit。

## 结论速览

- 后端把 `pendingFigure` 单槽（一次只能登记一件事，二次登记顶掉第一次）改成 `Map<figId, PendingFigure>`（每张图一个登记位，会话排队执行、各自 figId 各自认领）。
- 后端新增只读 remote `figurePending`：面板重开时主动 pull 宿主挂起状态，恢复「正在生成…」。
- 客户端订阅现成的会话事件源 `sessions.binding(id).eventSource`（`assistant/message` 带 figId 时精确触发重拉），**删除 2s 轮询**。
- 附：清理 2s 轮询遗留的 orphan timer（删掉轮询即自然消除）。

## 改动清单（T1–T8）

---

### 后端 `packages/arch-lens-backend/src/index.ts`

#### B1. 字段：单槽 → 按 figId 键控 Map（约 L192–L194）

现状：
```ts
  /** One staged session-driven figure request (🤖 AI 生成 via 会话回合):
   * matched by figId in the agent's answer, written to the figure cache. */
  private pendingFigure: PendingFigure | null = null
```
改为：
```ts
  /** Session-driven figure requests (🤖 AI 生成 / 动态下钻 via 会话回合),
   * keyed by figId. The session queue serializes execution; each staged
   * figure keeps its own registration so a second request never overwrites
   * the first. Entries are removed on figId match or 30-min TTL. */
  private pendingFigures = new Map<string, PendingFigure>()
```

#### B2. `remoteFigurePrompt` 登记处（L1176–L1193）

现状（L1176–L1193）：
```ts
      this.pendingFigure = {
        figId,
        kind,
        language,
        ...(angle !== undefined ? { angle } : {}),
        methodLevel,
        sessionId: this.targetSessionId,
        stagedAt: Date.now(),
        ...(usageStart !== undefined ? { usageStart } : {}),
        index,
      }
      // One-shot staging: clear after 30 minutes even if the agent never
      // answers ...
      setTimeout(() => {
        if (this.pendingFigure?.figId === figId) this.pendingFigure = null
      }, 30 * 60 * 1000)
```
改为：
```ts
      this.pendingFigures.set(figId, {
        figId,
        kind,
        language,
        ...(angle !== undefined ? { angle } : {}),
        methodLevel,
        sessionId: this.targetSessionId,
        stagedAt: Date.now(),
        ...(usageStart !== undefined ? { usageStart } : {}),
        index,
      })
      // One-shot staging: clear after 30 minutes even if the agent never
      // answers (a later ordinary chat reply must not be misparsed — the
      // figId match is the real gate; the TTL is only defensive cleanup,
      // and it must outlast a slow agent turn in the session).
      setTimeout(() => {
        this.pendingFigures.delete(figId)
      }, 30 * 60 * 1000)
```

#### B3. `remoteDynamicFigurePrompt` 登记处（L1247–L1259）

现状：
```ts
      this.pendingFigure = {
        figId,
        kind,
        language,
        sessionId: this.targetSessionId,
        stagedAt: Date.now(),
        ...(usageStart !== undefined ? { usageStart } : {}),
        index,
        dynamic: { kind, targetKey },
      }
      setTimeout(() => {
        if (this.pendingFigure?.figId === figId) this.pendingFigure = null
      }, 30 * 60 * 1000)
```
改为：
```ts
      this.pendingFigures.set(figId, {
        figId,
        kind,
        language,
        sessionId: this.targetSessionId,
        stagedAt: Date.now(),
        ...(usageStart !== undefined ? { usageStart } : {}),
        index,
        dynamic: { kind, targetKey },
      })
      setTimeout(() => {
        this.pendingFigures.delete(figId)
      }, 30 * 60 * 1000)
```

#### B4. `session/event` 监听器匹配处（L2005–L2045）

现状（L2005–L2045）：
```ts
      const stagedFigure = this.pendingFigure
      if (stagedFigure !== null) {
        const parsed = extractFigureJson(answer, stagedFigure.figId)
        if (parsed !== null) {
          this.pendingFigure = null
          ...
```
改为「遍历 map 找 figId 命中者」：
```ts
      // Find the staged figure whose figId appears in this answer. Multiple
      // figures may be queued (one per tab / drill-down); each answer matches
      // only its own figId, so a queued figure never steals another's output.
      let stagedFigure: PendingFigure | null = null
      for (const pending of this.pendingFigures.values()) {
        if (extractFigureJson(answer, pending.figId) !== null) {
          stagedFigure = pending
          break
        }
      }
      if (stagedFigure !== null) {
        this.pendingFigures.delete(stagedFigure.figId)
        // (后续 recordSessionUsage / write cache 逻辑不变，见下)
        ...
```
其余 `recordSessionUsage(...)`、`root = session.header.cwd ?? this.rootFromPolicy()`、`writeFigureCache / writeDynamicFigureCache` 分支**保持不变**（只把命中前删除单槽的动作换成 `delete(stagedFigure.figId)`）。

> 说明：`extractFigureJson(answer, figId)` 会对每个 pending 图各解析一次 JSON；队列通常 0–1 个，代价可忽略。

#### B5. 新增只读 remote `figurePending`（建议插在 `remoteDynamicFigurePrompt` 之后，约 L1264 之后）

```ts
  /**
   * Read-only snapshot of staged session-driven figures for the CURRENT
   * workspace root (🤖 AI 生成 / 动态下钻 still awaiting the agent's answer).
   * The desk calls this on mount to restore an in-flight generation that
   * survived a page close (the session turn keeps running host-side).
   * @returns pending figures for this root, or null when none.
   */
  @Remote('figurePending')
  async remoteFigurePending(): Promise<Array<{
    figId: string
    kind: SessionFigureKind | DynamicFigureKind
    stagedAt: number
    sessionId: string | null
    dynamic?: { kind: DynamicFigureKind; targetKey: string }
  }> | null> {
    const root = this.resolveRoot()
    if (typeof root !== 'string') return null
    const out: Array<{
      figId: string
      kind: SessionFigureKind | DynamicFigureKind
      stagedAt: number
      sessionId: string | null
      dynamic?: { kind: DynamicFigureKind; targetKey: string }
    }> = []
    for (const pending of this.pendingFigures.values()) {
      if (pending.index.root !== root) continue
      out.push({
        figId: pending.figId,
        kind: pending.kind,
        stagedAt: pending.stagedAt,
        sessionId: pending.sessionId,
        ...(pending.dynamic !== undefined ? { dynamic: pending.dynamic } : {}),
      })
    }
    return out.length === 0 ? null : out
  }
```
（`pending.index.root` 即 `CodeIndexResult.root` 绝对工作区根，无需给 `PendingFigure` 加字段。）

---

### 客户端 `packages/client-arch-lens/src/client/`

#### C0. 新增类型/辅助模块 `client/session-events.ts`

内容（结构性最小面，不 import harness 内部包名，规避宿主侧类型遮蔽）：
```ts
/** Structural mirror of the session controller's client event feed. */
export interface ClientSessionEvent {
  type: string
  data?: { message?: { content?: Array<{ type?: string; text?: string }> } }
}
export interface ClientSessionEventEntry {
  type: 'event' | 'chunks'
  event: ClientSessionEvent
}
export interface ClientSessionEventChange {
  kind: 'replace' | 'prepend' | 'append'
  entries: readonly ClientSessionEventEntry[]
}
export interface ClientSessionEventWindow {
  entries: readonly ClientSessionEventEntry[]
  hasMore: boolean
  revision: number
  change: ClientSessionEventChange
}
export interface ClientSessionEventSource {
  getSnapshot(): ClientSessionEventWindow
  subscribe(listener: () => void): () => void
}

/** 抽出一段 assistant/message 的纯文本（用于 figId 匹配）。 */
export function eventAnswerText(entry: ClientSessionEventEntry): string {
  if (entry.type !== 'event' || entry.event.type !== 'assistant/message') return ''
  let text = ''
  for (const block of entry.event.data?.message?.content ?? []) {
    if (block.type === 'text') text += block.text ?? ''
  }
  return text
}
```

#### C1. `client/index.ts`：扩 `SessionControllerFace` 与 `BotInjected`

- L81–L91 `SessionControllerFace.binding` 的返回类型补 `eventSource`：
```ts
    session: { prompt(...): ...; cancel(): ... }
    eventSource: ClientSessionEventSource
```
- L60–L67 `BotInjected` 增一个成员：
```ts
  /** The target session's live event feed (getSnapshot + subscribe). */
  sessionEvents: (sessionId: string) => ClientSessionEventSource | undefined
```
- L116–L131 `inject: () => BotInjected` 工厂返回体补：
```ts
          sessionEvents: (sessionId: string) => {
            const binding = sessions?.binding(sessionId as SessionId)
            return binding?.eventSource
          },
```
（`sessions` 变量已在工厂内 `ctx.get('sessions')` 得到。）

#### C2. `client/floating-bot.tsx`：把 `sessionEvents` 传给 ArchView

- L161–L171 `h(ArchView, {...})` 增加一行：
```ts
                sessionEvents: props.sessionEvents,
```

#### C3. `client/remote.ts`：`ArchLensRemote` 接口补声明（约 L73 之后）

```ts
  figurePending(): Promise<RemoteResult<Array<{ figId: string; kind: string; stagedAt: number; sessionId: string | null; dynamic?: { kind: string; targetKey: string } }> | null | { error: string }>>
```

#### C4. `client/arch-view.tsx`：props 与状态

- L225–L233 `ArchViewProps` 增：
```ts
  sessionEvents: (sessionId: string) => import('./session-events.ts').ClientSessionEventSource | undefined
```
（或顶部 import 该类型后写 `sessionEvents: (sessionId: string) => ClientSessionEventSource | undefined`。）
- 顶部 import 补 `import { eventAnswerText, type ClientSessionEventSource, type ClientSessionEventChange } from './session-events.ts'`。
- L383 附近新增一个驱动订阅的响应式状态：
```ts
  const [pendingFigId, setPendingFigId] = useState<string | null>(null)
```
（`pendingFigureRef` 保留给 running-flip / stopGeneration / 轮询去除后的既有逻辑用；`pendingFigId` 只用来让事件订阅 effect 在 figId 变化时重挂。）

#### C5. 抽出 `finishStagedFigure()`（把 running-flip 里 L820–L838 的 refetch 逻辑收拢）

新增（放在 `pendingFigureRef` 声明附近，L884 之前）：
```ts
  const finishStagedFigure = (): boolean => {
    const staged = pendingFigureRef.current
    if (staged === null) return false
    pendingFigureRef.current = null
    setPendingFigId(null)
    setAiGenRunning(false)
    setNotice(ui(language, 'figureDone'))
    const refetch = (): void => {
      if (staged.kind === 'concepts') { setConceptTreeState(null); ensureConcepts(true) }
      else if (staged.kind === 'seq') { setSequenceCodeState(null); setSequenceFlowState(null); setCallGraphState(null); setCallGraphError(null); loadSequences(generationRef.current) }
      else if (staged.kind === 'flow') { setFlowMap({}); ensureFlow(generationRef.current, flowView, true) }
      else if (staged.kind === 'interaction') { setEventsState(null); setEventsMethodsState(null); ensureEvents(true) }
      else { fetchCore() }
    }
    window.setTimeout(refetch, 400)
    return true
  }
```

#### C6. running-flip effect 内（L820–L838）改为调用 `finishStagedFigure()`

现状：
```ts
      const stagedFigure = pendingFigureRef.current
      if (stagedFigure !== null) {
        pendingFigureRef.current = null
        setAiGenRunning(false)
        setNotice(ui(language, 'figureDone'))
        ...window.setTimeout(refetch, 400)
        return
      }
```
改为：
```ts
      if (finishStagedFigure()) return
```
（其余 dynamic/draw/explain 分支不动。）

#### C7. 新增事件订阅 effect（放在 running-flip effect 之后，L879 之后）

```ts
  // 事件驱动刷新（替代 2s 轮询）：订阅目标会话的事件流，当 assistant/message
  // 文本里出现当前 staged figId 时，说明 agent 已回图且宿主已写缓存 —— 精确
  // 触发一次重拉（留 200ms 让异步缓存写入落地）。figId 变更或会话切换时重挂。
  useEffect(() => {
    if (sessionId === null || pendingFigId === null) return
    const source = props.sessionEvents(sessionId)
    if (source === undefined) return
    let settled = false
    const unsubscribe = source.subscribe(() => {
      if (settled) return
      const change = source.getSnapshot().change
      if (change.kind !== 'append') return
      for (const entry of change.entries) {
        if (eventAnswerText(entry).includes(pendingFigId)) {
          settled = true
          window.setTimeout(() => { finishStagedFigure() }, 200)
          return
        }
      }
    })
    return unsubscribe
  }, [archLens, sessionId, pendingFigId])
```
> 依赖 `props` 需解构稳定引用，避免 effect 每次渲染重挂：将 `sessionEvents`、`send`、`cancel`、`useSessions` 在 `const { ... } = props` 处解构（现有 L239 只解构了 `archLens, config, sessionId`，补上 `sessionEvents`）。

#### C8. `aiGenerate`：删 2s 轮询，改为置 `pendingFigId`

- L1595 之后（`pendingFigureRef.current = {...}`）追加：
```ts
      setPendingFigId(result.figId)
```
- 删除 L1596–L1615 的 `poll` / `setInterval` / `setTimeout(clearInterval, 300000)` 整段兜底轮询。
- `props.send(result.prompt)` 失败分支（L1618–L1627）里，`pendingFigureRef.current = null` 处追加 `setPendingFigId(null)`。

#### C9. `stopGeneration`（L1647–L1686）：清理时同步 `pendingFigId`

L1659 `pendingFigureRef.current = null` 之后追加：
```ts
    setPendingFigId(null)
```

#### C10. 重开恢复 effect（新增，放 mount 区域 L728–L754 附近）

```ts
  // 重开恢复：宿主侧挂起的会话出图在关页后仍存活（figurePending 只读查询）。
  // 命中的话恢复「正在生成…」+ pendingFigId，事件订阅 effect 随后接住回答并重拉。
  useEffect(() => {
    if (sessionId === null) return
    let cancelled = false
    void directRemote<Array<{ figId: string; kind: string; stagedAt: number; sessionId: string | null; dynamic?: { kind: string; targetKey: string } }> | null | { error: string }>('figurePending', {}).then(result => {
      if (cancelled) return
      if (result === null || 'error' in result) return
      // 只恢复本会话的实体图；动态下钻(dynamic)由用户再次 hover 触发（每目标有缓存）。
      const mine = result.find(p => p.sessionId === sessionId && p.dynamic === undefined)
        ?? result.find(p => p.dynamic === undefined)
      if (mine === undefined) return
      pendingFigureRef.current = { figId: mine.figId, kind: mine.kind }
      setPendingFigId(mine.figId)
      setAiGenRunning(true)
      setNotice(uiT(language, 'figureResuming'))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [archLens, sessionId, language])
```
- i18n.ts 增一条文案 `figureResuming`（中/英各一条），或复用现有 `figureSent`。

---

## 明确不做 / 暂缓（避免制造新债）

- **T4「会话回合接入 generationStatus 槽」暂缓**：`generationStatus/generationStatusNext` 目前无任何 UI 消费；现在只接线、没有消费方，反而会引入「孤儿 staged 图让 active 永久为 true」的新不一致。等真正要做 ⚙️ 生成过程 box 时，连同 TTL 回调 `endGenerationStage` 一起接。
- **缓存写失败静默丢图（pro 风险 #3）** 本次不动：属另一个缺陷，需单独决定「重试 + 面板报错」策略后再改。

## 校验点（改完自测）

1. 连点两个 tab 的「AI 生成」→ 两个 figId 都在 map 里，各自回答各自命中，不再互相覆盖。
2. 生成中关页 → 重开 → 面板恢复「正在生成…」，回答后当前 tab 自动出图。
3. DevTools 网络面板：生成期间**无** 2s 周期的重复图读取（事件驱动，仅回答时一次重拉）。
4. 卸载/切会话无残留 interval（2s 轮询已删；订阅 effect 返回 unsubscribe 清理）。
