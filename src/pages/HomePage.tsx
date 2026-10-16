import { AlertCircle, BookOpen, CalendarDays, ChevronRight, Clock3, ImageUp, RefreshCw, Share2, Shuffle, Users, type LucideIcon } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { DayTimeline } from '../components/bell/DayTimeline'
import { NowBoard } from '../components/bell/NowBoard'
import { useClubPrompt } from '../components/club/ClubPromptProvider'
import { SegmentedControl } from '../components/ui/SegmentedControl'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../features/auth/AuthProvider'
import { useBellSchedule } from '../features/bell/BellScheduleProvider'
import { filledScheduleSlots, ScheduleMeter } from '../features/home/ScheduleMeter'
import { useHomepageLayout } from '../features/home/useHomepageLayout'
import { shareScheduleLink } from '../features/share/shareSchedule'
import { useNow } from '../hooks/useNow'
import { useSchedule } from '../hooks/useSchedule'
import { clearAuthDestination, hasPendingAuthDestination, pendingAuthDestination } from '../lib/authDestination'
import { daysFromToday, easternDateKey, formatEasternDayLabel, resolveBellNow, resolveNextClassTiming, SCHOOL_TIME_ZONE, type BellNow, type NextClassTiming } from '../lib/bellSchedule'
import type { BellCampus, DayType, HomepageStatistic, ScheduleEnrollment } from '../lib/domain'
import { PERIOD_NUMBERS } from '../lib/schedule'
import { getHomepageStatistic } from '../lib/supabase/data'

const TOTAL_SLOTS = PERIOD_NUMBERS.length * 2

const longDateFormatter = new Intl.DateTimeFormat('en-US', { timeZone: SCHOOL_TIME_ZONE, weekday: 'long', month: 'long', day: 'numeric' })
const hourFormatter = new Intl.DateTimeFormat('en-US', { timeZone: SCHOOL_TIME_ZONE, hour: 'numeric', hourCycle: 'h23' })

