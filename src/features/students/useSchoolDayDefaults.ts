import { useNow } from '../../hooks/useNow'
import { resolveBellNow } from '../../lib/bellSchedule'
import type { DayType, SemesterTerm } from '../../lib/domain'
import { useBellSchedule } from '../bell/BellScheduleProvider'

export interface SchoolDayDefaults {
  /** Semester of today, or of the next school day. */
  semester: SemesterTerm | null
  /** A/B day of today, or of the next school day. */
  dayType: DayType | null
  /** Today's A/B day, only when today is a school day. */
  todayDayType: DayType | null
  todaySemester: SemesterTerm | null
}

/**
 * Where the calendar is, so a read-only schedule opens on the semester and
 * A/B day that matter right now instead of always Semester 1, A day.
 */
export function useSchoolDayDefaults(): SchoolDayDefaults {
  const { days } = useBellSchedule()
  const now = useNow(60_000)
  const bell = resolveBellNow(now, days)
  return {
    semester: bell.day?.semester ?? null,
    dayType: bell.day?.day_type ?? null,
    todayDayType: bell.isToday ? bell.day?.day_type ?? null : null,
    todaySemester: bell.isToday ? bell.day?.semester ?? null : null,
  }
}
