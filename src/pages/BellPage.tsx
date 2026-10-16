import { AlertCircle, CalendarOff, Clock3, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { DayTimeline } from '../components/bell/DayTimeline'
import { NowBoard } from '../components/bell/NowBoard'
import { EmptyState } from '../components/ui/EmptyState'
import { PageHeader } from '../components/ui/PageHeader'
import { SegmentedControl } from '../components/ui/SegmentedControl'
import { useAuth } from '../features/auth/AuthProvider'
import { useBellSchedule } from '../features/bell/BellScheduleProvider'
import { useNow } from '../hooks/useNow'
import { useSchedule } from '../hooks/useSchedule'
import { easternDateKey, easternLocalTime, formatEasternTime, resolveBellNow, SCHOOL_TIME_ZONE } from '../lib/bellSchedule'
import type { SchoolDayContext } from '../lib/domain'

const weekdayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: SCHOOL_TIME_ZONE, weekday: 'short' })
const dayNumberFormatter = new Intl.DateTimeFormat('en-US', { timeZone: SCHOOL_TIME_ZONE, day: 'numeric' })
const monthFormatter = new Intl.DateTimeFormat('en-US', { timeZone: SCHOOL_TIME_ZONE, month: 'short' })
const longDateFormatter = new Intl.DateTimeFormat('en-US', { timeZone: SCHOOL_TIME_ZONE, weekday: 'long', month: 'long', day: 'numeric' })

function isWeekend(dateKey: string): boolean {
  const day = new Date(`${dateKey}T12:00:00Z`).getUTCDay()
  return day === 0 || day === 6
}

function isSchoolDay(day: SchoolDayContext): boolean {
  return !day.no_school && Boolean(day.schedule?.blocks.length)
}

export function BellPage() {
  const { user } = useAuth()
  const { enrollments } = useSchedule()
  const { days, status, campus, canChooseCampus, setGuestCampus, retry } = useBellSchedule()
  const now = useNow(1000)
  const today = easternDateKey(now)
  const bell = resolveBellNow(now, days)
  const visibleDays = useMemo(
    () => [...days].sort((left, right) => left.date.localeCompare(right.date)).filter((day) => day.date >= today && !(isWeekend(day.date) && !isSchoolDay(day))),
    [days, today],
  )
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const defaultDate = bell.day?.date ?? visibleDays[0]?.date ?? null
  const selected = visibleDays.find((day) => day.date === (selectedDate ?? defaultDate)) ?? null
  const ownEnrollments = user ? enrollments : undefined

  const campusControl = canChooseCampus
    ? <SegmentedControl label="Campus" value={campus} onChange={(value) => { setSelectedDate(null); setGuestCampus(value) }} options={[{ value: 'NASH', label: 'NASH' }, { value: 'NAI', label: 'NAI' }]} />
    : <span className="badge badge-outline">{campus}</span>

  return (
    <div className="page bell-page">
      <PageHeader
        title="Bell schedule"
        description={user ? 'Bell times for the school days ahead, with your class in each period.' : 'Bell times for the school days ahead.'}
        actions={campusControl}
      />

      {status === 'loading' ? <div className="bell-page-loading" role="status" aria-label="Loading bell schedule"><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /></div> : null}

      {status === 'error' ? (
        <div className="notice notice-danger" role="alert">
          <AlertCircle aria-hidden="true" />
          <div><strong>The bell schedule didn’t load.</strong> Check your connection and try again.</div>
          <button className="button button-secondary button-sm" type="button" onClick={retry}><RefreshCw aria-hidden="true" />Try again</button>
        </div>
      ) : null}

      {status === 'ready' && visibleDays.length === 0 ? (
        <EmptyState icon={CalendarOff} title="No school days ahead">The bell calendar doesn’t have any upcoming school days yet.</EmptyState>
      ) : null}

      {status === 'ready' && visibleDays.length > 0 ? (
        <>
          {bell.isToday && bell.state !== 'none' ? <NowBoard bell={bell} now={now} enrollments={ownEnrollments} variant="strip" /> : null}

          <div className="bell-layout">
            <div className="bell-calendar">
              <div className="bell-calendar-head" aria-hidden="true">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((label) => <span key={label}>{label}</span>)}</div>
              <div className="bell-days" role="group" aria-label="Choose a day">
                {visibleDays.map((day, index) => {
                  const date = easternLocalTime(day.date, '12:00')
                  const pressed = selected?.date === day.date
                  const school = isSchoolDay(day)
                  const weekday = new Date(`${day.date}T12:00:00Z`).getUTCDay()
                  const dayNumber = dayNumberFormatter.format(date)
                  const showMonth = index === 0 || visibleDays[index - 1].date.slice(0, 7) !== day.date.slice(0, 7)
                  return (
                    <button
                      className={['bell-day', pressed ? 'is-selected' : '', school ? '' : 'is-off', day.date === today ? 'is-today' : ''].filter(Boolean).join(' ')}
                      key={day.date}
                      type="button"
                      style={weekday >= 1 && weekday <= 5 ? { gridColumnStart: weekday } : undefined}
                      aria-pressed={pressed}
                      aria-current={day.date === today ? 'date' : undefined}
                      aria-label={`${longDateFormatter.format(date)}${school && day.day_type ? `, ${day.day_type} day` : school ? '' : ', no school'}`}
                      onClick={() => setSelectedDate(day.date)}
                    >
                      <span className="bell-day-weekday">{day.date === today ? 'Today' : weekdayFormatter.format(date)}</span>
                      <span className="bell-day-number numeric">{showMonth ? <small>{monthFormatter.format(date)}</small> : null}{dayNumber}</span>
                      <span className="bell-day-type">{school ? (day.day_type ? `${day.day_type} day` : 'School') : 'Off'}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {selected ? <SelectedDay day={selected} now={now} enrollments={ownEnrollments} /> : null}
          </div>
        </>
      ) : null}
    </div>
  )
}

function SelectedDay({ day, now, enrollments }: { day: SchoolDayContext; now: Date; enrollments: Parameters<typeof DayTimeline>[0]['enrollments'] }) {
  const date = easternLocalTime(day.date, '12:00')
  const schedule = day.schedule
  if (!isSchoolDay(day) || !schedule) {
    return (
      <section className="bell-selected" aria-labelledby="bell-selected-title">
        <header className="bell-selected-header"><h2 id="bell-selected-title">{longDateFormatter.format(date)}</h2></header>
        <EmptyState icon={CalendarOff} title="No school" headingLevel={3}>There are no bells on this day.</EmptyState>
      </section>
    )
  }
  return (
    <section className="bell-selected" aria-labelledby="bell-selected-title">
      <header className="bell-selected-header">
        <h2 id="bell-selected-title">{longDateFormatter.format(date)}</h2>
        <div className="chip-list">
          {day.day_type ? <span className="chip">{day.day_type} day</span> : null}
          <span className="chip">{schedule.display_name} schedule</span>
          <span className="chip">{day.semester === 'semester_1' ? 'Semester 1' : 'Semester 2'}</span>
        </div>
      </header>
      {schedule.warning_time ? <p className="bell-warning"><Clock3 aria-hidden="true" />Warning bell at {formatEasternTime(easternLocalTime(day.date, schedule.warning_time))}</p> : null}
      <DayTimeline day={day} now={now} enrollments={enrollments} label={`${longDateFormatter.format(date)} bell schedule`} />
    </section>
  )
}
