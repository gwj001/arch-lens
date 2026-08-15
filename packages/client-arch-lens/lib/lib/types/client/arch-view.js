/**
 * Arch Lens main view: unit tabs over the backend Remote, component/event
 * detail popups, same-page chat projection, and the notes panel. This is the
 * single registered conversation.view entry; units are plain tab bodies.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/arch-view
 */
import { createElement as h, useEffect, useState } from 'react';
import { Catalog } from "./catalog.js";
import { ChatProjection } from "./chat-projection.js";
import { InsightsPanel } from "./insights-panel.js";
import { NotesPanel } from "./notes-panel.js";
import { PromptEditor } from "./prompt-editor.js";
import { componentQuestion, dataQuestion, DEFAULT_EXPLAIN_STYLE, DEFAULT_OVERVIEW_PROMPT, eventQuestion, overviewQuestion, } from "./explain.js";
import { CONCEPT_TREE, CORE_EVENTS, SEQUENCE } from "./curated.js";
import { ConceptGraph, InteractionGraph, SequenceGraph } from "./graphs.js";
import { MermaidView } from "./mermaid-view.js";
import { unwrapRemote } from "./remote.js";
import css from './arch-view.module.css';
/**
 * The Arch Lens conversation view entry component.
 */
export function ArchView(props) {
    const { archLens, config } = props;
    const input = props.inputActions;
    const [promptConfig, setPromptConfig] = useState({});
    const [editorOpen, setEditorOpen] = useState(false);
    const explainStyle = promptConfig.explainStyle ?? config.explainStyle ?? DEFAULT_EXPLAIN_STYLE;
    const [tab, setTab] = useState('concepts');
    const [graph, setGraph] = useState(null);
    const [error, setError] = useState(null);
    const [selection, setSelection] = useState(null);
    const [detail, setDetail] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailTimeout, setDetailTimeout] = useState(false);
    const [detailAttempt, setDetailAttempt] = useState(0);
    const [followup, setFollowup] = useState('');
    const [notice, setNotice] = useState(null);
    const [expanded, setExpanded] = useState(['cordis', 'core', 'sandbox']);
    const [notes, setNotes] = useState(null);
    const [mermaidDeps, setMermaidDeps] = useState(null);
    const [mermaidEr, setMermaidEr] = useState(null);
    const [insights, setInsights] = useState(null);
    const [codeFirst, setCodeFirst] = useState(false);
    useEffect(() => {
        let alive = true;
        void unwrapRemote(archLens.graph()).then(result => {
            if (!alive)
                return;
            if ('error' in result)
                setError(result.error);
            else
                setGraph(result);
        }).catch((reason) => { if (alive)
            setError(String(reason)); });
        void unwrapRemote(archLens.notes()).then(result => { if (alive)
            setNotes(result); }).catch(() => { });
        void unwrapRemote(archLens.promptConfig()).then(result => {
            if (alive)
                setPromptConfig(result.config);
        }).catch(() => { });
        void unwrapRemote(archLens.mermaidDeps()).then(result => {
            if (alive && !('error' in result))
                setMermaidDeps(result.source);
        }).catch(() => { });
        void unwrapRemote(archLens.mermaidEr()).then(result => {
            if (alive && !('error' in result))
                setMermaidEr(result.source);
        }).catch(() => { });
        void unwrapRemote(archLens.analyze()).then(result => {
            if (alive && !('error' in result))
                setInsights(result);
        }).catch(() => { });
        return () => { alive = false; };
    }, [archLens]);
    useEffect(() => {
        if (selection === null || selection.kind !== 'pkg') {
            setDetail(null);
            setDetailLoading(false);
            return;
        }
        setDetailLoading(true);
        setDetailTimeout(false);
        let alive = true;
        // RPC rides the session channel, so a running agent turn can queue the
        // request; surface that as a timeout with a retry instead of an endless
        // spinner.
        const timeout = window.setTimeout(() => {
            if (!alive)
                return;
            setDetailLoading(false);
            setDetailTimeout(true);
        }, 20000);
        void unwrapRemote(archLens.component({ id: selection.id })).then(result => {
            if (!alive)
                return;
            setDetailLoading(false);
            if ('error' in result)
                setDetail(null);
            else
                setDetail(result);
        }).catch((reason) => {
            if (alive) {
                setDetailLoading(false);
                setDetail(null);
                setError(String(reason));
            }
        }).finally(() => { window.clearTimeout(timeout); });
        return () => { alive = false; window.clearTimeout(timeout); };
    }, [selection, archLens, detailAttempt]);
    const chatNodeCount = props.useSession(snapshot => snapshot.nodes.length);
    useEffect(() => {
        if (chatNodeCount === 0)
            return;
        let alive = true;
        void unwrapRemote(archLens.notes()).then(result => { if (alive)
            setNotes(result); }).catch(() => { });
        return () => { alive = false; };
    }, [chatNodeCount, archLens]);
    const submitQuestion = (text, target) => {
        if (input === undefined) {
            setNotice('inputActions unavailable');
            return;
        }
        input.setDraft(text);
        input.submit();
        void unwrapRemote(archLens.notePending({ target, text, sessionId: String(props.sessionId) })).catch(() => { });
        setNotice('已发送讲解请求，回答完成后将自动记入架构笔记');
    };
    const explainPkg = (node) => {
        const files = detail?.files.map(file => file.name) ?? node.files;
        submitQuestion(componentQuestion(node.short, node.group, node.blurb, files, explainStyle), `组件 ${node.short}`);
    };
    const explainEvent = (eventName) => {
        const event = CORE_EVENTS.find(candidate => candidate.event === eventName);
        if (event === undefined)
            return;
        submitQuestion(eventQuestion(event.event, event.mode, event.producers, event.consumers, event.note, explainStyle), `事件 ${event.event}`);
    };
    const explainData = (title, data) => {
        submitQuestion(dataQuestion(title, data, explainStyle), `图 ${title}`);
    };
    const explainAll = () => {
        if (graph === null)
            return;
        submitQuestion(overviewQuestion(graph, promptConfig.overviewPrompt ?? config.overviewPrompt ?? DEFAULT_OVERVIEW_PROMPT), '整体架构');
    };
    const refresh = () => {
        setGraph(null);
        setError(null);
        void unwrapRemote(archLens.refresh()).then(result => {
            if ('error' in result)
                setError(result.error);
            else
                setGraph(result);
        }).catch((reason) => setError(String(reason)));
    };
    const toggleExpand = (id) => {
        setExpanded(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id]);
    };
    const tabOrder = [
        { id: 'concepts', label: '概念层级图' },
        { id: 'seq', label: '时序图' },
        { id: 'interaction', label: '核心交互图' },
        { id: 'deps', label: '依赖图' },
        { id: 'er', label: 'ER 图' },
        { id: 'catalog', label: '包目录' },
    ];
    const header = h('div', { className: css.header }, h('span', { className: css.title }, '🧭 架构学习台'), tabOrder.map(unit => h('button', {
        key: unit.id,
        className: `${css.tab} ${tab === unit.id ? css.tabActive : ''}`,
        onClick: () => setTab(unit.id),
    }, unit.label)), h('span', { className: css.spacer }), h('button', { className: `${css.btn} ${codeFirst ? css.btnPrimary : ''}`, onClick: () => setCodeFirst(value => !value) }, '🔍 代码解析'), h('button', { className: css.btn, onClick: explainAll }, '💡 全貌预讲解'), h('button', { className: css.btn, onClick: () => setEditorOpen(true) }, '✏️ 提示词'), h('button', { className: css.btn, onClick: refresh }, '↻ 重新扫描'));
    let body;
    if (error !== null) {
        body = h('div', { className: css.error }, `加载失败：${error}`);
    }
    else if (graph === null) {
        body = h('div', { className: css.loading }, '正在扫描 packages/*/* …');
    }
    else {
        const activeTip = (() => {
            switch (tab) {
                case 'concepts': return '概念层级图：点击概念节点展开/收起，点击包节点查看详情';
                case 'seq': return '时序图：一次完整 turn 的消息流（策展数据）';
                case 'interaction': return '核心交互图：生产者 → 事件 → 消费者，点击事件节点查看详情';
                case 'deps': return '依赖图（Mermaid）：包间 peerDependencies 关系';
                case 'er': return 'ER 图（Mermaid）：包关系实体视图';
                default: return `包目录 # 职责：${graph.nodes.length} 个包，点击任意一行查看详情并 AI 讲解`;
            }
        })();
        const explain = (() => {
            switch (tab) {
                case 'concepts': return () => explainData('概念层级图', CONCEPT_TREE);
                case 'seq': return () => explainData('turn 时序图', SEQUENCE);
                case 'interaction': return () => explainData('核心交互图', CORE_EVENTS);
                case 'deps': return () => explainData('依赖图', mermaidDeps ?? '');
                case 'er': return () => explainData('ER 图', mermaidEr ?? '');
                default: return () => explainData('包目录', graph.nodes.map(node => ({ path: `src/${node.group}/${node.short}`, duty: node.blurb })));
            }
        })();
        const unitBody = (() => {
            switch (tab) {
                case 'concepts':
                    return h(ConceptGraph, {
                        graph,
                        conceptTree: CONCEPT_TREE,
                        expanded,
                        selectedId: selection !== null && selection.kind === 'pkg' ? selection.id : null,
                        onToggle: toggleExpand,
                        onSelectPkg: id => setSelection({ kind: 'pkg', id }),
                    });
                case 'seq':
                    return h(SequenceGraph, { sequence: SEQUENCE });
                case 'interaction':
                    return h(InteractionGraph, { events: CORE_EVENTS, onSelectEvent: id => setSelection({ kind: 'event', id }) });
                case 'deps':
                    return mermaidDeps !== null ? h(MermaidView, { source: mermaidDeps }) : h('div', { className: css.loading }, '生成依赖图…');
                case 'er':
                    return mermaidEr !== null ? h(MermaidView, { source: mermaidEr }) : h('div', { className: css.loading }, '生成 ER 图…');
                default:
                    return h(Catalog, { graph, onSelectPkg: id => setSelection({ kind: 'pkg', id }) });
            }
        })();
        body = h('div', { className: css.pane }, h('div', { className: css.tip }, h('span', null, activeTip), h('span', { className: css.spacer }), h('button', { className: css.btn, onClick: explain }, `🤖 讲解此${tab === 'catalog' ? '目录' : '图'}`)), h('div', { className: css.body }, unitBody), h(ChatProjection, { useSession: props.useSession }), h(NotesPanel, { notes }));
    }
    const detailNode = graph !== null && selection !== null && selection.kind === 'pkg'
        ? graph.nodes.find(node => node.id === selection.id)
        : undefined;
    let overlay = null;
    if (detailNode !== undefined) {
        let panelBody;
        if (detailLoading) {
            panelBody = h('div', null, h('div', { className: css.loading }, '读取组件详情…（若会话正在处理其他消息，请求可能在排队，可稍候或点击 ✕ 关闭）'), h('div', { className: css.section }, h('button', { className: css.btn, onClick: () => setSelection(null) }, '✕ 取消')));
        }
        else if (detailTimeout) {
            panelBody = h('div', null, h('div', { className: css.error }, '读取超时：详情请求未在 20 秒内返回。可能原因：会话正在生成回答（RPC 排队），或首次仓库扫描较慢。'), h('div', { className: css.section }, h('button', { className: `${css.btn} ${css.btnPrimary}`, onClick: () => setDetailAttempt(value => value + 1) }, '↻ 重试'), h('button', { className: css.btn, onClick: () => setSelection(null) }, '✕ 关闭')));
        }
        else if (detail === null) {
            panelBody = h('div', { className: css.error }, '详情读取失败');
        }
        else {
            panelBody = h('div', null, detail.blurb !== '' ? h('p', { className: css.blurb }, detail.blurb) : null, h('div', { className: css.section }, h('div', { className: css.sectionTitle }, '核心文件索引'), h('ul', { className: css.files }, detail.files.map(file => h('li', { key: file.name }, h('code', null, file.name), file.role !== '' ? h('span', { className: css.role }, file.role) : null)))), h('div', { className: css.section }, h('div', { className: css.sectionTitle }, `依赖 → ${detail.deps.length > 0 ? detail.deps.join(', ') : '（无）'} ｜ 被依赖 ← ${detail.dependents.length > 0 ? detail.dependents.join(', ') : '（无）'}`)), detail.keyLines.length > 0
                ? h('div', { className: css.section }, h('div', { className: css.sectionTitle }, '关键注册点（浓缩）'), h('pre', { className: css.code }, detail.keyLines.join('\n')))
                : null, detail.snippet !== ''
                ? h('div', { className: css.section }, h('div', { className: css.sectionTitle }, '入口代码（浓缩）'), h('pre', { className: `${css.code} ${css.codeScroll}` }, detail.snippet))
                : null, h('div', { className: css.section }, h('button', { className: `${css.btn} ${css.btnPrimary}`, onClick: () => explainPkg(detailNode) }, '🤖 AI 讲解此组件'), h('div', { className: css.followup }, h('input', {
                className: css.input,
                placeholder: '针对此组件的追问，回复显示在下方',
                value: followup,
                onChange: event => setFollowup(event.target.value),
                onKeyDown: event => {
                    if (event.key === 'Enter') {
                        if (followup.trim() !== '') {
                            submitQuestion(`（针对组件 ${detailNode.short}）${followup.trim()}`, `组件 ${detailNode.short}`);
                            setFollowup('');
                        }
                    }
                },
            }), h('button', {
                className: css.btn,
                onClick: () => {
                    if (followup.trim() === '')
                        return;
                    submitQuestion(`（针对组件 ${detailNode.short}）${followup.trim()}`, `组件 ${detailNode.short}`);
                    setFollowup('');
                },
            }, '发送'))), notice !== null ? h('div', { className: css.notice }, notice) : null, codeFirst
                ? h(InsightsPanel, { insight: insights?.find(item => item.id === detailNode.short) })
                : null, h(ChatProjection, { useSession: props.useSession }));
        }
        overlay = h('div', { className: css.overlay, onClick: () => setSelection(null) }, h('div', { className: css.panel, onClick: (event) => event.stopPropagation() }, h('div', { className: css.panelHead }, h('span', { className: css.panelTitle }, detailNode.short), h('span', { className: css.badge }, detailNode.group), h('span', { className: css.spacer }), h('button', { className: css.btn, onClick: () => setSelection(null) }, '✕')), panelBody));
    }
    else if (selection !== null && selection.kind === 'event') {
        const event = CORE_EVENTS.find(candidate => candidate.event === selection.id);
        if (event !== undefined) {
            overlay = h('div', { className: css.overlay, onClick: () => setSelection(null) }, h('div', { className: css.panel, onClick: (eventClick) => eventClick.stopPropagation() }, h('div', { className: css.panelHead }, h('span', { className: css.panelTitle }, event.event), h('span', { className: `${css.badge} ${css.badgeEvent}` }, event.mode), h('span', { className: css.spacer }), h('button', { className: css.btn, onClick: () => setSelection(null) }, '✕')), h('p', { className: css.blurb }, event.note), h('div', { className: css.section }, h('div', { className: css.sectionTitle }, `生产者 → ${event.producers.join(', ')}`), h('div', { className: css.sectionTitle }, `消费者 ← ${event.consumers.join(', ')}`)), h('div', { className: css.section }, h('button', { className: `${css.btn} ${css.btnPrimary}`, onClick: () => explainEvent(event.event) }, '🤖 AI 讲解此事件'), h('div', { className: css.followup }, h('input', {
                className: css.input,
                placeholder: '追问',
                value: followup,
                onChange: inputEvent => setFollowup(inputEvent.target.value),
                onKeyDown: inputEvent => {
                    if (inputEvent.key === 'Enter' && followup.trim() !== '') {
                        submitQuestion(`（针对事件 ${event.event}）${followup.trim()}`, `事件 ${event.event}`);
                        setFollowup('');
                    }
                },
            }), h('button', {
                className: css.btn,
                onClick: () => {
                    if (followup.trim() === '')
                        return;
                    submitQuestion(`（针对事件 ${event.event}）${followup.trim()}`, `事件 ${event.event}`);
                    setFollowup('');
                },
            }, '发送'))), notice !== null ? h('div', { className: css.notice }, notice) : null, h(ChatProjection, { useSession: props.useSession })));
        }
    }
    return h('div', { className: css.root }, header, h('div', { className: css.body }, body), editorOpen
        ? h(PromptEditor, {
            archLens,
            config: promptConfig,
            onSave: next => { setPromptConfig(next); setEditorOpen(false); },
            onClose: () => setEditorOpen(false),
        })
        : null, overlay);
}
//# sourceMappingURL=arch-view.js.map