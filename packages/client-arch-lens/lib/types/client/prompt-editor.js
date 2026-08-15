/**
 * Prompt-config editor for the Arch Lens desk: edits the persisted overview
 * prompt and unit explain style, saved back through the backend Remote. The
 * editor always shows the EFFECTIVE prompt — defaults are filled in when no
 * override exists, so what you see is exactly what will be used.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/prompt-editor
 */
import { createElement as h, useEffect, useState } from 'react';
import { DEFAULT_EXPLAIN_STYLE, DEFAULT_OVERVIEW_PROMPT } from "./explain.js";
import { unwrapRemote } from "./remote.js";
import css from './prompt-editor.module.css';
/** Edit and persist the explain prompts. The editor body is the effective prompt. */
export function PromptEditor(props) {
    const { archLens, config, onSave, onClose } = props;
    const [overview, setOverview] = useState(config.overviewPrompt ?? DEFAULT_OVERVIEW_PROMPT);
    const [style, setStyle] = useState(config.explainStyle ?? DEFAULT_EXPLAIN_STYLE);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    useEffect(() => {
        setOverview(config.overviewPrompt ?? DEFAULT_OVERVIEW_PROMPT);
        setStyle(config.explainStyle ?? DEFAULT_EXPLAIN_STYLE);
    }, [config]);
    const save = () => {
        setSaving(true);
        setSaved(false);
        const next = {};
        if (overview.trim() !== '')
            next.overviewPrompt = overview.trim();
        if (style.trim() !== '')
            next.explainStyle = style.trim();
        void unwrapRemote(archLens.promptConfigSave(next)).then(result => {
            setSaving(false);
            if ('error' in result) {
                return;
            }
            onSave(result.config);
            setSaved(true);
        }).catch(() => {
            setSaving(false);
        });
    };
    return h('div', { className: css.editor }, h('div', { className: css.mask, onClick: onClose }), h('div', { className: css.card }, h('div', { className: css.head }, h('span', { className: css.title }, '✏️ 提示词编辑（保存在工作区 .arch-lens-prompts.json）'), h('span', { className: css.spacer }), h('button', { className: css.btn, onClick: onClose }, '✕')), h('div', { className: css.field }, h('div', { className: css.label }, '💡 全貌预讲解提示词（可用 {root} / {core} 占位符）'), h('textarea', {
        className: css.textarea,
        rows: 12,
        value: overview,
        onChange: (event) => setOverview(event.target.value),
    })), h('div', { className: css.field }, h('div', { className: css.label }, '📖 单元/组件讲解理念（EXPLAIN_STYLE）'), h('textarea', {
        className: css.textarea,
        rows: 6,
        value: style,
        onChange: (event) => setStyle(event.target.value),
    })), h('div', { className: css.actions }, h('button', { className: `${css.btn} ${css.primary}`, onClick: save, disabled: saving }, saving ? '保存中…' : '保存'), h('button', { className: css.btn, onClick: () => {
            setOverview(DEFAULT_OVERVIEW_PROMPT);
            setStyle(DEFAULT_EXPLAIN_STYLE);
        } }, '恢复默认'), saved ? h('span', { className: css.saved }, '✓ 已保存') : null)));
}
//# sourceMappingURL=prompt-editor.js.map