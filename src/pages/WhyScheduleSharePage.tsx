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
  aside: string
  Icon: LucideIcon
}

const reasons: ScheduleShareReason[] = [
  {
    title: 'Screenshot in. Schedule out.',
    description: 'Upload PowerSchool screenshots and ScheduleShare turns them into a schedule. No typing every class, teacher, period, and day by hand.',
    aside: 'PowerSchool already did the typing. We let it keep the job.',
    Icon: ImagePlus,
  },
  {
    title: 'Your schedule means your actual schedule.',
    description: 'We account for semesters, A/B days, attendance patterns, and course-name variations—so classmate matches are based on when you really share a class.',
    aside: 'More schedule detail in. Fewer mystery classmates out.',
    Icon: CalendarCheck2,
  },
  {
    title: 'Your lock screen can remain peaceful.',
    description: 'ScheduleShare will not manufacture reasons to buzz your phone all day. Check your schedule when you need it; enjoy the silence when you do not.',
    aside: 'No engagement campaign disguised as breaking news.',
    Icon: BellOff,
  },
  {
    title: 'It gets out of your way.',
    description: 'No nagging popups, no forced invites, and no guilt trip about sharing the app with everyone you have ever met. The useful thing is simply the useful thing.',
    aside: 'Radical concept: one click should take one click.',
    Icon: MousePointerClick,
  },
  {
    title: 'A website that is happy being a website.',
    description: 'Open ScheduleShare on your phone or computer and it works. You do not need to install an entire app just to answer “who is in my third period?”',
    aside: 'No app-store detour. No storage-space negotiation.',
    Icon: Globe2,
  },
  {
    title: 'Privacy has real controls.',
    description: 'Choose who can see your schedule, approve access requests, and share with private links. Being useful does not require making your schedule public.',
    aside: 'Your schedule is social only when you say so.',
    Icon: ShieldCheck,
  },
  {
    title: 'NAI and NASH are not the same building.',
    description: 'Saturn can combine NAI and NASH classes. ScheduleShare keeps the schools straight, which keeps class listings and classmate matches straight too.',
    aside: 'A small geographic detail with a very large hallway between it.',
    Icon: MapPin,
  },
  {
    title: 'Built around NA’s particular flavor of scheduling.',
    description: 'NA course names, semester rules, unusual attendance patterns, Lunch, Study Hall, and the other details generic schedule apps tend to flatten are part of the design here.',
    aside: 'General-purpose is fine. NA-purpose is better for NA.',
    Icon: CalendarCheck2,
  },
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

      <section className="why-intro" aria-labelledby="why-reasons-heading">
        <h2 id="why-reasons-heading">The case, without the notification campaign</h2>
        <p>Eight reasons. Zero popups asking you to invite eight friends before you can read them.</p>
      </section>

      <ol className="why-reasons">
        {reasons.map(({ title, description, aside, Icon }, index) => (
          <li key={title}>
            <span className="why-reason-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
            <span className="why-reason-icon"><Icon aria-hidden="true" /></span>
            <div>
              <h2>{title}</h2>
              <p>{description}</p>
              <small>{aside}</small>
            </div>
          </li>
        ))}
      </ol>

      <section className="why-final">
        <div>
          <h2>Built for your schedule, not your screen time.</h2>
          <p>See how quickly a PowerSchool screenshot becomes something useful.</p>
        </div>
        <div className="why-final-actions">
          {!user ? <Link className="button button-primary" to="/schedule?import=1">Upload My Schedule <ArrowRight size={18} aria-hidden="true" /></Link> : null}
          <button className="button button-secondary why-back-button" type="button" onClick={goBack}>Back <ArrowLeft size={18} aria-hidden="true" /></button>
        </div>
      </section>
    </div>
  )
}
