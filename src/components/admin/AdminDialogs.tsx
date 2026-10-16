import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react'
import { Dialog } from '../ui/Dialog'

type Tone = 'default' | 'danger'

export interface AdminConfirmOptions {
  title: string
  /** Inline text (no block elements): it is the dialog's accessible description. */
  message: ReactNode
  confirmLabel: string
  cancelLabel?: string
  tone?: Tone
}

export interface AdminPromptOptions {
  title: string
  description?: ReactNode
  label: string
  submitLabel: string
  defaultValue?: string
  help?: ReactNode
  tone?: Tone
  /** Typed confirmation: the submit button stays disabled until the value matches exactly. */
  match?: string
  /** Render a select instead of a text field. */
  options?: Array<{ value: string; label: string }>
  multiline?: boolean
  inputType?: 'text' | 'email'
  maxLength?: number
  monospace?: boolean
}

/** Class names of the dialogs below, used to tell a follow-up question from a new one. */
const QUESTION_DIALOGS = '.admin-confirm-dialog, .admin-prompt-dialog'

type Request =
  | { kind: 'confirm'; options: AdminConfirmOptions; resolve: (value: boolean) => void }
  | { kind: 'prompt'; options: AdminPromptOptions; resolve: (value: string | null) => void }

/**
 * Promise-based replacements for window.confirm and window.prompt that render
 * the shared Dialog. Callers keep their existing validation: confirm resolves
 * false and prompt resolves null when the administrator cancels, exactly like
 * the browser versions. Render `dialog` once in the calling component.
 */
export function useAdminDialogs() {
  const [request, setRequest] = useState<Request | null>(null)
  const requestRef = useRef<Request | null>(null)
  // The control that asked the question. These dialogs autofocus a field or
  // button before the shared focus hook runs, so the hook can't see the opener
  // itself; it falls back to this element when the dialog closes.
  const openerRef = useRef<HTMLElement | null>(null)

  const settle = useCallback((value: boolean | string | null) => {
    const current = requestRef.current
    if (!current) return
    requestRef.current = null
    setRequest(null)
    if (current.kind === 'confirm') current.resolve(value === true)
    else current.resolve(typeof value === 'string' ? value : null)
  }, [])

  const open = useCallback((next: Request) => {
    const active = document.activeElement
    // A follow-up question asked from inside one of these dialogs keeps the
    // original opener.
    if (!(active instanceof HTMLElement && active.closest(QUESTION_DIALOGS))) {
      openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null
    }
    // Only one question at a time; a newer one cancels the older one.
    const previous = requestRef.current
    if (previous) {
      if (previous.kind === 'confirm') previous.resolve(false)
      else previous.resolve(null)
    }
    requestRef.current = next
    setRequest(next)
  }, [])

  const confirm = useCallback((options: AdminConfirmOptions) => new Promise<boolean>((resolve) => open({ kind: 'confirm', options, resolve })), [open])
  const prompt = useCallback((options: AdminPromptOptions) => new Promise<string | null>((resolve) => open({ kind: 'prompt', options, resolve })), [open])

  useEffect(() => () => {
    const current = requestRef.current
    if (!current) return
    if (current.kind === 'confirm') current.resolve(false)
    else current.resolve(null)
  }, [])

  const dialog = request
    ? request.kind === 'confirm'
      ? <ConfirmDialog options={request.options} returnFocusRef={openerRef} onCancel={() => settle(false)} onConfirm={() => settle(true)} />
      : <PromptDialog options={request.options} returnFocusRef={openerRef} onCancel={() => settle(null)} onSubmit={(value) => settle(value)} />
    : null

  return { confirm, prompt, dialog }
}


interface QuestionProps {
  returnFocusRef: RefObject<HTMLElement | null>
  onCancel: () => void
}

function ConfirmDialog({ options, returnFocusRef, onCancel, onConfirm }: QuestionProps & { options: AdminConfirmOptions; onConfirm: () => void }) {
  const danger = options.tone === 'danger'
  // The message is the description so screen readers announce the
  // consequences along with the title, even though focus starts on a button.
  return (
    <Dialog
      title={options.title}
      description={options.message}
      size="small"
      onClose={onCancel}
      role={danger ? 'alertdialog' : 'dialog'}
      returnFocusRef={returnFocusRef}
      className="admin-dialog admin-confirm-dialog"
      footer={<>
        <button className="button button-secondary" type="button" autoFocus={danger} onClick={onCancel}>{options.cancelLabel ?? 'Cancel'}</button>
        <button className={danger ? 'button button-danger' : 'button button-primary'} type="button" autoFocus={!danger} onClick={onConfirm}>{options.confirmLabel}</button>
      </>}
    >
      {null}
    </Dialog>
  )
}

function PromptDialog({ options, returnFocusRef, onCancel, onSubmit }: QuestionProps & { options: AdminPromptOptions; onSubmit: (value: string) => void }) {
  const formId = useId()
  const fieldId = useId()
  const helpId = useId()
  const [value, setValue] = useState(options.defaultValue ?? '')
  const danger = options.tone === 'danger'
  const ready = options.match !== undefined ? value === options.match : value !== ''

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!ready) return
    onSubmit(value)
  }

  const describedBy = options.help ? helpId : undefined
  const fieldClass = options.monospace ? 'admin-mono-input' : undefined

  return (
    <Dialog
      title={options.title}
      description={options.description}
      size="small"
      onClose={onCancel}
      role={danger ? 'alertdialog' : 'dialog'}
      returnFocusRef={returnFocusRef}
      className="admin-dialog admin-prompt-dialog"
      footer={<>
        <button className="button button-secondary" type="button" onClick={onCancel}>Cancel</button>
        <button className={danger ? 'button button-danger' : 'button button-primary'} type="submit" form={formId} disabled={!ready}>{options.submitLabel}</button>
      </>}
    >
      <form id={formId} className="admin-dialog-form" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor={fieldId}>{options.label}</label>
          {options.options
            ? <select id={fieldId} autoFocus value={value} aria-describedby={describedBy} onChange={(event) => setValue(event.target.value)}>
              {options.options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
            </select>
            : options.multiline
              ? <textarea id={fieldId} autoFocus value={value} maxLength={options.maxLength} aria-describedby={describedBy} onChange={(event) => setValue(event.target.value)} />
              : <input
                id={fieldId}
                autoFocus
                className={fieldClass}
                type={options.inputType ?? 'text'}
                value={value}
                maxLength={options.maxLength}
                autoComplete="off"
                spellCheck={options.match === undefined}
                aria-describedby={describedBy}
                onChange={(event) => setValue(event.target.value)}
              />}
          {options.help ? <p className="field-help" id={helpId}>{options.help}</p> : null}
        </div>
      </form>
    </Dialog>
  )
}
