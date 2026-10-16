import { AlertCircle, AlertTriangle, Camera, LogOut, Monitor, Moon, ShieldCheck, Sun, Trash2 } from 'lucide-react'
import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PrivacyOptions } from '../components/account/PrivacyOptions'
import { Dialog } from '../components/ui/Dialog'
import { LoadingScreen } from '../components/ui/LoadingScreen'
import { PageHeader } from '../components/ui/PageHeader'
import { ProfileAvatar } from '../components/ui/ProfileAvatar'
import { SegmentedControl } from '../components/ui/SegmentedControl'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../features/auth/AuthProvider'
import type { PrivacySetting } from '../lib/domain'
import { deleteOwnAccount, removeProfilePicture, uploadProfilePicture } from '../lib/profile'
import { recordAuthenticatedEvent } from '../lib/supabase/data'
import { setThemePreference, storedThemePreference, type ThemePreference } from '../lib/theme'

const themeOptions: { value: ThemePreference; label: ReactNode }[] = [
  { value: 'system', label: <><Monitor aria-hidden="true" />System</> },
  { value: 'light', label: <><Sun aria-hidden="true" />Light</> },
  { value: 'dark', label: <><Moon aria-hidden="true" />Dark</> },
]

/** One settings group: a heading and short explanation beside its controls. */
function SettingsSection({ id, title, description, children, className }: { id: string; title: string; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className ? `profile-section ${className}` : 'profile-section'} aria-labelledby={id}>
      <div className="profile-section-intro">
        <h2 id={id}>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      <div className="profile-section-body">{children}</div>
    </section>
  )
}

