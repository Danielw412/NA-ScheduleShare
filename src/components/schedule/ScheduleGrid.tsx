import { AlertTriangle, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { termLabels, type AcademicTerm, type DayType, type ScheduleEnrollment, type SemesterTerm } from '../../lib/domain'
import { enrollmentAtSlot, enrollmentMeetingSlots, hasMultiplePeriodsOnAnyDay, isMeetingSlotContinuation, meetingSlotsForDay, PERIOD_NUMBERS } from '../../lib/schedule'
import { SegmentedControl } from '../ui/SegmentedControl'
import { periodsLabel } from './periodLabels'
import { conflictsInTerm } from './termConflicts'

interface ScheduleGridProps {
  enrollments: ScheduleEnrollment[]
  selectedTerm: SemesterTerm
  onAdd: (dayType: DayType, period: number) => void
  onRemove: (enrollment: ScheduleEnrollment) => void
  onReplace: (enrollment: ScheduleEnrollment, dayType: DayType, period: number) => void
  readOnly?: boolean
  changedEnrollmentIds?: ReadonlySet<string>
  /**
   * The day shown when the grid is narrow (phones). Passing it without
   * onMobileDayChange means the caller renders its own day switch.
   */
  mobileDay?: DayType
  /** Pair with mobileDay to drive the grid's built-in A/B switch. */
  onMobileDayChange?: (day: DayType) => void
  /** The day the narrow grid opens on when nobody has picked one yet. */
  defaultMobileDay?: DayType | null
  /** Today's day type, when today is a school day in the selected semester. */
  todayDayType?: DayType | null
  /** The class period in session right now (on todayDayType). */
  currentPeriod?: number | null
}

interface CellMenuState {
  key: string
  enrollment: ScheduleEnrollment
  dayType: DayType
  period: number
  style: CSSProperties
}

const DAYS: DayType[] = ['A', 'B']

/** Sentence-case term names for the grid; the shared termLabels stay title case for other screens. */
const termNames: Record<AcademicTerm, string> = {
  full_year: 'Full year',
  semester_1: 'Semester 1',
  semester_2: 'Semester 2',
}

function dayName(day: DayType): string {
  return `${day} day`
}

function isPlaceholderTeacher(teacher: string): boolean {
  return teacher.trim().toUpperCase() === 'N/A'
}

interface ColumnCell {
  enrollment: ScheduleEnrollment | undefined
  continuation: boolean
  /** Drawn as part of the class block that starts in the period above. */
  merged: boolean
  span: number
}

/**
 * Works out, for one day column, which class sits in each period and which
 * consecutive periods of the same class merge into a single block.
 */
function buildColumn(enrollments: ScheduleEnrollment[], dayType: DayType, selectedTerm: SemesterTerm): ColumnCell[] {
  const cells: ColumnCell[] = PERIOD_NUMBERS.map((period) => {
    const enrollment = enrollmentAtSlot(enrollments, dayType, period, selectedTerm)
    const continuation = enrollment
      ? isMeetingSlotContinuation(enrollmentMeetingSlots(enrollment), { day_type: dayType, period_number: period })
      : false
    return { enrollment, continuation, merged: false, span: 1 }
  })
  for (let index = 1; index < cells.length; index += 1) {
    const cell = cells[index]
    const previous = cells[index - 1]
    if (!cell.enrollment || !cell.continuation || previous.enrollment?.id !== cell.enrollment.id) continue
    cell.merged = true
    let start = index - 1
    while (start > 0 && cells[start].merged) start -= 1
    cells[start].span += 1
  }
  return cells
}

export function ScheduleGrid({
  enrollments,
  selectedTerm,
  onAdd,
  onRemove,
  onReplace,
  readOnly = false,
  changedEnrollmentIds,
  mobileDay,
  onMobileDayChange,
  defaultMobileDay,
  todayDayType,
  currentPeriod,
}: ScheduleGridProps) {
  // Only clashes in the semester on screen; matches the page's conflict notice.
  const conflicts = conflictsInTerm(enrollments, selectedTerm)
  const conflictedIds = new Set(conflicts.flatMap((pair) => pair.map((enrollment) => enrollment.id)))
  const [openMenu, setOpenMenu] = useState<CellMenuState | null>(null)
  const [chosenDay, setChosenDay] = useState<DayType | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const shownDay: DayType = mobileDay ?? chosenDay ?? defaultMobileDay ?? todayDayType ?? 'A'
  const showDaySwitch = mobileDay === undefined || onMobileDayChange !== undefined
  const columns = { A: buildColumn(enrollments, 'A', selectedTerm), B: buildColumn(enrollments, 'B', selectedTerm) }
  const nowPeriod = todayDayType && currentPeriod ? currentPeriod : null

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

  function changeShownDay(day: DayType) {
    onMobileDayChange?.(day)
    if (mobileDay === undefined) setChosenDay(day)
  }

  function toggleMenu(event: MouseEvent<HTMLButtonElement>, enrollment: ScheduleEnrollment, dayType: DayType, period: number) {
    const key = `${enrollment.id}:${dayType}:${period}`
    if (openMenu?.key === key) {
      closeMenu(true)
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const menuWidth = 240
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

  const gridClasses = [
    'schedule-grid',
    `is-showing-${shownDay.toLowerCase()}`,
    todayDayType && shownDay === todayDayType ? 'is-showing-today' : '',
    readOnly ? 'is-readonly' : '',
  ].filter(Boolean).join(' ')

  return (
    <>
      <div className="schedule-grid-wrap">
        {showDaySwitch ? (
          <SegmentedControl
            className="schedule-day-switch"
            label="Day shown"
            value={shownDay}
            onChange={changeShownDay}
            options={DAYS.map((day) => ({
              value: day,
              label: <>{dayName(day)}{todayDayType === day ? <span className="schedule-today-tag">Today</span> : null}</>,
            }))}
          />
        ) : null}
        <div className={gridClasses} role="grid" aria-label={`${termLabels[selectedTerm]} A/B-day schedule`}>
          <div className="schedule-grid-head" role="row">
            <div className="schedule-grid-corner" role="columnheader"><span className="sr-only">Period</span></div>
            {DAYS.map((day) => (
              <div className={todayDayType === day ? 'schedule-day-head is-today' : 'schedule-day-head'} data-day={day} role="columnheader" key={day}>
                {dayName(day)}
                {todayDayType === day ? <span className="schedule-today-tag">Today</span> : null}
              </div>
            ))}
          </div>
          {PERIOD_NUMBERS.map((period, periodIndex) => {
            const isNowRow = nowPeriod === period
            return (
              <div className="schedule-row" role="row" data-period={period} key={period}>
                <div className="schedule-period" role="rowheader" data-period={period} style={{ gridRow: period + 1 }}>
                  <span className="sr-only">Period </span>
                  <span className={isNowRow ? 'period-numeral is-now' : 'period-numeral'}>{period}</span>
                </div>
                {DAYS.map((dayType) => {
                  const cell = columns[dayType][periodIndex]
                  const enrollment = cell.enrollment
                  // A merged block is "now" when any of the periods it covers is.
                  const isNow = nowPeriod !== null && todayDayType === dayType && nowPeriod >= period && nowPeriod < period + cell.span
                  const placement: CSSProperties = { gridRow: `${period + 1} / span ${cell.span}` }
                  if (!enrollment) {
                    const emptyClasses = ['schedule-cell', 'is-empty', readOnly ? 'is-readonly' : '', isNow ? 'is-now' : ''].filter(Boolean).join(' ')
                    return (
                      <div className={emptyClasses} role="gridcell" data-day={dayType} data-period={period} style={placement} key={dayType}>
                        {readOnly
                          ? <span className="schedule-cell-free">No class</span>
                          : (
                            <button
                              className="schedule-cell-add"
                              type="button"
                              aria-label={`Add class, ${dayName(dayType)} period ${period}`}
                              onClick={() => onAdd(dayType, period)}
                            >
                              <Plus aria-hidden="true" />
                              <span>Add class</span>
                            </button>
                          )}
                      </div>
                    )
                  }
                  const attendanceSlots = enrollmentMeetingSlots(enrollment)
                  const daySlots = meetingSlotsForDay(attendanceSlots, dayType)
                  const hasMultiplePeriods = daySlots.length > 1
                  const isDoublePeriod = enrollment.class.is_double_period || hasMultiplePeriodsOnAnyDay(attendanceSlots)
                  const conflicted = conflictedIds.has(enrollment.id)
                  const changed = changedEnrollmentIds?.has(enrollment.id) ?? false
                  const menuKey = `${enrollment.id}:${dayType}:${period}`
                  const teacher = enrollment.class.teacher_last_name
                  const cellClasses = [
                    'schedule-cell',
                    'is-filled',
                    isDoublePeriod ? 'is-multi-period' : '',
                    cell.continuation ? 'is-continuation' : '',
                    cell.merged ? 'is-merged' : '',
                    cell.span > 1 ? 'is-block' : '',
                    conflicted ? 'is-conflict' : '',
                    changed ? 'is-predicted-change' : '',
                    isNow ? 'is-now' : '',
                    !readOnly ? 'is-actionable' : '',
                  ].filter(Boolean).join(' ')

                  // Later periods of a merged block keep their grid position for
                  // assistive tech bookkeeping, but the block above covers them.
                  if (cell.merged) {
                    return (
                      <div
                        className={cellClasses}
                        role="gridcell"
                        data-day={dayType}
                        data-period={period}
                        data-continuation="true"
                        data-predicted-change={changed || undefined}
                        hidden
                        key={dayType}
                      />
                    )
                  }

                  return (
                    <div
                      className={cellClasses}
                      role="gridcell"
                      aria-rowspan={cell.span > 1 ? cell.span : undefined}
                      data-day={dayType}
                      data-period={period}
                      data-continuation={cell.continuation || undefined}
                      data-predicted-change={changed || undefined}
                      style={placement}
                      key={dayType}
                    >
                      <div className="schedule-cell-copy">
                        {isNow ? <span className="schedule-cell-now">Now</span> : null}
                        <strong className="schedule-cell-course">{enrollment.class.course_name}</strong>
                        {cell.continuation
                          ? <span className="schedule-cell-teacher">Continues from period {period - 1}</span>
                          : !isPlaceholderTeacher(teacher) ? <span className="schedule-cell-teacher">{teacher}</span> : null}
                        {(hasMultiplePeriods && !cell.continuation) || changed || conflicted ? (
                          <span className="schedule-cell-tags">
                            {hasMultiplePeriods && !cell.continuation ? <span className="schedule-cell-periods">{periodsLabel(daySlots.map((slot) => slot.period_number))}</span> : null}
                            {changed ? <span className="badge badge-gold">Changed</span> : null}
                            {conflicted ? <span className="schedule-cell-conflict"><AlertTriangle aria-hidden="true" />Conflict</span> : null}
                          </span>
                        ) : null}
                      </div>
                      {!readOnly ? (
                        <button
                          aria-controls={openMenu?.key === menuKey ? 'schedule-cell-actions' : undefined}
                          aria-expanded={openMenu?.key === menuKey}
                          aria-haspopup="menu"
                          aria-label={`Actions for ${enrollment.class.course_name}`}
                          className="schedule-cell-action"
                          type="button"
                          onClick={(event) => toggleMenu(event, enrollment, dayType, period)}
                        >
                          <MoreHorizontal aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
      {openMenu ? createPortal(
        <div className="schedule-menu" id="schedule-cell-actions" ref={menuRef} role="menu" aria-label={`${openMenu.enrollment.class.course_name} actions`} style={openMenu.style}>
          <div className="schedule-menu-header" role="none">
            <strong>{openMenu.enrollment.class.course_name}</strong>
            <span className="schedule-menu-facts">
              <span className="chip">{termNames[openMenu.enrollment.academic_term]}</span>
              <span className="chip">{dayName(openMenu.dayType)}</span>
            </span>
          </div>
          <button type="button" role="menuitem" onClick={() => {
            closeMenu(true)
            onReplace(openMenu.enrollment, openMenu.dayType, openMenu.period)
          }}><Pencil aria-hidden="true" />Edit or replace class</button>
          <button className="is-danger" type="button" role="menuitem" onClick={() => {
            closeMenu(true)
            onRemove(openMenu.enrollment)
          }}><Trash2 aria-hidden="true" />Remove class</button>
        </div>,
        document.body,
      ) : null}
    </>
  )
}
