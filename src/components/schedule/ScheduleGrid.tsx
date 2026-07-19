import { AlertTriangle, MoreVertical, Plus } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { termLabels, type AcademicTerm, type DayType, type ScheduleEnrollment } from '../../lib/domain'
import { enrollmentAtSlot, findScheduleConflicts, hasMultiplePeriodsOnAnyDay, isMeetingSlotContinuation, meetingSlotsForDay, PERIOD_NUMBERS } from '../../lib/schedule'

interface ScheduleGridProps {
  enrollments: ScheduleEnrollment[]
  selectedTerm: AcademicTerm
  onAdd: (dayType: DayType, period: number) => void
  onRemove: (enrollment: ScheduleEnrollment) => void
  onReplace: (enrollment: ScheduleEnrollment, dayType: DayType, period: number) => void
  onTermChange: (enrollment: ScheduleEnrollment, term: AcademicTerm) => void
  readOnly?: boolean
}

interface CellMenuState {
  key: string
  enrollment: ScheduleEnrollment
  dayType: DayType
  period: number
  style: CSSProperties
}

export function ScheduleGrid({ enrollments, selectedTerm, onAdd, onRemove, onReplace, onTermChange, readOnly = false }: ScheduleGridProps) {
  const conflicts = findScheduleConflicts(enrollments)
  const conflictedIds = new Set(conflicts.flatMap((pair) => pair.map((enrollment) => enrollment.id)))
  const [openMenu, setOpenMenu] = useState<CellMenuState | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!openMenu) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) setOpenMenu(null)
    }
    const closeMenu = () => setOpenMenu(null)
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('scroll', closeMenu, true)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
    }
  }, [openMenu])

  function toggleMenu(event: MouseEvent<HTMLButtonElement>, enrollment: ScheduleEnrollment, dayType: DayType, period: number) {
    const key = `${enrollment.id}:${dayType}:${period}`
    if (openMenu?.key === key) {
      setOpenMenu(null)
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
              const daySlots = meetingSlotsForDay(enrollment.class.meeting_slots, dayType)
              const hasMultiplePeriods = daySlots.length > 1
              const isDoublePeriod = enrollment.class.is_double_period || hasMultiplePeriodsOnAnyDay(enrollment.class.meeting_slots)
              const continuation = isMeetingSlotContinuation(enrollment.class.meeting_slots, { day_type: dayType, period_number: period })
              const conflicted = conflictedIds.has(enrollment.id)
              return (
                <div className={`schedule-cell filled-cell ${isDoublePeriod ? 'is-multi-period' : ''} ${continuation ? 'is-continuation' : ''} ${conflicted ? 'has-conflict' : ''}`} role="gridcell" data-day={dayType} data-period={period} data-continuation={continuation || undefined} key={dayType}>
                  {conflicted ? <AlertTriangle className="conflict-icon" size={18} aria-label="Schedule conflict" /> : null}
                  <div className="class-cell-copy">
                    <strong>{continuation ? `${enrollment.class.course_name} - continues` : enrollment.class.course_name}</strong>
                    <span>{continuation ? 'Continues from previous period' : enrollment.class.teacher_last_name}</span>
                    {hasMultiplePeriods && !continuation ? <small>{dayType} Day · {daySlots.map((slot) => `P${slot.period_number}`).join(' + ')}</small> : null}
                  </div>
                  {!readOnly ? <button
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
        <div className="cell-menu-popover" ref={menuRef} role="menu" style={openMenu.style}>
          <label>Academic term
            <select value={openMenu.enrollment.academic_term} onChange={(event) => {
              onTermChange(openMenu.enrollment, event.target.value as AcademicTerm)
              setOpenMenu(null)
            }}>
              <option value="full_year">Full Year</option>
              <option value="semester_1">Semester 1</option>
              <option value="semester_2">Semester 2</option>
            </select>
          </label>
          <button type="button" role="menuitem" onClick={() => {
            onReplace(openMenu.enrollment, openMenu.dayType, openMenu.period)
            setOpenMenu(null)
          }}>Replace class</button>
          <button className="danger-text" type="button" role="menuitem" onClick={() => {
            onRemove(openMenu.enrollment)
            setOpenMenu(null)
          }}>Remove class</button>
        </div>,
        document.body,
      ) : null}
    </>
  )
}