export function ProfilePage() {
  const auth = useAuth()
  const navigate = useNavigate()
  const { showToast } = useToast()
  const nameId = useId()
  const nameErrorId = useId()
  const deleteFormId = useId()
  const deleteInputId = useId()
  const profileFullName = auth.profile?.full_name
  const profilePrivacy = auth.profile?.privacy_setting
  const [fullName, setFullName] = useState(profileFullName ?? '')
  const [privacy, setPrivacy] = useState<PrivacySetting>(profilePrivacy ?? 'classmates')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [pictureAction, setPictureAction] = useState<'upload' | 'remove' | null>(null)
  const [pictureError, setPictureError] = useState<string | null>(null)
  const [theme, setTheme] = useState<ThemePreference>(() => storedThemePreference())
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const pictureBusy = pictureAction !== null

  function closeDeleteDialog() {
    if (!deleting) setDeleteOpen(false)
  }

  useEffect(() => {
    if (!profileFullName || !profilePrivacy) return
    setFullName(profileFullName)
    setPrivacy(profilePrivacy)
  }, [profileFullName, profilePrivacy])

  if (!auth.user || !auth.profile) return <LoadingScreen label="Loading your profile…" />

  const nameError = fullName.trim().replace(/\s+/g, ' ').length < 2 || fullName.trim().replace(/\s+/g, ' ').length > 100
    ? 'Full name must be between 2 and 100 characters.'
    : null

  async function saveProfile(event: FormEvent) {
    event.preventDefault()
    if (nameError) {
      setSaveError(nameError)
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      await auth.updateProfile({ fullName, privacySetting: privacy })
      showToast('Profile saved. Privacy changes are active immediately.')
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : 'Your profile could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  async function changePicture(file: File) {
    setPictureAction('upload')
    setPictureError(null)
    try {
      await uploadProfilePicture(auth.user!.id, file)
      auth.refreshAvatar()
      await recordAuthenticatedEvent('profile_picture_changed', 'succeeded').catch(() => undefined)
      await auth.refreshProfile()
      auth.refreshAvatar()
      showToast('Profile picture updated.')
    } catch (caught) {
      void recordAuthenticatedEvent('profile_picture_rejected', 'failed', { error_category: caught instanceof Error ? caught.message : 'upload_failed' }).catch(() => undefined)
      setPictureError(caught instanceof Error ? caught.message : 'The profile picture could not be uploaded.')
    } finally {
      setPictureAction(null)
    }
  }

  async function removePicture() {
    setPictureAction('remove')
    setPictureError(null)
    try {
      await removeProfilePicture(auth.user!.id)
      auth.refreshAvatar()
      await recordAuthenticatedEvent('profile_picture_removed', 'succeeded').catch(() => undefined)
      await auth.refreshProfile()
      auth.refreshAvatar()
      showToast('Profile picture removed. Your initials show instead.')
    } catch (caught) {
      setPictureError(caught instanceof Error ? caught.message : 'The profile picture could not be removed.')
    } finally {
      setPictureAction(null)
    }
  }

  function changeTheme(next: ThemePreference) {
    setTheme(next)
    setThemePreference(next)
  }

  async function confirmDeletion(event?: FormEvent) {
    event?.preventDefault()
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

  const pictureDisabled = pictureBusy || auth.isDemo

  return (
    <div className="page profile-page">
      <PageHeader title="Profile" description="Your name, picture, and who can see your schedule." />

      <div className="profile-sections">
        <SettingsSection id="profile-picture-heading" title="Profile picture" description="Shown wherever other students can see your profile.">
          <div className="profile-identity">
            <ProfileAvatar userId={auth.user.id} fullName={auth.profile.full_name} revision={auth.avatarRevision ?? auth.profile.updated_at} className="is-large" />
            <div className="profile-identity-text">
              <strong>{auth.profile.full_name}</strong>
              {auth.profile.grade ? <span>Grade {auth.profile.grade}</span> : null}
            </div>
          </div>
          <div className="profile-picture-actions">
            <label className={pictureDisabled ? 'button button-secondary profile-file-button is-disabled' : 'button button-secondary profile-file-button'}>
              <Camera aria-hidden="true" />
              {pictureAction === 'upload' ? 'Uploading…' : 'Upload picture'}
              <input
                className="sr-only"
                type="file"
                aria-label="Upload profile picture"
                accept="image/png,image/jpeg,image/webp"
                disabled={pictureDisabled}
                onChange={(event) => { const file = event.target.files?.[0]; if (file) void changePicture(file); event.target.value = '' }}
              />
            </label>
            <button className="button button-ghost button-danger-outline" disabled={pictureDisabled} type="button" onClick={() => void removePicture()}>
              <Trash2 aria-hidden="true" />
              {pictureAction === 'remove' ? 'Removing…' : 'Remove picture'}
            </button>
          </div>
          <p className="field-help">{auth.isDemo ? 'Picture changes are off in demo mode.' : 'PNG, JPEG, or WebP, up to 7 MB. Uploading replaces your current picture.'}</p>
          {pictureError ? <p className="form-error" role="alert"><AlertCircle aria-hidden="true" />{pictureError}</p> : null}
        </SettingsSection>

        <form className="profile-form" onSubmit={(event) => void saveProfile(event)}>
          <SettingsSection id="profile-details-heading" title="Name" description="Classmates search for you by this name.">
            <div className="field">
              <label htmlFor={nameId}>Full name</label>
              <input id={nameId} aria-invalid={Boolean(nameError)} aria-describedby={nameError ? nameErrorId : undefined} maxLength={100} value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" />
              {nameError ? <p className="form-error" id={nameErrorId}>{nameError}</p> : null}
            </div>
          </SettingsSection>

          <SettingsSection id="profile-privacy-heading" title="Schedule privacy" description="Choose who can see your full schedule. Changes apply to schedules, search, class rosters, and classmate suggestions as soon as you save.">
            <PrivacyOptions legend="Who can see your schedule" hideLegend value={privacy} onChange={setPrivacy} />
            {saveError ? <p className="form-error" role="alert"><AlertCircle aria-hidden="true" />{saveError}</p> : null}
            <div className="form-actions">
              <button className="button button-primary" disabled={saving || Boolean(nameError)}>{saving ? 'Saving…' : 'Save profile'}</button>
            </div>
          </SettingsSection>
        </form>

        <SettingsSection id="profile-appearance-heading" title="Appearance" description="Saved on this device.">
          <SegmentedControl label="Theme" value={theme} options={themeOptions} onChange={changeTheme} className="profile-theme" />
          <p className="field-help">System follows your device’s light or dark setting.</p>
        </SettingsSection>

        {auth.isAdmin ? (
          <SettingsSection id="profile-admin-heading" title="Administration" description="You’re an administrator.">
            <p className="profile-body-text">Manage students, classes, reports, and site settings.</p>
            <div className="form-actions">
              <Link className="button button-secondary" to="/admin"><ShieldCheck aria-hidden="true" />Open admin dashboard</Link>
            </div>
          </SettingsSection>
        ) : null}

        <SettingsSection id="profile-account-heading" title="Account">
          {auth.user.email ? <p className="profile-body-text">Signed in as <strong className="profile-email">{auth.user.email}</strong></p> : null}
          <div className="form-actions">
            <button className="button button-secondary" type="button" onClick={() => void auth.signOut()}><LogOut aria-hidden="true" />Sign out</button>
          </div>
        </SettingsSection>

        <SettingsSection id="delete-account-heading" title="Delete account" description="Permanent. This can’t be undone." className="profile-danger">
          <p className="profile-body-text">Deletes your email, profile, schedule, and profile picture. Other students will no longer see you anywhere on ScheduleShare.</p>
          <div className="form-actions">
            <button className="button button-secondary button-danger-outline" disabled={auth.isDemo} type="button" onClick={() => { setDeleteConfirmation(''); setDeleteError(null); setDeleteOpen(true) }}><Trash2 aria-hidden="true" />Delete my account</button>
          </div>
          {auth.isDemo ? <p className="field-help">Account deletion is off in demo mode.</p> : null}
        </SettingsSection>
      </div>

      {deleteOpen ? (
        <Dialog
          role="alertdialog"
          title="Permanently delete your account?"
          description="This can’t be undone."
          onClose={closeDeleteDialog}
          closeLabel="Close account deletion confirmation"
          dismissible={!deleting}
          size="small"
          className="profile-delete-dialog"
          footer={<>
            <button className="button button-secondary" type="button" disabled={deleting} onClick={closeDeleteDialog}>Cancel</button>
            <button className="button button-danger" type="submit" form={deleteFormId} disabled={deleteConfirmation !== 'DELETE' || deleting}>{deleting ? 'Deleting…' : 'Delete account permanently'}</button>
          </>}
        >
          <div className="notice notice-danger">
            <AlertTriangle aria-hidden="true" />
            <p>Your sign-in, profile, class enrollments, and profile picture will be removed.</p>
          </div>
          <form id={deleteFormId} className="field" onSubmit={(event) => void confirmDeletion(event)}>
            <label htmlFor={deleteInputId}>Type <strong className="profile-delete-word">DELETE</strong> to confirm</label>
            <input id={deleteInputId} aria-label="Type DELETE to confirm" autoComplete="off" autoCapitalize="characters" spellCheck={false} value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} />
          </form>
          {deleteError ? <p className="form-error" role="alert"><AlertCircle aria-hidden="true" />{deleteError}</p> : null}
        </Dialog>
      ) : null}
    </div>
  )
}
