import { AlertCircle, ArrowRight, CheckCircle2, Clock3, Info, Plus, RefreshCw, Trash2, Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { TermSelector } from '../components/schedule/TermSelector'
import { ScheduleGrid } from '../components/schedule/ScheduleGrid'
import { useCourseNameSearch } from '../hooks/useCourseNameSearch'
import { useSchedule } from '../hooks/useSchedule'
import { termLabels, type CourseNameSearchResult, type ScheduleEngineJob, type ScheduleEnginePrediction, type ScheduleEnrollment, type SemesterTerm } from '../lib/domain'
import { createScheduleEngineJob, getLatestScheduleEngineJob } from '../lib/supabase/data'

const MAX_REPLACEMENTS = 5
const JOB_POLL_INTERVAL_MS = 15_000

interface ReplacementDraft {
  key: string
  enrollmentId: string
  courseQuery: string
  replacementCourse: CourseNameSearchResult | null
}

function newDraft(): ReplacementDraft {
  return { key: crypto.randomUUID(), enrollmentId: '', courseQuery: '', replacementCourse: null }
}

function enrollmentLabel(enrollment: ScheduleEnrollment): string {
  const slots = enrollment.meeting_slots ?? enrollment.class.meeting_slots
  const meetings = slots.map((slot) => `${slot.day_type}${slot.period_number}`).join(', ')
  return `${enrollment.class.course_name} — ${enrollment.class.teacher_last_name} · ${termLabels[enrollment.academic_term]} · ${meetings}`
}

function formErrorFor(drafts: ReplacementDraft[], enrollments: ScheduleEnrollment[]): string | null {
  if (drafts.length < 1 || drafts.length > MAX_REPLACEMENTS) return 'Choose between one and five replacements.'
  if (drafts.some((draft) => !draft.enrollmentId || !draft.replacementCourse)) return 'Complete every replacement before submitting.'
  const enrollmentIds = drafts.map((draft) => draft.enrollmentId)
  if (new Set(enrollmentIds).size !== enrollmentIds.length) return 'Each current course can only be replaced once.'
  const courseIds = drafts.map((draft) => draft.replacementCourse?.id ?? '')
  if (new Set(courseIds).size !== courseIds.length) return 'Choose a different replacement course for each row.'
  for (const draft of drafts) {
    const enrollment = enrollments.find((item) => item.id === draft.enrollmentId)
    if (!enrollment) return 'One of the selected current courses is no longer in your schedule.'
    if (enrollment.class.course_name_id === draft.replacementCourse?.id) return 'A course cannot replace itself.'
  }
  return null
}

function CourseCatalogPicker({
  draft,
  currentCourseId,
  excludedCourseIds,
  onChange,
}: {
  draft: ReplacementDraft
  currentCourseId: string | null
  excludedCourseIds: ReadonlySet<string>
  onChange: (next: Pick<ReplacementDraft, 'courseQuery' | 'replacementCourse'>) => void
}) {
  const [open, setOpen] = useState(false)
  const search = useCourseNameSearch(draft.courseQuery)
  const results = search.results.filter((course) => course.id !== currentCourseId && !excludedCourseIds.has(course.id)).slice(0, 6)
  return (
    <div
      className="engine-course-picker"
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}
    >
      <label htmlFor={`replacement-course-${draft.key}`}>Replacement course</label>
      <input
        id={`replacement-course-${draft.key}`}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && results.length > 0}
        autoComplete="off"
        placeholder="Search the course catalog"
        value={draft.courseQuery}
        onChange={(event) => onChange({ courseQuery: event.target.value, replacementCourse: null })}
      />
      {open && search.loading ? <small className="muted">Searching catalog…</small> : null}
      {open && search.error ? <small className="form-error">{search.error}</small> : null}
      {open && !search.loading && results.length > 0 ? (
        <div className="engine-course-results" role="listbox" aria-label="Replacement course results">
          {results.map((course) => (
            <button
              aria-selected={draft.replacementCourse?.id === course.id}
              className={draft.replacementCourse?.id === course.id ? 'is-selected' : ''}
              key={course.id}
              role="option"
              type="button"
              onClick={() => {
                onChange({ courseQuery: course.course_name, replacementCourse: course })
                setOpen(false)
              }}
            >{course.course_name}</button>
          ))}
        </div>
      ) : null}
      {draft.replacementCourse ? <small className="engine-selected-course">Selected catalog course: <strong>{draft.replacementCourse.course_name}</strong></small> : null}
    </div>
  )
}

function JobStatus({ job }: { job: ScheduleEngineJob }) {
  const labels = {
    queued: { label: 'Queued', icon: <Clock3 aria-hidden="true" /> },
    processing: { label: 'Processing', icon: <RefreshCw className="engine-spin" aria-hidden="true" /> },
    completed: { label: 'Completed', icon: <CheckCircle2 aria-hidden="true" /> },
    failed: { label: 'Failed', icon: <AlertCircle aria-hidden="true" /> },
  } as const
  const current = labels[job.status]
  return (
    <section className={`engine-status engine-status-${job.status}`} role="status" aria-live="polite">
      {current.icon}
      <div><strong>{current.label}</strong><span>{job.replacements.length} replacement{job.replacements.length === 1 ? '' : 's'}</span></div>
      {job.status === 'completed' ? <span>{job.predictions.length} predicted schedule{job.predictions.length === 1 ? '' : 's'}</span> : null}
    </section>
  )
}

