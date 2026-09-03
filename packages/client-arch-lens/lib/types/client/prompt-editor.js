/**
 * Prompt-config editor for the Arch Lens desk: edits the persisted overview
 * prompt and unit explain style, saved back through the backend Remote. A
 * mode switch chooses between "my prompts" (the saved overrides, editable)
 * and "default templates" (per-language built-ins, read-only, switched by
 * the role language). The editor always shows the EFFECTIVE prompt — when no
 * override exists, the defaults are filled in, so what you see is exactly
 * what will be used. The role-language dropdown swaps the default templates
 * in both modes while nothing is saved; once prompts are saved they belong
 * to the user and language switches no longer rewrite them.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/prompt-editor
 */
import { createElement as h, useEffect, useState } from 'react';
import { DEFAULT_LANGUAGE, defaultOverview, defaultStyle, hasSavedOverrides, useDefaultsConfig } from "./explain.js";
import { ui } from "./i18n.js";
import { unwrapRemote } from "./remote.js";
import css from './prompt-editor.module.css';
/** Edit and persist the explain prompts. The editor body is the effective prompt. */
export function PromptEditor(props) {
    const { archLens, config, base, onSave, onClose } = props;
    const [useDefaults, setUseDefaults] = useState(useDefaultsConfig(config));
    const [language, setLanguage] = useState(config.language ?? DEFAULT_LANGUAGE);
    const [overview, setOverview] = useState(config.overviewPrompt ?? base.overviewPrompt ?? defaultOverview(language));
    const [style, setStyle] = useState(config.explainStyle ?? base.explainStyle ?? defaultStyle(language));
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    useEffect(() => {
        setUseDefaults(useDefaultsConfig(config));
        setLanguage(config.language ?? DEFAULT_LANGUAGE);
        setOverview(config.overviewPrompt ?? base.overviewPrompt ?? defaultOverview(config.language ?? DEFAULT_LANGUAGE));
        setStyle(config.explainStyle ?? base.explainStyle ?? defaultStyle(config.language ?? DEFAULT_LANGUAGE));
    }, [config, base]);
    const fillDefaults = (value) => {
        setOverview(base.overviewPrompt ?? defaultOverview(value));
        setStyle(base.explainStyle ?? defaultStyle(value));
    };
    // Language switch swaps the default templates immediately; saved custom
    // prompts are kept verbatim (they belong to the user, not to a language).
    // In "my prompts" mode the SAME swap must happen for the unsaved fallback:
    // with no saved override the visible text IS the per-language default
    // template (the mode hint promises "falls back to the default templates"),
    // so it has to follow the role-language dropdown too — otherwise the
    // editor ends up with e.g. Chinese chrome around English template text.
    const onLanguage = (value) => {
        setLanguage(value);
        if (useDefaults || !hasSavedOverrides(config)) {
            fillDefaults(value);
        }
    };
    const switchMode = (next) => {
        setUseDefaults(next);
        if (next) {
            // Default templates: show the current-language defaults (read-only).
            fillDefaults(language);
        }
        else if (hasSavedOverrides(config)) {
            // My prompts: show the saved overrides when present. Without this the
            // default-mode text stays in the editable boxes and an immediate save
            // would silently overwrite the saved prompts with template text.
            if (config.overviewPrompt !== undefined)
                setOverview(config.overviewPrompt);
            if (config.explainStyle !== undefined)
                setStyle(config.explainStyle);
        }
        // Otherwise (my prompts, nothing saved) the visible fallback preview is
        // already the effective text — keep it.
    };
    const save = () => {
        setSaving(true);
        setSaved(false);
        // Both modes persist the visible text: in default mode that is the
        // current-language default template ("overwrite mine" — it replaces any
        // previously saved custom prompts, same-language), in mine mode the
        // user's own edits. The useDefaults flag records which set wins at run time.
        const next = { useDefaults };
        if (language.trim() !== '')
            next.language = language.trim();
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
    return h('div', { className: css.editor }, h('div', { className: css.mask, onClick: onClose }), h('div', { className: css.card }, h('div', { className: css.head }, h('span', { className: css.title }, ui(language, 'editorTitle')), h('span', { className: css.spacer }), h('button', { className: css.btn, onClick: onClose }, '✕')), h('div', { className: css.field }, h('div', { className: css.label }, ui(language, 'editorModeLabel')), h('div', { className: css.modeRow }, h('button', {
        className: `${css.btn} ${useDefaults ? '' : css.primary}`,
        onClick: () => switchMode(false),
    }, ui(language, 'editorModeMine')), h('button', {
        className: `${css.btn} ${useDefaults ? css.primary : ''}`,
        onClick: () => switchMode(true),
    }, ui(language, 'editorModeDefault'))), h('div', { className: css.hint }, useDefaults ? ui(language, 'editorModeHintDefault') : ui(language, 'editorModeHintMine'))), h('div', { className: css.field }, h('div', { className: css.label }, ui(language, 'editorLanguageLabel')), h('select', {
        className: css.input,
        value: language === 'English' ? 'English' : DEFAULT_LANGUAGE,
        onChange: (event) => onLanguage(event.target.value),
    }, h('option', { value: DEFAULT_LANGUAGE }, DEFAULT_LANGUAGE), h('option', { value: 'English' }, 'English'))), h('div', { className: css.field }, h('div', { className: css.label }, ui(language, 'editorOverviewLabel')), h('textarea', {
        className: css.textarea,
        rows: 12,
        value: overview,
        readOnly: useDefaults,
        onChange: (event) => setOverview(event.target.value),
    })), h('div', { className: css.field }, h('div', { className: css.label }, ui(language, 'editorStyleLabel')), h('textarea', {
        className: css.textarea,
        rows: 6,
        value: style,
        readOnly: useDefaults,
        onChange: (event) => setStyle(event.target.value),
    })), h('div', { className: css.actions }, h('button', { className: `${css.btn} ${css.primary}`, onClick: save, disabled: saving }, saving ? ui(language, 'editorSaving') : (useDefaults ? ui(language, 'editorOverwrite') : ui(language, 'editorSave'))), useDefaults ? null : h('button', { className: css.btn, onClick: () => {
            fillDefaults(language);
        } }, ui(language, 'editorReset')), saved ? h('span', { className: css.saved }, ui(language, 'editorSaved')) : null)));
}
//# sourceMappingURL=prompt-editor.js.map