import { AlertTriangle, Camera, LogOut, ShieldCheck, Trash2, UserRound, X } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { ProfileAvatar } from '../components/ui/ProfileAvatar'
import { useAuth } from '../features/auth/AuthProvider'
import type { PrivacySetting } from '../lib/domain'
import { deleteOwnAccount, removeProfilePicture, uploadProfilePicture } from '../lib/profile'

export function ProfilePage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const profileFullName = auth.profile?.full_name
  const profilePrivacy = auth.profile?.privacy_setting
  const [fullName, setFullName] = useState(profileFullName ?? '')
  const [privacy, setPrivacy] = useState<PrivacySetting>(profilePrivacy ?? 'classmates')
  const [saving, setSaving] = useState(false)
  const [pictureBusy, setPictureBusy] = useState(false)
  const [avatarRevision, setAvatarRevision] = useState<number>()
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    if (!profileFullName || !profilePrivacy) return
    setFullName(profileFullName)
    setPrivacy(profilePrivacy)
  }, [profileFullName, profilePrivacy])

  if (!auth.user || !auth.profile) return <p className="muted">Loading profile…</p>

  const nameError = fullName.trim().replace(/\s+/g, ' ').length < 2 || fullName.trim().replace(/\s+/g, ' ').length > 100
    ? 'Full name must be between 2 and 100 characters.'
    : null

  async function saveProfile(event: FormEvent) {
    event.preventDefault()
    if (nameError) {
      setError(nameError)
      return
    }
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      await auth.updateProfile({ fullName, privacySetting: privacy })
      setMessage('Profile saved. Privacy changes are active immediately across schedules, search, rosters, and classmate discovery.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Your profile could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function changePicture(file: File) {
    setPictureBusy(true)
    setError(null)
    setMessage(null)
    try {
      await uploadProfilePicture(auth.user!.id, file)
      setAvatarRevision(Date.now())
      setMessage('Profile picture updated.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The profile picture could not be uploaded.')
    } finally {
      setPictureBusy(false)
    }
  }

  async function removePicture() {
    setPictureBusy(true)
    setError(null)
    setMessage(null)
    try {
      await removeProfilePicture(auth.user!.id)
      setAvatarRevision(Date.now())
      setMessage('Profile picture removed. Your initials are shown instead.')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The profile picture could not be removed.')
    } finally {
      setPictureBusy(false)
    }
  }

  async function confirmDeletion() {
    if (deleteConfirmation !== 'DELETE') return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteOwnAccount(deleteConfirmation)
      void navigate('/auth', { replace: true })
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : 'Your account could not be deleted.')
      setDeleting(false)
    }
  }

  return <div className="profile-page narrow-page">
    <header className="page-heading"><div><h1>My Profile</h1><p>Manage how you appear in ScheduleShare and who can discover your schedule.</p></div><div className="profile-page-actions"><button className="button button-secondary" type="button" onClick={() => void auth.signOut()}><LogOut size={17} aria-hidden="true" /> Sign out</button><UserRound size={34} aria-hidden="true" /></div></header>

    <section className="profile-card profile-picture-card" aria-labelledby="profile-picture-heading">
      <ProfileAvatar userId={auth.user.id} fullName={auth.profile.full_name} revision={avatarRevision} className="profile-avatar-large" />
      <div><h2 id="profile-picture-heading">Profile picture</h2><p>PNG, JPEG, or WebP · 2 MB maximum. Your picture appears anywhere your profile is visible.</p>
        <div className="profile-picture-actions">
          <label className="button button-secondary"><Camera size={17} aria-hidden="true" /> {pictureBusy ? 'Uploading…' : 'Upload or replace'}<input aria-label="Upload profile picture" accept="image/png,image/jpeg,image/webp" disabled={pictureBusy || auth.isDemo} hidden type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) void changePicture(file); event.target.value = '' }} /></label>
          <button className="button button-secondary danger-text" disabled={pictureBusy || auth.isDemo} type="button" onClick={() => void removePicture()}><Trash2 size={17} aria-hidden="true" /> Remove picture</button>
        </div>
      </div>
    </section>

    <form className="profile-form" onSubmit={(event) => void saveProfile(event)}>
      <section className="profile-card" aria-labelledby="profile-details-heading">
        <h2 id="profile-details-heading">Profile details</h2>
        <label>Full name<input aria-invalid={Boolean(nameError)} maxLength={100} value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" /></label>
        {nameError ? <small className="form-error">{nameError}</small> : null}
      </section>

      <section className="profile-card" aria-labelledby="profile-privacy-heading">
        <div className="profile-section-heading"><ShieldCheck aria-hidden="true" /><div><h2 id="profile-privacy-heading">Schedule privacy</h2><p>Takes effect as soon as you save</p></div></div>
        <div className="privacy-options large">
          <label><input type="radio" name="privacy" checked={privacy === 'school'} onChange={() => setPrivacy('school')} /><span><strong>Anyone</strong><small>Any signed-in, non-suspended student can see you in class rosters and view your schedule.</small></span></label>
          <label><input type="radio" name="privacy" checked={privacy === 'classmates'} onChange={() => setPrivacy('classmates')} /><span><strong>Classmates</strong><small>Students who share any active class with you can see you in rosters and view your schedule.</small></span></label>
          <label><input type="radio" name="privacy" checked={privacy === 'private'} onChange={() => setPrivacy('private')} /><span><strong>Private</strong><small>Other students cannot see you in class rosters or open your schedule.</small></span></label>
        </div>
      </section>

      {message ? <p className="form-success" role="status">{message}</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="button button-primary" disabled={saving || Boolean(nameError)}>{saving ? 'Saving…' : 'Save profile'}</button>
    </form>

    <section className="profile-card danger-zone" aria-labelledby="delete-account-heading">
      <div><h2 id="delete-account-heading">Delete account</h2><p>Permanently removes your sign-in, profile, enrollments, and stored profile picture. Shared class definitions remain for other students.</p></div>
      <button className="button button-secondary danger-text" disabled={auth.isDemo} type="button" onClick={() => { setDeleteConfirmation(''); setDeleteError(null); setDeleteOpen(true) }}><Trash2 size={17} aria-hidden="true" /> Delete my account</button>
    </section>

    {deleteOpen ? <div className="dialog-backdrop" role="presentation">
      <section className="class-dialog delete-account-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-account-dialog-title">
        <header><div><h2 id="delete-account-dialog-title">Permanently delete your account?</h2><p>This cannot be undone.</p></div><button className="icon-button" type="button" aria-label="Close account deletion confirmation" disabled={deleting} onClick={() => setDeleteOpen(false)}><X aria-hidden="true" /></button></header>
        <div className="notice-box error"><AlertTriangle aria-hidden="true" /><span>Your authentication account, profile, schedule enrollments, and profile picture will be removed.</span></div>
        <label>Type <strong>DELETE</strong> to confirm<input aria-label="Type DELETE to confirm" autoComplete="off" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} /></label>
        {deleteError ? <p className="form-error" role="alert">{deleteError}</p> : null}
        <div className="form-actions"><button className="button button-secondary" type="button" disabled={deleting} onClick={() => setDeleteOpen(false)}>Cancel</button><button className="button button-danger" type="button" disabled={deleteConfirmation !== 'DELETE' || deleting} onClick={() => void confirmDeletion()}>{deleting ? 'Deleting…' : 'Delete account permanently'}</button></div>
      </section>
    </div> : null}
  </div>
}
