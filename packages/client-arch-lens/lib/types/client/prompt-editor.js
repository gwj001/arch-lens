/**
 * Prompt-config editor for the Arch Lens desk: edits the persisted overview
 * prompt and unit explain style, saved back through the backend Remote. The
 * editor always shows the EFFECTIVE prompt — defaults are filled in when no
 * override exists, so what you see is exactly what will be used.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/prompt-editor
 */
import { createElement as h, useEffect, useState } from 'react';
import { DEFAULT_EXPLAIN_STYLE, DEFAULT_LANGUAGE, DEFAULT_OVERVIEW_PROMPT } from "./explain.js";
import { ui } from "./i18n.js";
import { unwrapRemote } from "./remote.js";
import css from './prompt-editor.module.css';
/** Edit and persist the explain prompts. The editor body is the effective prompt. */
export function PromptEditor(props) {
    const { archLens, config, onSave, onClose } = props;
    const [overview, setOverview] = useState(config.overviewPrompt ?? DEFAULT_OVERVIEW_PROMPT);
    const [style, setStyle] = useState(config.explainStyle ?? DEFAULT_EXPLAIN_STYLE);
    const [language, setLanguage] = useState(config.language ?? DEFAULT_LANGUAGE);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    useEffect(() => {
        setOverview(config.overviewPrompt ?? DEFAULT_OVERVIEW_PROMPT);
        setStyle(config.explainStyle ?? DEFAULT_EXPLAIN_STYLE);
        setLanguage(config.language ?? DEFAULT_LANGUAGE);
    }, [config]);
    const save = () => {
        setSaving(true);
        setSaved(false);
        const next = {};
        if (overview.trim() !== '')
            next.overviewPrompt = overview.trim();
        if (style.trim() !== '')
            next.explainStyle = style.trim();
        if (language.trim() !== '')
            next.language = language.trim();
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
    return h('div', { className: css.editor }, h('div', { className: css.mask, onClick: onClose }), h('div', { className: css.card }, h('div', { className: css.head }, h('span', { className: css.title }, ui(language, 'editorTitle')), h('span', { className: css.spacer }), h('button', { className: css.btn, onClick: onClose }, '✕')), h('div', { className: css.field }, h('div', { className: css.label }, ui(language, 'editorOverviewLabel')), h('textarea', {
        className: css.textarea,
        rows: 12,
        value: overview,
        onChange: (event) => setOverview(event.target.value),
    })), h('div', { className: css.field }, h('div', { className: css.label }, ui(language, 'editorLanguageLabel')), h('input', {
        className: css.input,
        value: language,
        placeholder: DEFAULT_LANGUAGE,
        onChange: (event) => setLanguage(event.target.value),
    })), h('div', { className: css.field }, h('div', { className: css.label }, ui(language, 'editorStyleLabel')), h('textarea', {
        className: css.textarea,
        rows: 6,
        value: style,
        onChange: (event) => setStyle(event.target.value),
    })), h('div', { className: css.actions }, h('button', { className: `${css.btn} ${css.primary}`, onClick: save, disabled: saving }, saving ? ui(language, 'editorSaving') : ui(language, 'editorSave')), h('button', { className: css.btn, onClick: () => {
            setOverview(DEFAULT_OVERVIEW_PROMPT);
            setStyle(DEFAULT_EXPLAIN_STYLE);
        } }, ui(language, 'editorReset')), saved ? h('span', { className: css.saved }, ui(language, 'editorSaved')) : null)));
}
//# sourceMappingURL=prompt-editor.js.map