function greeting(now: Date): string {
  const hour = Number(hourFormatter.format(now))
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function firstName(fullName: string | undefined): string | null {
  const name = fullName?.trim().split(/\s+/)[0]
  return name || null
}

interface ExploreItem {
  to: string
  title: string
  description: string
  Icon: LucideIcon
}

const exploreItems: ExploreItem[] = [
  { to: '/classes', title: 'Classes', description: 'See who’s in each class, period by period.', Icon: BookOpen },
  { to: '/students', title: 'Students', description: 'Find classmates and compare schedules.', Icon: Users },
  { to: '/schedule-engine', title: 'Schedule Engine', description: 'Want classes with friends? See what your schedule would look like if you replace courses.', Icon: Shuffle },
  { to: '/bell', title: 'Bell schedule', description: 'Today’s bells and the school days ahead.', Icon: Clock3 },
]

export function HomePage() {
  const { user, isDemo, profile } = useAuth()
  const { openClubDialog, whyScheduleShareEnabled } = useClubPrompt()
  const { enrollments, loading } = useSchedule()
  const layout = useHomepageLayout()
  const bellSchedule = useBellSchedule()
  const now = useNow(1000)
  const navigate = useNavigate()
  const [statistic, setStatistic] = useState<HomepageStatistic | null>(null)
  const scheduleLoading = Boolean(user) && loading
  const ownEnrollments = user ? enrollments : undefined
  const bell = resolveBellNow(now, bellSchedule.days)
  const nextClass = ownEnrollments?.some((enrollment) => enrollment.active) ? resolveNextClassTiming(now, bellSchedule.days, ownEnrollments) : null

  useEffect(() => {
    if (!user || !hasPendingAuthDestination()) return
    const destination = pendingAuthDestination()
    clearAuthDestination()
    void navigate(destination, { replace: true })
  }, [navigate, user])

  useEffect(() => {
    if (isDemo) return
    let active = true
    void getHomepageStatistic().then((value) => { if (active) setStatistic(value) }).catch(() => undefined)
    return () => { active = false }
  }, [isDemo])

  if (layout === null) {
    return <div className="home is-pending" role="status" aria-label="Loading home"><span className="skeleton home-skeleton-title" /><span className="skeleton home-skeleton-block" /></div>
  }

  const aside = layout === 'bell_schedule'
    ? user
      ? <ScheduleStatus enrollments={enrollments} loading={scheduleLoading} compact />
      : <GuestInvite statistic={statistic} whyScheduleShareEnabled={whyScheduleShareEnabled} />
    : null

  const todayKey = easternDateKey(now)
  const todayDay = bellSchedule.days.find((day) => day.date === todayKey && !day.no_school && day.schedule)
  const bellSection = <TodayBells
    bell={bell}
    todayDayType={todayDay ? todayDay.day_type : undefined}
    now={now}
    enrollments={ownEnrollments}
    nextClass={nextClass}
    status={bellSchedule.status}
    campus={bellSchedule.campus}
    canChooseCampus={bellSchedule.canChooseCampus}
    onCampusChange={bellSchedule.setGuestCampus}
    onRetry={bellSchedule.retry}
    variant={layout === 'bell_schedule' ? 'hero' : 'strip'}
    aside={aside}
  />

  const club = user ? <div className="home-footnote"><Statistic statistic={statistic} /><p className="home-club">ScheduleShare is made by students in the NA Computer and AI Club. <button className="inline-link" type="button" onClick={openClubDialog} aria-label="Join the NA Computer and AI Club">Join the club</button></p></div> : null

  if (layout === 'bell_schedule') {
    return (
      <div className="home is-bell-focused">
        {bellSection}
        <Explore signedIn={Boolean(user)} omitBell />
        {club}
      </div>
    )
  }

  return (
    <div className="home is-balanced">
      {user
        ? <header className="home-greeting">
          <h1>{greeting(now)}{firstName(profile?.full_name) ? `, ${firstName(profile?.full_name)}` : ''}</h1>
          <p>{longDateFormatter.format(now)}{todayDay?.day_type ? ` is ${todayDay.day_type === 'A' ? 'an' : 'a'} ${todayDay.day_type} day` : ''}.</p>
        </header>
        : <GuestHero statistic={statistic} whyScheduleShareEnabled={whyScheduleShareEnabled} />}
      {bellSection}
      {user ? <ScheduleStatus enrollments={enrollments} loading={scheduleLoading} /> : <HowItWorks />}
      <Explore signedIn={Boolean(user)} />
      {club}
    </div>
  )
}

interface TodayBellsProps {
  bell: BellNow
  /** Today's A/B day when today is a school day (null if unknown), undefined otherwise. */
  todayDayType: DayType | null | undefined
  now: Date
  enrollments: ScheduleEnrollment[] | undefined
  nextClass: NextClassTiming | null
  status: 'loading' | 'ready' | 'error'
  campus: BellCampus
  canChooseCampus: boolean
  onCampusChange: (campus: BellCampus) => void
  onRetry: () => void
  variant: 'hero' | 'strip'
  /** Bell-focused layout only: content that sits under the now board on wide screens. */
  aside?: ReactNode
}

function TodayBells({ bell, todayDayType, now, enrollments, nextClass, status, campus, canChooseCampus, onCampusChange, onRetry, variant, aside }: TodayBellsProps) {
  const campusControl = canChooseCampus
    ? <SegmentedControl label="Campus" value={campus} onChange={onCampusChange} options={[{ value: 'NASH', label: 'NASH' }, { value: 'NAI', label: 'NAI' }]} />
    : null

  const body = status === 'loading'
    ? <div className={variant === 'hero' ? 'home-bell-loading is-hero' : 'home-bell-loading'} role="status" aria-label="Loading today’s bell schedule"><span className="skeleton" /><span className="skeleton" /></div>
    : status === 'error'
      ? <div className="notice notice-danger home-bell-error" role="alert"><AlertCircle aria-hidden="true" /><div><strong>The bell schedule didn’t load.</strong> Check your connection and try again.</div><button className="button button-secondary button-sm" type="button" onClick={onRetry}><RefreshCw aria-hidden="true" />Try again</button></div>
      : bell.state === 'none' || !bell.day
        ? <p className="home-bell-empty">No school days are on the bell calendar right now.</p>
        : null

  if (variant === 'strip') {
    return (
      <section className="home-now" aria-labelledby="home-now-title">
        <div className="section-header">
          <h2 id="home-now-title">Right now</h2>
          {campusControl ?? <span className="section-count">{campus}</span>}
        </div>
        {body ?? <NowBoard bell={bell} now={now} enrollments={enrollments} nextClass={nextClass} variant="strip" />}
      </section>
    )
  }

  const day = bell.day
  const dayLabel = day ? formatEasternDayLabel(day.date, now) : null
  const scheduleName = day?.schedule?.display_name.trim()
  return (
    <section className="home-bell" aria-labelledby="home-bell-title">
      <header className="home-bell-header">
        <div>
          <h1 id="home-bell-title">{longDateFormatter.format(now)}</h1>
          <div className="chip-list">
            {todayDayType ? <span className="chip">{todayDayType} day</span> : null}
            {todayDayType === undefined && status === 'ready' && bell.state !== 'none' ? <span className="chip">No school today</span> : null}
            <span className="chip">{campus}</span>
            {bell.isToday && scheduleName && scheduleName.toLowerCase() !== 'regular' ? <span className="chip is-gold">{scheduleName}</span> : null}
          </div>
        </div>
        {campusControl}
      </header>
      {body ? <>{body}{aside}</> : null}
      {!body && day ? <div className="home-bell-grid">
        <NowBoard bell={bell} now={now} enrollments={enrollments} nextClass={nextClass} variant="hero" />
        <div className="home-bell-day">
          <div className="section-header">
            <div>
              <h2>{dayLabel === 'Today' ? 'Today’s bells' : daysFromToday(day.date, now) < 7 ? `${dayLabel}’s bells` : `Bells on ${dayLabel}`}</h2>
              {!bell.isToday && day.day_type ? <p>{day.day_type} day</p> : null}
            </div>
            <Link className="inline-link" to="/bell">Other days</Link>
          </div>
          <DayTimeline day={day} now={now} enrollments={enrollments} label={`${dayLabel ?? 'Day'} bell schedule`} />
        </div>
        {aside ? <div className="home-bell-aside">{aside}</div> : null}
      </div> : null}
    </section>
  )
}

function ScheduleStatus({ enrollments, loading, compact = false }: { enrollments: ScheduleEnrollment[]; loading: boolean; compact?: boolean }) {
  const { showToast } = useToast()
  const [sharing, setSharing] = useState(false)
  const filled = filledScheduleSlots(enrollments).size
  const complete = filled >= TOTAL_SLOTS

  async function share() {
    setSharing(true)
    try {
      const result = await shareScheduleLink()
      if (result === 'shared') showToast('Schedule shared.')
      if (result === 'copied') showToast('Schedule link copied.')
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'The schedule link could not be shared.', 'error')
    } finally {
      setSharing(false)
    }
  }

  if (loading) {
    return <section className={compact ? 'home-schedule is-compact is-loading' : 'home-schedule is-loading'} aria-label="Your schedule" aria-busy="true"><span className="skeleton" /><span className="skeleton" /></section>
  }

  const status = filled === 0
    ? { title: 'Start your schedule', description: 'Add your classes to find classmates and share your schedule.' }
    : complete
      ? { title: 'Your schedule is complete', description: 'Send friends a link that shows your full schedule.' }
      : { title: 'Finish your schedule', description: `${filled} of ${TOTAL_SLOTS} periods are filled in. Add the rest for better classmate matches.` }

  return (
    <section className={compact ? 'home-schedule is-compact' : 'home-schedule'} aria-labelledby="home-schedule-title">
      <div className="home-schedule-text">
        <h2 id="home-schedule-title">{status.title}</h2>
        <p>{status.description}</p>
      </div>
      <ScheduleMeter enrollments={enrollments} />
      <div className="home-schedule-actions">
        {filled === 0 ? <Link className="button button-primary" to="/schedule"><ImageUp aria-hidden="true" />Upload my schedule</Link> : null}
        {filled > 0 && !complete ? <Link className="button button-primary" to="/schedule"><CalendarDays aria-hidden="true" />Continue</Link> : null}
        {complete ? <Link className="button button-primary" to="/students"><Users aria-hidden="true" />Find classmates</Link> : null}
        {complete ? <button className="button button-secondary" type="button" disabled={sharing} onClick={() => void share()}><Share2 aria-hidden="true" />{sharing ? 'Sharing…' : 'Share schedule'}</button> : null}
      </div>
    </section>
  )
}

