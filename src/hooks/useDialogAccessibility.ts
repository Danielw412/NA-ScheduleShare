import { useEffect, useRef, type RefObject } from 'react'

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

const dialogStack: symbol[] = []
let bodyOverflowBeforeDialogs = ''

/** Controls inside a closed <details> (other than its summary), hidden, or inert subtrees cannot take focus. */
function isReachable(element: HTMLElement): boolean {
  if (element.closest('[hidden], [inert]')) return false
  // Every closed <details> around the element hides it, except the summary
  // that belongs directly to that <details>.
  for (let details = element.closest('details:not([open])'); details; details = details.parentElement?.closest('details:not([open])') ?? null) {
    if (element.closest('summary')?.parentElement !== details) return false
  }
  const visibilityCheck = (element as HTMLElement & { checkVisibility?: () => boolean }).checkVisibility
  if (typeof visibilityCheck === 'function' && !visibilityCheck.call(element)) return false
  return true
}

function canReceiveFocus(element: HTMLElement | null | undefined): element is HTMLElement {
  return Boolean(element?.isConnected && !element.closest('[hidden], [inert]') && !(element as HTMLButtonElement).disabled)
}

export function useDialogAccessibility(
  open: boolean,
  onClose: () => void,
  closeOnEscape = true,
  /** Where focus goes on close when the element that opened the dialog no longer exists (for example a closed menu). */
  returnFocusRef?: RefObject<HTMLElement | null>,
): RefObject<HTMLElement | null> {
  const dialogRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  const closeOnEscapeRef = useRef(closeOnEscape)
  const returnFocusRefRef = useRef(returnFocusRef)
  onCloseRef.current = onClose
  closeOnEscapeRef.current = closeOnEscape
  returnFocusRefRef.current = returnFocusRef

  // Record the opener while rendering, before any autoFocus inside the dialog
  // moves focus away from it.
  const openerRef = useRef<HTMLElement | null>(null)
  const openRecordedRef = useRef(false)
  if (open && !openRecordedRef.current) {
    openRecordedRef.current = true
    const active = typeof document === 'undefined' ? null : document.activeElement
    openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null
  } else if (!open) {
    openRecordedRef.current = false
  }

  useEffect(() => {
    if (!open) return
    const dialogId = Symbol('dialog')
    const dialog = dialogRef.current
    const activeNow = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
    const recorded = openerRef.current && !dialog?.contains(openerRef.current) ? openerRef.current : null
    const previouslyFocused = recorded ?? (activeNow && !dialog?.contains(activeNow) ? activeNow : null)
    const focusableElements = () => [...dialog?.querySelectorAll<HTMLElement>(focusableSelector) ?? []].filter(isReachable)
    if (!dialog?.contains(document.activeElement)) (focusableElements()[0] ?? dialog)?.focus()

    if (dialogStack.length === 0) bodyOverflowBeforeDialogs = document.body.style.overflow
    dialogStack.push(dialogId)
    document.body.style.overflow = 'hidden'

    const handleKeyDown = (event: KeyboardEvent) => {
      if (dialogStack[dialogStack.length - 1] !== dialogId) return
      if (event.key === 'Escape' && closeOnEscapeRef.current) {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const elements = focusableElements()
      if (elements.length === 0) {
        event.preventDefault()
        dialog?.focus()
        return
      }
      // Move focus ourselves so it can never land on hidden content or leave
      // the dialog, whatever the browser's own tab order would do.
      event.preventDefault()
      const index = elements.indexOf(document.activeElement as HTMLElement)
      const next = event.shiftKey
        ? elements[index <= 0 ? elements.length - 1 : index - 1]
        : elements[index < 0 || index === elements.length - 1 ? 0 : index + 1]
      next.focus()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      const stackIndex = dialogStack.lastIndexOf(dialogId)
      if (stackIndex >= 0) dialogStack.splice(stackIndex, 1)
      if (dialogStack.length === 0) document.body.style.overflow = bodyOverflowBeforeDialogs
      // Return focus to whatever opened the dialog; if that is gone, to the
      // requested fallback; otherwise to the page content, never <body>.
      const target = [previouslyFocused, returnFocusRefRef.current?.current].find(canReceiveFocus)
        ?? (dialogStack.length === 0 ? document.getElementById('main-content') : null)
      target?.focus({ preventScroll: target.id === 'main-content' })
    }
  }, [open])

  return dialogRef
}
