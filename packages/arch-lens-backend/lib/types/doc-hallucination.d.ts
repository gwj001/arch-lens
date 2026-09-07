/**
 * 生成式文档章节的幻觉门禁（V1 文档写路径）。
 *
 * 喂给章节 LLM 的事实是真实的（扫描图 / 代码索引）；本模块校验的是
 * 输出是否仍留在这些事实之内。它从不触碰事实、过期状态或模型——只做
 * 「散文 → 事实」的忠实度差异检查：编造的包名、虚构的文件路径、
 * 不存在（或方向画反）的调用边。纯函数、零 IO、零 LLM——与图渲染门禁
 * 同样的「产物过检才入库」纪律。
 *
 * 精确优先于召回：只检查高置信的引用形态（反引号 scoped 包名、带代码
 * 扩展名的路径、`| 调用方 | 被调用方 |` 表格）。裸标识符（函数名…）与
 * fenced 代码块永不标记——误报会打回一篇好章节，比漏报一处编造更伤。
 * @module @deepseek-ai/dsh-arch-lens-backend/src/doc-hallucination
 */
/** 每轮生成时一次性组装的权威实体集合。 */
export interface DocGroundTruth {
    /** 全部合法的包名形态（扫描图节点 id、索引 id、npm 名）。 */
    packages: ReadonlySet<string>;
    /** 工作区相对源码路径（已归一化：`/` 分隔、无 `./`）。 */
    files: ReadonlySet<string>;
    /** 真实的 import/调用边，键为 `from\0to`。 */
    edges: ReadonlySet<string>;
}
/** 散文里一处事实无法背书的引用。 */
export interface DocViolation {
    kind: 'package' | 'file' | 'edge';
    /** 违规 token，按原文原样记录。 */
    token: string;
    /** 人类可读的原因（会嵌入修复 prompt）。 */
    reason: string;
    /** 可低成本计算时给出最接近的真实实体（编辑距离 / 反向边）。 */
    suggestion?: string;
}
/**
 * 文本中被反引号包裹、且确实为真实包（与权威包集合求交）的包引用。
 * 与门禁校验使用的是同一套抽取逻辑。用作 deps 并集防御：散文引用了
 * 哪个真实包，该包就必须进入信封 `deps`，于是即使 prior 稿（或讲解）
 * 保留了作用域事实块之外的引用，该包的变动也必然让章节失效——
 * 「已删除的名字不再出现」只是 prompt 级契约，这里是确定性兜底。
 * @param text - 章节/讲解的 markdown。
 * @param truth - 权威包集合（与门禁同一快照）。
 * @returns 被引用的真实包（去重，按首次出现顺序）。
 */
export declare function citedPackages(text: string, truth: DocGroundTruth): string[];
/**
 * 校验一篇生成的章节正文是否落在权威事实集合内。
 * @param text - 章节 markdown（模型原样返回的内容）。
 * @param truth - 章节 prompt 所依据的事实（同一快照）。
 * @returns 违规列表（上限 MAX_VIOLATIONS）；为空 = 散文忠实可信。
 */
export declare function checkDocProse(text: string, truth: DocGroundTruth): DocViolation[];
/** 将违规格式化为修复 prompt 的输入（有上限，一行一条）。 */
export declare function formatViolations(violations: readonly DocViolation[]): string;
//# sourceMappingURL=doc-hallucination.d.ts.map