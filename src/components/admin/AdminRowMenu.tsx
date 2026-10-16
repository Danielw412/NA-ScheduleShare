import { MoreHorizontal } from 'lucide-react'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'

export interface AdminRowMenuItem {
  label: string
  onSelect: () => void
  tone?: 'danger'
}

/** `null` entries are skipped; `'separator'` draws a rule between groups. */
export type AdminRowMenuEntry = AdminRowMenuItem | 'separator' | null | false

interface AdminRowMenuProps {
  /** Accessible name for the trigger, e.g. "Actions for Jordan Smith". */
  label: string
  items: AdminRowMenuEntry[]
}

const MENU_GAP = 4
const VIEWPORT_MARGIN = 8

/**
 * Overflow menu for a table row. The menu is portalled and fixed-positioned
 * so scrolling table wrappers never clip it. Arrow keys move between items,
 * Escape and Tab close it and return focus to the trigger.
 */
export function AdminRowMenu({ label, items }: AdminRowMenuProps) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const entries = items.filter((item): item is AdminRowMenuItem | 'separator' => Boolean(item))
  // Drop separators at the edges or next to each other.
  const visible = entries.filter((entry, index) => entry !== 'separator' || (index > 0 && index < entries.length - 1 && entries[index - 1] !== 'separator'))

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false)
    setPosition(null)
    if (restoreFocus) triggerRef.current?.focus()
  }, [])

  const place = useCallback(() => {
    const trigger = triggerRef.current
    const menu = menuRef.current
    if (!trigger || !menu) return
    const rect = trigger.getBoundingClientRect()
    // The row scrolled out of view: the menu has nothing to point at.
    if (rect.bottom < 0 || rect.top > window.innerHeight) {
      close(false)
      return
    }
    const width = menu.offsetWidth
    const height = menu.offsetHeight
    const left = Math.min(Math.max(VIEWPORT_MARGIN, rect.right - width), window.innerWidth - width - VIEWPORT_MARGIN)
    const below = rect.bottom + MENU_GAP
    const top = below + height > window.innerHeight - VIEWPORT_MARGIN && rect.top - MENU_GAP - height > VIEWPORT_MARGIN
      ? rect.top - MENU_GAP - height
      : below
    setPosition({ top, left })
  }, [close])

  useLayoutEffect(() => {
    if (open) place()
  }, [open, place])

  // Move focus in once the menu is visible (hidden elements can't take focus).
  const focusedOnOpen = useRef(false)
  useEffect(() => {
    if (!open) {
      focusedOnOpen.current = false
      return
    }
    if (!position || focusedOnOpen.current) return
    focusedOnOpen.current = true
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
  }, [open, position])

  useEffect(() => {
    if (!open) return
    function handlePointer(event: PointerEvent) {
      const target = event.target as Node
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      close(false)
    }
    function handleViewportChange(event: Event) {
      if (event.type === 'scroll' && menuRef.current?.contains(event.target as Node)) return
      place()
    }
    document.addEventListener('pointerdown', handlePointer)
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointer)
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [close, open, place])

  function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const options = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const index = options.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close(true)
    } else if (event.key === 'Tab') {
      event.preventDefault()
      close(true)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      options[(index + 1) % options.length]?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      options[(index - 1 + options.length) % options.length]?.focus()
    } else if (event.key === 'Home') {
      event.preventDefault()
      options[0]?.focus()
    } else if (event.key === 'End') {
      event.preventDefault()
      options[options.length - 1]?.focus()
    }
  }

  function select(item: AdminRowMenuItem) {
    // Return focus first so a dialog opened by the item restores focus here.
    close(true)
    item.onSelect()
  }

  if (visible.length === 0) return null

  return (
    <>
      <button
        ref={triggerRef}
        className="icon-button admin-menu-trigger"
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        <MoreHorizontal aria-hidden="true" />
      </button>
      {open ? createPortal(
        <div
          ref={menuRef}
          id={menuId}
          className="admin-menu"
          role="menu"
          aria-label={label}
          style={position ? { top: position.top, left: position.left } : { top: 0, left: 0, visibility: 'hidden' }}
          onKeyDown={handleMenuKeyDown}
        >
          {visible.map((entry, index) => entry === 'separator'
            ? <hr className="admin-menu-separator" key={`separator-${index}`} />
            : <button
              className={entry.tone === 'danger' ? 'admin-menu-item is-danger' : 'admin-menu-item'}
              key={entry.label}
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => select(entry)}
            >{entry.label}</button>)}
        </div>,
        document.body,
      ) : null}
    </>
  )
}
