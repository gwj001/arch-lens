/**
 * Flow-diagram generation viewpoints: the prompt text that turns the flow
 * figure from a free-form "draw something" into a learnable diagram with a
 * chosen storytelling angle. Shared by the shared-analysis-profile figure
 * call (analysis.ts) and the flow chain's induction fallback (flow.ts) so a
 * regenerate and a cold start always ask for the same structure.
 *
 * The rules are PROJECT-NEUTRAL: stage names, data products and event terms
 * are always derived from the analyzed project's own index summary — the
 * examples below only demonstrate STYLE (two-line labels, decision diamonds,
 * labeled edges), never a fixed vocabulary.
 * @module @deepseek-ai/dsh-arch-lens-backend/src/flow-angle
 */
/** Short user-facing label per angle (used in prompts and the client UI). */
export const FLOW_ANGLE_LABEL = {
    event: '事件驱动',
    pipeline: '数据管道',
};
/** Angle-specific instruction: what story the diagram must tell. */
export function flowAngleRule(angle) {
    switch (angle) {
        case 'event':
            return '- flow 采用「事件驱动」视角：节点是事件或触发点（用户操作、系统事件、内部钩子等，按项目实际归纳），边标注触发/消费关系，回答「什么触发了什么」；触发关系的命名沿用项目自身的术语，不要硬套外部词汇；';
        default:
            return '- flow 采用「数据管道」视角：节点是数据产物（按项目实际流转归纳：输入 → 中间产物 → 最终输出），边标注转换动作（采集/解析/构建/写入/渲染等，按项目实际），回答「数据如何流转」；';
    }
}
/**
 * The style bar shared by every angle — structure plus the information
 * density of hand-written architecture diagrams: two-line labels (action +
 * mechanism), diamond decision nodes with 是/否 branches, stage subgraphs
 * with a duty line, and a compact few-shot example the model must match in
 * density. The example is a NEUTRAL style template: the model must replace
 * its content with the analyzed project's own facts, never copy the stage
 * names or node labels.
 */
export const FLOW_STYLE_RULES = [
    '- flow 用 subgraph 按【阶段】分组（阶段名按项目的实际运行阶段归纳，如 入口/请求 → 校验/解析 → 处理/调度 → 存储/输出 → 响应/呈现，不要照搬示例阶段名），不要按包分组；每个阶段 2-4 个节点；',
    '- flow 节点总数 ≤ 16；节点用「动作 + 机制」两行标签：`N["动作<br/>（机制/对象/依据）"]`——第一行是做什么，第二行括注机制、关键对象或依据（只能来自摘要），禁止只写裸函数名/类名；',
    '- flow 的分支点用菱形决策节点 `D{"条件？"}`，出边必须标「是」/「否」并说明后果（如 `D -->|"是：命中"| N`）；',
    '- flow 的 subgraph 标题也用两行：`subgraph s1["阶段名<br/>（阶段职责）"]`；',
    '- flow 每条边必须有动作标签（如 请求/校验/写入/返回 或 是/否，按项目实际动作命名），说明两个节点之间发生了什么；',
    '- flow 边标签只用纯动词短语，禁止半角括号、分号等符号；',
    '- flow 必须是单条主线：有明确开始与结束，无环、无交叉连线，最多一个分支；',
    '- flow 风格参考（只学风格与信息密度，节点/阶段内容必须换成该项目摘要里的事实）：\n```\nflowchart TD\n  subgraph s1["入口<br/>（接收与校验）"]\n    A["接收请求<br/>（HTTP 入口）"]\n    B{"参数有效？"}\n  end\n  A -->|"请求"| B\n  B -->|"否：拒绝"| E["返回错误<br/>（错误码）"]\n  B -->|"是：处理"| D["业务处理<br/>（服务层）"]\n  D -->|"写入"| F["持久化<br/>（存储层）"]\n  F -->|"完成"| G["返回响应<br/>（结果体）"]\n```',
].join('\n');
/**
 * The full rule set for one angle: its viewpoint plus the shared style bar.
 * Used by the chain induction (flow.ts); the profile figures call
 * (analysis.ts) emits the shared style block ONCE for both angles.
 */
export function flowAngleRules(angle) {
    return [flowAngleRule(angle), FLOW_STYLE_RULES].join('\n');
}
/**
 * Repair mermaid syntax the LLM tends to break: half-width parentheses /
 * semicolons inside edge labels (`-->|触发(emit)|`) are rejected by the
 * flowchart grammar (parse error at the `(`). They are replaced with their
 * full-width forms, preserving the semantics. Applied to every LLM-produced
 * flow source (profile figures, chain induction, doc transcodes) and to
 * cached/profile reads, so stale caches render again without a rescan.
 * @param source - mermaid flowchart source.
 * @returns the repaired source.
 */
export function sanitizeMermaid(source) {
    return source.replace(/(-\.->|-->|==>)\|([^|\n]*)\|/g, (_all, arrow, label) => {
        const clean = label.replace(/[();]/g, ch => ch === '(' ? '（' : ch === ')' ? '）' : '；');
        return `${arrow}|${clean}|`;
    });
}
//# sourceMappingURL=flow-angle.js.map