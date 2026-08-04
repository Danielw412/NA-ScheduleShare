import { AlertTriangle, MoreVertical, Plus } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { termLabels, type DayType, type ScheduleEnrollment, type SemesterTerm } from '../../lib/domain'
import { enrollmentAtSlot, enrollmentMeetingSlots, findScheduleConflicts, hasMultiplePeriodsOnAnyDay, isMeetingSlotContinuation, meetingSlotsForDay, PERIOD_NUMBERS } from '../../lib/schedule'

interface ScheduleGridProps {
  enrollments: ScheduleEnrollment[]
  selectedTerm: SemesterTerm
  onAdd: (dayType: DayType, period: number) => void
  onRemove: (enrollment: ScheduleEnrollment) => void
  onReplace: (enrollment: ScheduleEnrollment, dayType: DayType, period: number) => void
  readOnly?: boolean
  changedEnrollmentIds?: ReadonlySet<string>
}

interface CellMenuState {
  key: string
  enrollment: ScheduleEnrollment
  dayType: DayType
  period: number
  style: CSSProperties
}

export function ScheduleGrid({ enrollments, selectedTerm, onAdd, onRemove, onReplace, readOnly = false, changedEnrollmentIds }: ScheduleGridProps) {
  const conflicts = findScheduleConflicts(enrollments)
  const conflictedIds = new Set(conflicts.flatMap((pair) => pair.map((enrollment) => enrollment.id)))
  const [openMenu, setOpenMenu] = useState<CellMenuState | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const closeMenu = useCallback((restoreFocus = false) => {
    setOpenMenu(null)
    if (restoreFocus) triggerRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!openMenu) return
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) closeMenu()
    }
    const closeOnViewportChange = () => closeMenu(true)
    const handleMenuKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeMenu(true)
        return
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !menuRef.current?.contains(event.target as Node)) return
      const items = [...menuRef.current.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      if (items.length === 0) return
      event.preventDefault()
      const currentIndex = Math.max(0, items.indexOf(document.activeElement as HTMLButtonElement))
      const nextIndex = event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowDown'
            ? (currentIndex + 1) % items.length
            : (currentIndex - 1 + items.length) % items.length
      items[nextIndex]?.focus()
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', handleMenuKeyDown)
    window.addEventListener('resize', closeOnViewportChange)
    window.addEventListener('scroll', closeOnViewportChange, true)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', handleMenuKeyDown)
      window.removeEventListener('resize', closeOnViewportChange)
      window.removeEventListener('scroll', closeOnViewportChange, true)
    }
  }, [closeMenu, openMenu])

  function toggleMenu(event: MouseEvent<HTMLButtonElement>, enrollment: ScheduleEnrollment, dayType: DayType, period: number) {
    const key = `${enrollment.id}:${dayType}:${period}`
    if (openMenu?.key === key) {
      closeMenu(true)
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const menuWidth = 220
    const viewportPadding = 8
    const expectedMenuHeight = 190
    const showAbove = rect.bottom + expectedMenuHeight > window.innerHeight - viewportPadding
    triggerRef.current = event.currentTarget
    setOpenMenu({
      key,
      enrollment,
      dayType,
      period,
      style: {
        left: Math.min(
          window.innerWidth - menuWidth - viewportPadding,
          Math.max(viewportPadding, rect.right - menuWidth),
        ),
        ...(showAbove
          ? { bottom: Math.max(viewportPadding, window.innerHeight - rect.top + 6) }
          : { top: rect.bottom + 6 }),
      },
    })
  }

  return (
    <>
      <div className="schedule-grid-wrap">
      <div className="schedule-grid" role="grid" aria-label={`${termLabels[selectedTerm]} A/B-day schedule`}>
        <div className="schedule-corner" role="columnheader" />
        {(['A', 'B'] as DayType[]).map((day) => <div className={`day-header day-${day.toLowerCase()}`} role="columnheader" key={day}>{day} Day</div>)}
        {PERIOD_NUMBERS.map((period) => (
          <div className="schedule-row" role="row" data-period={period} key={period}>
            <div className="period-label" role="rowheader" data-period={period}><span>Period</span> {period}</div>
            {(['A', 'B'] as DayType[]).map((dayType) => {
              const enrollment = enrollmentAtSlot(enrollments, dayType, period, selectedTerm)
              if (!enrollment) {
                return readOnly ? (
                  <div className="schedule-cell empty-cell readonly-cell" role="gridcell" data-day={dayType} data-period={period} key={dayType}>
                    <span>Open</span>
                  </div>
                ) : (
                  <button className="schedule-cell empty-cell" role="gridcell" data-day={dayType} data-period={period} type="button" key={dayType} onClick={() => onAdd(dayType, period)}>
                    <Plus size={19} aria-hidden="true" /> Add class
                  </button>
                )
              }
              const attendanceSlots = enrollmentMeetingSlots(enrollment)
              const daySlots = meetingSlotsForDay(attendanceSlots, dayType)
              const hasMultiplePeriods = daySlots.length > 1
              const isDoublePeriod = enrollment.class.is_double_period || hasMultiplePeriodsOnAnyDay(attendanceSlots)
              const continuation = isMeetingSlotContinuation(attendanceSlots, { day_type: dayType, period_number: period })
              const conflicted = conflictedIds.has(enrollment.id)
              const changed = changedEnrollmentIds?.has(enrollment.id) ?? false
              return (
                <div className={`schedule-cell filled-cell ${isDoublePeriod ? 'is-multi-period' : ''} ${continuation ? 'is-continuation' : ''} ${conflicted ? 'has-conflict' : ''} ${changed ? 'is-predicted-change' : ''}`} role="gridcell" data-day={dayType} data-period={period} data-continuation={continuation || undefined} data-predicted-change={changed || undefined} key={dayType}>
                  {conflicted ? <AlertTriangle className="conflict-icon" size={18} aria-label="Schedule conflict" /> : null}
                  <div className="class-cell-copy">
                    <strong>{continuation ? `${enrollment.class.course_name} - continues` : enrollment.class.course_name}{changed && !continuation ? <span className="predicted-change-label">Changed</span> : null}</strong>
                    <span>{continuation ? 'Continues from previous period' : enrollment.class.teacher_last_name}</span>
                    {hasMultiplePeriods && !continuation ? <small>{dayType} Day · {daySlots.map((slot) => `P${slot.period_number}`).join(' + ')}</small> : null}
                  </div>
                  {!readOnly ? <button
                    aria-controls={openMenu?.key === `${enrollment.id}:${dayType}:${period}` ? 'schedule-cell-actions' : undefined}
                    aria-expanded={openMenu?.key === `${enrollment.id}:${dayType}:${period}`}
                    aria-haspopup="menu"
                    aria-label={`Actions for ${enrollment.class.course_name}`}
                    className="cell-menu-trigger"
                    type="button"
                    onClick={(event) => toggleMenu(event, enrollment, dayType, period)}
                  ><MoreVertical size={18} aria-hidden="true" /></button> : null}
                </div>
              )
            })}
          </div>
        ))}
      </div>
      </div>
      {openMenu ? createPortal(
        <div className="cell-menu-popover" id="schedule-cell-actions" ref={menuRef} role="menu" style={openMenu.style}>
          <div className="cell-menu-term"><span>Academic term</span><strong>{termLabels[openMenu.enrollment.academic_term]}</strong></div>
          <button type="button" role="menuitem" onClick={() => {
            closeMenu(true)
            onReplace(openMenu.enrollment, openMenu.dayType, openMenu.period)
          }}>Edit or replace class</button>
          <button className="danger-text" type="button" role="menuitem" onClick={() => {
            closeMenu(true)
            onRemove(openMenu.enrollment)
          }}>Remove class</button>
        </div>,
        document.body,
      ) : null}
    </>
  )
}