function Statistic({ statistic }: { statistic: HomepageStatistic | null }) {
  if (!statistic) return null
  return <p className="home-statistic"><strong className="numeric">{new Intl.NumberFormat().format(statistic.statistic_value)}</strong> {statistic.statistic_label}</p>
}

function GuestHero({ statistic, whyScheduleShareEnabled }: { statistic: HomepageStatistic | null; whyScheduleShareEnabled: boolean | null }) {
  return (
    <section className="home-hero" aria-labelledby="home-hero-title">
      <div className="home-hero-text">
        <h1 id="home-hero-title">Find out who’s in your classes.</h1>
        <p>Upload a picture of your schedule, find classmates, and share schedules with friends.</p>
        <div className="home-hero-actions">
          <Link className="button button-primary" to="/schedule"><ImageUp aria-hidden="true" />Upload my schedule</Link>
          <Link className="button button-secondary" to="/classes">Browse classes</Link>
        </div>
        <div className="home-hero-meta">
          <Statistic statistic={statistic} />
          {whyScheduleShareEnabled ? <Link className="inline-link" to="/why-scheduleshare">Why we're better than Saturn</Link> : null}
        </div>
        <p className="home-credit">Built by the NA Computer and AI Club</p>
      </div>
      <SchedulePreview />
    </section>
  )
}

const previewRows = [
  { period: 1, course: 'AP Language', people: ['AM', 'JK', 'SR'], more: 5 },
  { period: 2, course: 'Chemistry', people: ['LP', 'DW'], more: 2 },
  { period: 3, course: 'Algebra 2', people: ['EC', 'NB', 'TH'], more: 8 },
  { period: 4, course: 'US History', people: ['MG'], more: 0 },
  { period: 5, course: 'Lunch', people: ['AM', 'LP', 'RJ'], more: 11 },
]

/** A small, decorative example of what the product shows once a schedule is in. */
function SchedulePreview() {
  return (
    <div className="home-preview" aria-hidden="true">
      <div className="home-preview-head"><span>A day</span><span>In your class</span></div>
      <ol>
        {previewRows.map((row) => (
          <li key={row.period}>
            <span className={row.period === 3 ? 'period-numeral is-now' : 'period-numeral'}>{row.period}</span>
            <span className="home-preview-course">{row.course}</span>
            <span className="home-preview-people">
              {row.people.map((initials, index) => <span className="avatar is-small" key={`${initials}-${index}`}>{initials}</span>)}
              {row.more > 0 ? <span className="home-preview-more">+{row.more}</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

function HowItWorks() {
  return (
    <section className="home-steps" aria-labelledby="home-steps-title">
      <h2 id="home-steps-title">How it works</h2>
      <ol>
        <li><span className="home-step-number" aria-hidden="true">1</span><div><h3>Screenshot your schedule</h3><p>Take a picture of your schedule from the school portal, or add classes one at a time.</p></div></li>
        <li><span className="home-step-number" aria-hidden="true">2</span><div><h3>Check your classes</h3><p>ScheduleShare reads the screenshot and matches each class to the course catalog. You confirm anything unclear.</p></div></li>
        <li><span className="home-step-number" aria-hidden="true">3</span><div><h3>See who’s with you</h3><p>Every period shows the classmates who share it, and you choose who can see your schedule.</p></div></li>
      </ol>
    </section>
  )
}

function GuestInvite({ statistic, whyScheduleShareEnabled }: { statistic: HomepageStatistic | null; whyScheduleShareEnabled: boolean | null }) {
  return (
    <section className="home-invite" aria-labelledby="home-invite-title">
      <div>
        <h2 id="home-invite-title">Find out who’s in your classes.</h2>
        <p>Upload a picture of your schedule, find classmates, and share schedules with friends.</p>
        <div className="home-hero-meta">
          <Statistic statistic={statistic} />
          {whyScheduleShareEnabled ? <Link className="inline-link" to="/why-scheduleshare">Why we're better than Saturn</Link> : null}
        </div>
      </div>
      <Link className="button button-primary" to="/schedule"><ImageUp aria-hidden="true" />Upload my schedule</Link>
    </section>
  )
}

function Explore({ signedIn, omitBell = false }: { signedIn: boolean; omitBell?: boolean }) {
  const items = exploreItems.filter((item) => !(omitBell && item.to === '/bell'))
  return (
    <section className="home-explore" aria-labelledby="home-explore-title">
      <h2 id="home-explore-title">{signedIn ? 'Explore' : 'What you can do'}</h2>
      <ul className="home-explore-list">
        {items.map(({ to, title, description, Icon }) => (
          <li key={to}>
            <Link className="home-explore-link" to={to}>
              <Icon className="home-explore-icon" aria-hidden="true" />
              <span><strong>{title}</strong><small>{description}</small></span>
              <ChevronRight className="home-explore-chevron" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