function PredictionCard({ prediction, selectedTerm }: { prediction: ScheduleEnginePrediction; selectedTerm: SemesterTerm }) {
  const changedEnrollmentIds = useMemo(
    () => new Set(prediction.schedule.filter((enrollment) => enrollment.changedFromEnrollmentId).map((enrollment) => enrollment.id)),
    [prediction.schedule],
  )
  const rankLabel = prediction.rank === 1 ? 'Most likely' : prediction.rank === 2 ? '2nd most likely' : prediction.rank === 3 ? '3rd most likely' : '4th most likely'
  return (
    <article className="engine-prediction-card">
      <header><span>{prediction.rank}</span><h2>{rankLabel}</h2>{prediction.developmentPlaceholder ? <small>Development placeholder</small> : null}</header>
      <ScheduleGrid
        enrollments={prediction.schedule}
        selectedTerm={selectedTerm}
        changedEnrollmentIds={changedEnrollmentIds}
        readOnly
        onAdd={() => undefined}
        onRemove={() => undefined}
        onReplace={() => undefined}
      />
    </article>
  )
}

function EngineNotes() {
  return (
    <div className="engine-notes">
      <div><Info aria-hidden="true" /><p>Predictions are estimates and may not match the schedule produced by the school.</p></div>
      <div><Users aria-hidden="true" /><p>Schedule Engine becomes more accurate as more students join ScheduleShare. Ask your friends to add their schedules.</p></div>
    </div>
  )
}

