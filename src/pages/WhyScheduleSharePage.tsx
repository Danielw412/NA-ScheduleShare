import { ChevronLeft, ImageUp } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../features/auth/AuthProvider'

interface ScheduleShareReason {
  title: string
  description: string
}

const reasons: ScheduleShareReason[] = [
  {
    title: 'Just need a screenshot',
    description: 'Upload PowerSchool screenshots and we turn them into your schedule. No more typing every class, teacher, and period by hand. AI really is replacing everything.',
  },
  {
    title: 'Trick your counselor',
    description: 'Want classes with your friends? See how your schedule would look if you dropped a class.',
  },
  {
    title: 'Your actual schedule',
    description: 'We account for semesters, A/B days, and course name variations, so you won’t be surprised when your ex is in your class.',
  },
  {
    title: 'No notifications!',
    description: 'We don’t invent reasons to buzz your phone all day. Check your schedule when you need it and keep your lock screen clean.',
  },
  {
    title: 'We’re not annoying',
    description: 'No random popups, and no asking you to share the app with everyone you’ve ever met.',
  },
  {
    title: 'NAI and NASH are not the same building',
    description: 'You won’t find 9th graders and 12th graders in the same lunch.',
  },
  {
    title: 'Just a website',
    description: 'You don’t need to install an entire app to answer “who’s in my third period?”',
  },
  {
    title: 'Anti-stalking',
    description: 'Choose who can see your schedule. Your third period isn’t public information.',
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
    <div className="page why-page">
      {/* PageHeader's markup, with a history-aware back button instead of a fixed link. */}
      <header className="page-header why-header">
        <div className="page-header-text">
          <button className="back-link why-back" type="button" onClick={goBack}><ChevronLeft aria-hidden="true" />Back</button>
          <h1>Why ScheduleShare over Saturn</h1>
          <p>Eight reasons, from the students who built it.</p>
        </div>
      </header>

      <ol className="why-reasons">
        {reasons.map(({ title, description }, index) => (
          <li key={title}>
            <span className="why-reason-number numeric" aria-hidden="true">{index + 1}</span>
            <div>
              <h2>{title}</h2>
              <p>{description}</p>
            </div>
          </li>
        ))}
      </ol>

      <section className="why-final" aria-labelledby="why-final-title">
        <h2 id="why-final-title">Ditch Saturn</h2>
        <p>Upload a screenshot of your schedule and see who’s in your classes.</p>
        <div className="form-actions">
          {!user ? <Link className="button button-primary" to="/schedule?import=1"><ImageUp aria-hidden="true" />Upload my schedule</Link> : null}
          <button className="button button-secondary" type="button" onClick={goBack}><ChevronLeft aria-hidden="true" />Back</button>
        </div>
      </section>
    </div>
  )
}
