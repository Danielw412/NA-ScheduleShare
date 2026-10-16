import { X } from 'lucide-react'
import { useId, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useDialogAccessibility } from '../../hooks/useDialogAccessibility'

interface DialogProps {
  title: ReactNode
  description?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  size?: 'small' | 'medium' | 'large' | 'wide'
  className?: string
  closeLabel?: string
  /** Set false while a destructive or network action must finish first. */
  dismissible?: boolean
  headerExtra?: ReactNode
  /** Use "alertdialog" for confirmations of destructive or irreversible actions. */
  role?: 'dialog' | 'alertdialog'
  /** Focus target on close when the control that opened the dialog is gone (e.g. a closed menu). */
  returnFocusRef?: RefObject<HTMLElement | null>
}

/**
 * Modal dialog. A centered panel on wide screens and a bottom sheet under
 * 640px. Focus is trapped and restored by useDialogAccessibility.
 */
export function Dialog({
  title,
  description,
  onClose,
  children,
  footer,
  size = 'medium',
  className,
  closeLabel = 'Close',
  dismissible = true,
  headerExtra,
  role = 'dialog',
  returnFocusRef,
}: DialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useDialogAccessibility(true, onClose, dismissible, returnFocusRef)
  const sizeClass = size === 'medium' ? '' : `is-${size}`
  const classes = ['dialog', sizeClass, className ?? ''].filter(Boolean).join(' ')

  return createPortal(
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (dismissible && event.target === event.currentTarget) onClose() }}>
      <section
        ref={dialogRef}
        className={classes}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <span className="sheet-handle" aria-hidden="true" />
        <header className="dialog-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
            {headerExtra}
          </div>
          <button className="icon-button" type="button" aria-label={closeLabel} onClick={onClose} disabled={!dismissible}><X aria-hidden="true" /></button>
        </header>
        <div className="dialog-body">{children}</div>
        {footer ? <footer className="dialog-footer">{footer}</footer> : null}
      </section>
    </div>,
    document.body,
  )
}