export function ScheduleEnginePage() {
  const { enrollments, loading: scheduleLoading, error: scheduleError } = useSchedule()
  const [drafts, setDrafts] = useState<ReplacementDraft[]>(() => [newDraft()])
  const [emailNotification, setEmailNotification] = useState(true)
  const [latestJob, setLatestJob] = useState<ScheduleEngineJob | null>(null)
  const [jobLoading, setJobLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [creatingNew, setCreatingNew] = useState(false)
  const [selectedTerm, setSelectedTerm] = useState<SemesterTerm>('semester_1')

  const refreshLatestJob = useCallback(async () => {
    try {
      setLatestJob(await getLatestScheduleEngineJob())
    } finally {
      setJobLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshLatestJob().catch(() => setJobLoading(false))
  }, [refreshLatestJob])

  useEffect(() => {
    if (!latestJob || !['queued', 'processing'].includes(latestJob.status)) return
    const timer = window.setInterval(() => { void refreshLatestJob().catch(() => undefined) }, JOB_POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [latestJob, refreshLatestJob])

  const validationError = useMemo(() => formErrorFor(drafts, enrollments), [drafts, enrollments])
  const selectedEnrollmentIds = useMemo(() => new Set(drafts.map((draft) => draft.enrollmentId).filter(Boolean)), [drafts])
  const selectedReplacementCourseIds = useMemo(() => new Set(drafts.map((draft) => draft.replacementCourse?.id).filter((id): id is string => Boolean(id))), [drafts])

  function updateDraft(key: string, update: Partial<ReplacementDraft>) {
    setDrafts((current) => current.map((draft) => draft.key === key ? { ...draft, ...update } : draft))
    setSubmitError(null)
  }

  function resetForm() {
    setDrafts([newDraft()])
    setEmailNotification(true)
    setSubmitError(null)
    setCreatingNew(true)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (validationError) {
      setSubmitError(validationError)
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      await createScheduleEngineJob(drafts.map((draft) => ({
        enrollmentId: draft.enrollmentId,
        replacementCourseId: draft.replacementCourse!.id,
      })), emailNotification)
      setCreatingNew(false)
      await refreshLatestJob()
    } catch (caught) {
      setSubmitError(caught instanceof Error ? caught.message : 'The request could not be submitted.')
    } finally {
      setSubmitting(false)
    }
  }

  const showJob = latestJob && !creatingNew
  return (
    <div className="schedule-engine-page">
      <header className="page-heading">
        <div><h1>Schedule Engine</h1><p>See how your schedule might change if you replace one or more courses.</p></div>
      </header>

      {jobLoading ? <div className="engine-loading" role="status"><span className="loader" aria-hidden="true" /> Loading your latest request…</div> : showJob ? (
        <>
          <JobStatus job={latestJob} />
          {latestJob.status === 'queued' || latestJob.status === 'processing' ? (
            <section className="engine-waiting-panel">
              <Clock3 aria-hidden="true" />
              <div><h2>{latestJob.status === 'queued' ? 'Your request is in the queue' : 'Your request is being processed'}</h2><p>Your request will usually be processed within a couple of hours.</p></div>
            </section>
          ) : null}
          {latestJob.status === 'failed' ? (
            <section className="notice-box error" role="alert"><AlertCircle aria-hidden="true" /><span>{latestJob.errorMessage ?? 'The request could not be processed.'}</span></section>
          ) : null}
          {latestJob.status === 'completed' ? (
            <section className="engine-results">
              {latestJob.predictions.length > 0 ? (
                <>
                  <div className="engine-results-toolbar"><TermSelector value={selectedTerm} onChange={setSelectedTerm} label="Predicted schedule semester" /></div>
                  <div className={`engine-prediction-grid result-count-${latestJob.predictions.length}`}>
                    {latestJob.predictions.map((prediction) => <PredictionCard key={prediction.rank} prediction={prediction} selectedTerm={selectedTerm} />)}
                  </div>
                </>
              ) : <p className="notice-box"><Info aria-hidden="true" />This request completed without any displayable predictions.</p>}
            </section>
          ) : null}
          {(latestJob.status === 'completed' || latestJob.status === 'failed') ? <button className="button button-primary engine-new-request" type="button" onClick={resetForm}><Plus size={18} /> Create another request</button> : null}
          <EngineNotes />
        </>
      ) : (
        <div className="engine-request-layout">
          <form className="engine-request-form" onSubmit={(event) => void submit(event)}>
            <div className="engine-form-heading"><h2>Course replacements</h2><p>Select up to five current courses to replace with a different course from the catalog.</p></div>
            {scheduleLoading ? <p className="engine-loading" role="status">Loading your current schedule…</p> : scheduleError ? <p className="form-error" role="alert">{scheduleError}</p> : enrollments.length === 0 ? <p className="notice-box"><Info aria-hidden="true" />Add classes to your schedule before creating a Schedule Engine request.</p> : (
              <div className="engine-replacement-list">
                {drafts.map((draft, index) => {
                  const currentEnrollment = enrollments.find((enrollment) => enrollment.id === draft.enrollmentId)
                  const excludedEnrollments = new Set(selectedEnrollmentIds)
                  excludedEnrollments.delete(draft.enrollmentId)
                  const excludedCourses = new Set(selectedReplacementCourseIds)
                  if (draft.replacementCourse) excludedCourses.delete(draft.replacementCourse.id)
                  return (
                    <fieldset className="engine-replacement-row" key={draft.key}>
                      <legend className="sr-only">Replacement {index + 1}</legend>
                      <span className="engine-replacement-number" aria-hidden="true">{index + 1}</span>
                      <label>Current course
                        <select value={draft.enrollmentId} onChange={(event) => updateDraft(draft.key, { enrollmentId: event.target.value, replacementCourse: null, courseQuery: '' })}>
                          <option value="">Select a current course</option>
                          {enrollments.filter((enrollment) => !excludedEnrollments.has(enrollment.id)).map((enrollment) => <option key={enrollment.id} value={enrollment.id}>{enrollmentLabel(enrollment)}</option>)}
                        </select>
                      </label>
                      <ArrowRight className="engine-replacement-arrow" aria-hidden="true" />
                      <CourseCatalogPicker
                        draft={draft}
                        currentCourseId={currentEnrollment?.class.course_name_id ?? null}
                        excludedCourseIds={excludedCourses}
                        onChange={(update) => updateDraft(draft.key, update)}
                      />
                      <button className="button button-secondary engine-remove-row" type="button" disabled={drafts.length === 1} onClick={() => setDrafts((current) => current.filter((item) => item.key !== draft.key))}><Trash2 size={17} /><span>Remove</span></button>
                    </fieldset>
                  )
                })}
                {drafts.length < Math.min(MAX_REPLACEMENTS, enrollments.length) ? <button className="engine-add-row" type="button" onClick={() => setDrafts((current) => [...current, newDraft()])}><Plus size={18} /> Add another replacement <small>up to five total</small></button> : null}
              </div>
            )}
            <div className="engine-submit-area">
              <label className="checkbox-row"><input type="checkbox" checked={emailNotification} onChange={(event) => setEmailNotification(event.target.checked)} /><span>Email me when my predicted schedules are ready.</span></label>
              <p>Your request will usually be processed within a couple of hours.</p>
              {submitError ? <p className="form-error" role="alert">{submitError}</p> : null}
              <button className="button button-primary" disabled={submitting || scheduleLoading || enrollments.length === 0 || Boolean(validationError)} type="submit">{submitting ? 'Submitting…' : 'Submit request'}</button>
            </div>
          </form>
          <aside className="engine-about">
            <h2>About Schedule Engine</h2>
            <div><Clock3 aria-hidden="true" /><p>Submit one to five replacements in a single request.</p></div>
            <div><RefreshCw aria-hidden="true" /><p>Return to this page to see when processing is complete.</p></div>
            <EngineNotes />
          </aside>
        </div>
      )}
    </div>
  )
}
