/**
 * A real editor for the multi-line documents the dialogs edit.
 *
 * The host exports read-only code views (its `ReadBlock`, `CodeBlock`, and
 * friends) and no editable one, and nothing in the dependency graph provides an
 * editor, so CodeMirror 6 is bundled into the client the way React is. Its
 * theme is built from the platform's `--dsw-*` tokens, so light and dark follow
 * the active theme with no branch.
 * @module client/ui/CodeEditor
 */
import { createElement as h, useEffect, useRef, type ReactNode } from 'react'
import { history, historyKeymap, indentWithTab, defaultKeymap } from '@codemirror/commands'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { bracketMatching, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, drawSelection, highlightActiveLine, highlightSpecialChars, keymap, lineNumbers } from '@codemirror/view'
import css from './code-editor.module.css'

/** Which grammar the editor reads; both ship with the client bundle. */
export type CodeLanguage = 'markdown' | 'json'

/** The editor's own skin, from the platform tokens so both themes follow. */
const platformTheme: Extension = EditorView.theme({
  '&': {
    backgroundColor: 'var(--dsw-alias-bg-layer-1)',
    color: 'var(--dsw-alias-label-primary)',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: '12px'
  },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: '19px' },
  '.cm-content': { padding: '8px 0', caretColor: 'var(--dsw-alias-label-primary)' },
  '.cm-line': { padding: '0 10px' },
  '.cm-gutters': {
    backgroundColor: 'var(--dsw-alias-bg-layer-1)',
    border: 'none',
    borderRight: '1px solid var(--dsw-alias-border-l1)',
    color: 'var(--dsw-alias-label-tertiary)'
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 6px 0 10px' },
  '.cm-activeLine': { backgroundColor: 'var(--dsw-alias-interactive-bg-hover)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--dsw-alias-interactive-bg-hover)', color: 'var(--dsw-alias-label-secondary)' },
  '&.cm-focused': { outline: 'none' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--dsw-alias-label-primary)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--dsw-alias-state-business-tertiary)' },
  '.cm-matchingBracket': { backgroundColor: 'var(--dsw-alias-interactive-bg-active)', outline: 'none' }
})

/** One editable document. `value` is controlled; every keystroke reports up. */
export function CodeEditor(props: {
  value: string
  onChange: (value: string) => void
  language: CodeLanguage
  /** Accessible name of the editing surface. */
  label: string
  disabled?: boolean
  /** Floor for the editing surface, in px. */
  minHeight?: number
}): ReactNode {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | undefined>(undefined)
  const readOnly = useRef(new Compartment())
  const report = useRef(props.onChange)
  report.current = props.onChange
  // The mount effect owns the view's lifetime and must not re-run on every
  // keystroke, so the props it reads are mirrored through refs.
  const initial = useRef(props)
  initial.current = props

  useEffect(() => {
    const parent = host.current
    if (parent === null) return
    const state = EditorState.create({
      doc: initial.current.value,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightSpecialChars(),
        drawSelection(),
        bracketMatching(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        (initial.current.language === 'markdown' ? markdown() : json()),
        readOnly.current.of(EditorState.readOnly.of(initial.current.disabled === true)),
        EditorView.contentAttributes.of({ 'aria-label': initial.current.label, spellcheck: 'false' }),
        EditorView.updateListener.of(update => {
          if (update.docChanged) report.current(update.state.doc.toString())
        }),
        platformTheme
      ]
    })
    const created = new EditorView({ state, parent })
    view.current = created
    return () => {
      created.destroy()
      view.current = undefined
    }
  }, [])

  // Push an external change (a different document, or a reset) into the view.
  useEffect(() => {
    const current = view.current
    if (current === undefined) return
    const text = current.state.doc.toString()
    if (text === props.value) return
    current.dispatch({ changes: { from: 0, to: text.length, insert: props.value } })
  }, [props.value])

  useEffect(() => {
    view.current?.dispatch({ effects: readOnly.current.reconfigure(EditorState.readOnly.of(props.disabled === true)) })
  }, [props.disabled])

  return h('div', { ref: host, className: css.editor, style: { minHeight: `${props.minHeight ?? 240}px` } })
}
