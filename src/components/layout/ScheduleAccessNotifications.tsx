import { Bell, Check, LoaderCircle, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ScheduleAccessNotification, ScheduleAccessNotifications } from '../../lib/domain'
import {
  announceScheduleAccessChanged,
  getScheduleAccessNotifications,
  markScheduleAccessNotificationsRead,
  respondScheduleAccessRequest,
  scheduleAccessChangedEvent,
} from '../../lib/supabase/data'
import { supabase } from '../../lib/supabase/client'
import { ProfileAvatar } from '../ui/ProfileAvatar'

const emptyNotifications: ScheduleAccessNotifications = { count: 0, notifications: [] }

function notificationDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
}

export function ScheduleAccessNotifications({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [bundle, setBundle] = useState<ScheduleAccessNotifications>(emptyNotifications)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [respondingTo, setRespondingTo] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const requestVersion = useRef(0)

  const refresh = useCallback(async (showLoading = false) => {
    const version = ++requestVersion.current
    if (showLoading) setLoading(true)
    try {
      const next = await getScheduleAccessNotifications()
      if (requestVersion.current !== version) return
      setBundle(next)
      setError(null)
    } catch {
      if (requestVersion.current === version) setError('Notifications could not be loaded.')
    } finally {
      if (requestVersion.current === version) setLoading(false)
    }
  }, [])

  useEffect(() => {
    setBundle(emptyNotifications)
    setLoading(true)
    void refresh()

    const handleAccessChange = () => void refresh()
    const handleFocus = () => void refresh()
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') handleFocus()
    }, 5 * 60_000)
    window.addEventListener(scheduleAccessChangedEvent, handleAccessChange)
    window.addEventListener('focus', handleFocus)

    const channel = supabase
      ?.channel(`schedule-access-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedule_access_requests', filter: `owner_id=eq.${userId}` }, announceScheduleAccessChanged)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'schedule_access_requests', filter: `requester_id=eq.${userId}` }, announceScheduleAccessChanged)
      .subscribe()

    return () => {
      requestVersion.current += 1
      window.clearInterval(interval)
      window.removeEventListener(scheduleAccessChangedEvent, handleAccessChange)
      window.removeEventListener('focus', handleFocus)
      if (channel && supabase) void supabase.removeChannel(channel)
    }
  }, [refresh, userId])

  useEffect(() => {
    if (!open) return
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePress)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    void refresh(true).then(async () => {
      await markScheduleAccessNotificationsRead()
      setBundle((current) => ({
        count: current.notifications.filter((item) => item.kind === 'incoming_request').length,
        notifications: current.notifications.map((item) => item.kind === 'request_update' ? { ...item, read: true } : item),
      }))
    })
  }, [open, refresh])

  async function respond(notification: ScheduleAccessNotification, allow: boolean) {
    setRespondingTo(notification.request_id)
    setFeedback(null)
    setError(null)
    try {
      await respondScheduleAccessRequest(notification.request_id, allow)
      setFeedback(allow ? 'Schedule access allowed.' : 'Request declined.')
      await refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The request could not be updated.')
    } finally {
      setRespondingTo(null)
    }
  }

  const badgeLabel = bundle.count > 99 ? '99+' : String(bundle.count)

  return (
    <div className="schedule-notifications" ref={rootRef}>
      <button
        aria-controls="schedule-notification-panel"
        aria-expanded={open}
        aria-label={bundle.count > 0 ? `Notifications, ${bundle.count} pending or unread` : 'Notifications'}
        className="notification-bell"
        type="button"
        onClick={() => { setFeedback(null); setOpen((current) => !current) }}
      >
        <Bell aria-hidden="true" />
        {bundle.count > 0 ? <span className="notification-badge">{badgeLabel}</span> : null}
      </button>
      {open ? <button className="notification-sheet-backdrop" type="button" aria-label="Close notifications" onClick={() => setOpen(false)} /> : null}
      {open ? <section aria-label="Schedule access notifications" className="notification-panel" id="schedule-notification-panel">
        <header>
          <div><h2>Notifications</h2><p>Schedule access</p></div>
          <button className="icon-button" type="button" aria-label="Close notifications" onClick={() => setOpen(false)}><X aria-hidden="true" /></button>
        </header>
        {feedback ? <p className="notification-feedback" role="status"><Check size={16} aria-hidden="true" /> {feedback}</p> : null}
        {error ? <p className="notification-error" role="alert">{error}</p> : null}
        {loading && bundle.notifications.length === 0 ? <p className="notification-loading" role="status"><LoaderCircle aria-hidden="true" /> Loading notifications…</p> : null}
        {!loading && bundle.notifications.length === 0 ? <p className="notification-empty">No schedule access notifications yet.</p> : null}
        <div className="notification-list">
          {bundle.notifications.map((notification) => notification.kind === 'incoming_request'
            ? <article className="notification-item is-pending" key={notification.request_id}>
              <ProfileAvatar userId={notification.student_id} fullName={notification.full_name} />
              <div><p><strong>{notification.full_name}</strong> requested access to your schedule.</p><small>{notificationDate(notification.updated_at)}</small></div>
              <div className="notification-actions">
                <button className="button button-primary" type="button" disabled={respondingTo !== null} onClick={() => void respond(notification, true)}>{respondingTo === notification.request_id ? 'Saving…' : 'Allow'}</button>
                <button className="button button-secondary" type="button" disabled={respondingTo !== null} onClick={() => void respond(notification, false)}>Decline</button>
              </div>
            </article>
            : <article className={notification.read ? 'notification-item is-update' : 'notification-item is-update is-unread'} key={notification.request_id}>
              <ProfileAvatar userId={notification.student_id} fullName={notification.full_name} />
              <div><p><strong>{notification.full_name}</strong> {notification.status === 'approved' ? 'allowed access to their schedule.' : 'declined your schedule access request.'}</p><small>{notificationDate(notification.updated_at)}</small></div>
            </article>)}
        </div>
      </section> : null}
    </div>
  )
}
