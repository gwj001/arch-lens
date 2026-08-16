/**
 * Prompt-config editor for the Arch Lens desk: edits the persisted overview
 * prompt and unit explain style, saved back through the backend Remote. A
 * mode switch chooses between "my prompts" (the saved overrides, editable)
 * and "default templates" (per-language built-ins, read-only, switched by
 * the role language). The editor always shows the EFFECTIVE prompt — when no
 * override exists, the defaults are filled in, so what you see is exactly
 * what will be used.
 * @module @deepseek-ai/dsh-client-arch-lens/src/client/prompt-editor
 */

import { createElement as h, useEffect, useState } from 'react'
import type { ArchLensPromptConfig } from '@deepseek-ai/dsh-arch-lens-backend'
import { DEFAULT_LANGUAGE, defaultOverview, defaultStyle, useDefaultsConfig } from './explain.ts'
import { ui } from './i18n.ts'
import type { ArchLensRemote } from './remote.ts'
import { unwrapRemote } from './remote.ts'
import css from './prompt-editor.module.css'

/** Deployment-level prompt defaults the editor falls back to in default mode. */
export interface PromptEditorBase {
  overviewPrompt?: string
  explainStyle?: string
}

/**
 * Prompt-editor props.
 */
export interface PromptEditorProps {
  archLens: ArchLensRemote
  config: ArchLensPromptConfig
  base: PromptEditorBase
  onSave: (config: ArchLensPromptConfig) => void
  onClose: () => void
}

/** Edit and persist the explain prompts. The editor body is the effective prompt. */
export function PromptEditor(props: PromptEditorProps): React.JSX.Element {
  const { archLens, config, base, onSave, onClose } = props
  const [useDefaults, setUseDefaults] = useState(useDefaultsConfig(config))
  const [language, setLanguage] = useState(config.language ?? DEFAULT_LANGUAGE)
  const [overview, setOverview] = useState(config.overviewPrompt ?? base.overviewPrompt ?? defaultOverview(language))
  const [style, setStyle] = useState(config.explainStyle ?? base.explainStyle ?? defaultStyle(language))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setUseDefaults(useDefaultsConfig(config))
    setLanguage(config.language ?? DEFAULT_LANGUAGE)
    setOverview(config.overviewPrompt ?? base.overviewPrompt ?? defaultOverview(config.language ?? DEFAULT_LANGUAGE))
    setStyle(config.explainStyle ?? base.explainStyle ?? defaultStyle(config.language ?? DEFAULT_LANGUAGE))
  }, [config, base])

  // Language switch swaps the default templates immediately; saved custom
  // prompts are kept verbatim (they belong to the user, not to a language).
  const onLanguage = (value: string): void => {
    setLanguage(value)
    if (useDefaults) {
      setOverview(base.overviewPrompt ?? defaultOverview(value))
      setStyle(base.explainStyle ?? defaultStyle(value))
    }
  }

  const switchMode = (next: boolean): void => {
    setUseDefaults(next)
    if (next) {
      setOverview(base.overviewPrompt ?? defaultOverview(language))
      setStyle(base.explainStyle ?? defaultStyle(language))
    }
  }

  const save = (): void => {
    setSaving(true)
    setSaved(false)
    const next: ArchLensPromptConfig = { useDefaults }
    if (language.trim() !== '') next.language = language.trim()
    if (!useDefaults) {
      if (overview.trim() !== '') next.overviewPrompt = overview.trim()
      if (style.trim() !== '') next.explainStyle = style.trim()
    }
    void unwrapRemote(archLens.promptConfigSave(next)).then(result => {
      setSaving(false)
      if ('error' in result) {
        return
      }
      onSave(result.config)
      setSaved(true)
    }).catch(() => {
      setSaving(false)
    })
  }

  return h('div', { className: css.editor },
    h('div', { className: css.mask, onClick: onClose }),
    h('div', { className: css.card },
      h('div', { className: css.head },
        h('span', { className: css.title }, ui(language, 'editorTitle')),
        h('span', { className: css.spacer }),
        h('button', { className: css.btn, onClick: onClose }, '✕'),
      ),
      h('div', { className: css.field },
        h('div', { className: css.label }, ui(language, 'editorModeLabel')),
        h('div', { className: css.modeRow },
          h('button', {
            className: `${css.btn} ${useDefaults ? '' : css.primary}`,
            onClick: () => switchMode(false),
          }, ui(language, 'editorModeMine')),
          h('button', {
            className: `${css.btn} ${useDefaults ? css.primary : ''}`,
            onClick: () => switchMode(true),
          }, ui(language, 'editorModeDefault')),
        ),
        h('div', { className: css.hint }, useDefaults ? ui(language, 'editorModeHintDefault') : ui(language, 'editorModeHintMine')),
      ),
      h('div', { className: css.field },
        h('div', { className: css.label }, ui(language, 'editorLanguageLabel')),
        h('input', {
          className: css.input,
          value: language,
          placeholder: DEFAULT_LANGUAGE,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => onLanguage(event.target.value),
        }),
      ),
      h('div', { className: css.field },
        h('div', { className: css.label }, ui(language, 'editorOverviewLabel')),
        h('textarea', {
          className: css.textarea,
          rows: 12,
          value: overview,
          readOnly: useDefaults,
          onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => setOverview(event.target.value),
        }),
      ),
      h('div', { className: css.field },
        h('div', { className: css.label }, ui(language, 'editorStyleLabel')),
        h('textarea', {
          className: css.textarea,
          rows: 6,
          value: style,
          readOnly: useDefaults,
          onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => setStyle(event.target.value),
        }),
      ),
      h('div', { className: css.actions },
        h('button', { className: `${css.btn} ${css.primary}`, onClick: save, disabled: saving }, saving ? ui(language, 'editorSaving') : ui(language, 'editorSave')),
        useDefaults ? null : h('button', { className: css.btn, onClick: () => {
          setOverview(base.overviewPrompt ?? defaultOverview(language))
          setStyle(base.explainStyle ?? defaultStyle(language))
        } }, ui(language, 'editorReset')),
        saved ? h('span', { className: css.saved }, ui(language, 'editorSaved')) : null,
      ),
    ),
  )
}
