import { useEffect, useRef, type RefObject } from 'react'

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

const dialogStack: symbol[] = []
let bodyOverflowBeforeDialogs = ''

export function useDialogAccessibility(
  open: boolean,
  onClose: () => void,
  closeOnEscape = true,
): RefObject<HTMLElement | null> {
  const dialogRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  const closeOnEscapeRef = useRef(closeOnEscape)
  onCloseRef.current = onClose
  closeOnEscapeRef.current = closeOnEscape

  useEffect(() => {
    if (!open) return
    const dialogId = Symbol('dialog')
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    const focusableElements = () => [...dialog?.querySelectorAll<HTMLElement>(focusableSelector) ?? []]
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
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      const stackIndex = dialogStack.lastIndexOf(dialogId)
      if (stackIndex >= 0) dialogStack.splice(stackIndex, 1)
      if (dialogStack.length === 0) document.body.style.overflow = bodyOverflowBeforeDialogs
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [open])

  return dialogRef
}
