import {
  ArrowRight,
  ArrowLeft,
  BellOff,
  CalendarCheck2,
  Globe2,
  ImagePlus,
  MapPin,
  MousePointerClick,
  ShieldCheck,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../features/auth/AuthProvider'

interface ScheduleShareReason {
  title: string
  description: string
  Icon: LucideIcon
}

const reasons: ScheduleShareReason[] = [
  {
    title: 'Just need a screenshot',
    description: 'Upload PowerSchool screenshots and we will turn them into a schedule. No more typing every class, teacher, period by hand. AI is really replacing everything...',
    Icon: ImagePlus,
  },
  {
    title: 'Your actual schedule',
    description: 'We account for semesters, A/B days, and course name variations so you wont be surprised when your ex is in your class.',
    Icon: CalendarCheck2,
  },
  {
    title: 'No notifications!',
    description: 'We dont come up with reasons to buzz your phone all day. Check your schedule when you need it and keep your lockscreen clean',
    Icon: BellOff,
  },
  {
    title: 'We\'re not annoying',
    description: 'No random popups and no asking you to share the app with everyone you have ever met.',
    Icon: MousePointerClick,
  },
    {
    title: 'NAI and NASH are not the same building.',
    description: 'Now you wont find 9th graders and 12th graders in the same lunch.',
    Icon: MapPin,
  },
  {
    title: 'Just a website',
    description: 'You do not need to install an entire app just to answer “who is in my third period?”',
    Icon: Globe2,
  },
  {
    title: 'Anti-stalking',
    description: 'Choose who can see your schedule. Your third period is not public information.',
    Icon: ShieldCheck,
  }
]

export function WhyScheduleSharePage() {
  const { user } = useAuth()
  const navigate = useNavigate()

  function goBack() {
    if (window.history.length > 1) {
      void navigate(-1)
      return
    }
    void navigate('/')
  }

  return (
    <div className="why-page">
      <section className="why-hero">
        <div className="why-hero-copy">
          <h1>Why ScheduleShare over Saturn</h1>
          <button className="button button-primary" type="button" onClick={goBack}>Back <ArrowLeft size={18} aria-hidden="true" /></button>
        </div>
      </section>

      <ol className="why-reasons">
        {reasons.map(({ title, description, Icon }, index) => (
          <li key={title}>
            <span className="why-reason-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
            <span className="why-reason-icon"><Icon aria-hidden="true" /></span>
            <div>
              <h2>{title}</h2>
              <p>{description}</p>
            </div>
          </li>
        ))}
      </ol>

      <section className="why-final">
        <div>
          <h2>Ditch Saturn!</h2>
          <p>Upload a screenshot and see your classes!</p>
        </div>
        <div className="why-final-actions">
          {!user ? <Link className="button button-primary" to="/schedule?import=1">Upload My Schedule <ArrowRight size={18} aria-hidden="true" /></Link> : null}
          <button className="button button-secondary why-back-button" type="button" onClick={goBack}>Back <ArrowLeft size={18} aria-hidden="true" /></button>
        </div>
      </section>
    </div>
  )
}
