import { AlertCircle, ArrowRight, CheckCircle2, Clock3, Info, Plus, RefreshCw, Trash2, Users, XCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { TermSelector } from '../components/schedule/TermSelector'
import { ScheduleGrid } from '../components/schedule/ScheduleGrid'
import { useCourseNameSearch } from '../hooks/useCourseNameSearch'
import { useSchedule } from '../hooks/useSchedule'
import { termLabels, type CourseNameSearchResult, type ScheduleEngineJob, type ScheduleEnginePrediction, type ScheduleEnrollment, type SemesterTerm } from '../lib/domain'
import { cancelScheduleEngineJob, createScheduleEngineJob, listScheduleEngineJobs } from '../lib/supabase/data'

const MAX_REPLACEMENTS = 2
const MAX_ACTIVE_REQUESTS = 5
const JOB_POLL_INTERVAL_MS = 15_000

interface SourceCourseDraft {
  key: string
  enrollmentId: string
}

interface ReplacementCourseDraft {
  key: string
  courseQuery: string
  replacementCourse: CourseNameSearchResult | null
}

function newSourceCourse(): SourceCourseDraft {
  return { key: crypto.randomUUID(), enrollmentId: '' }
}

function newReplacementCourse(): ReplacementCourseDraft {
  return { key: crypto.randomUUID(), courseQuery: '', replacementCourse: null }
}

function enrollmentLabel(enrollment: ScheduleEnrollment): string {
  const slots = enrollment.meeting_slots ?? enrollment.class.meeting_slots
  const meetings = slots.map((slot) => `${slot.day_type}${slot.period_number}`).join(', ')
  return `${enrollment.class.course_name} — ${enrollment.class.teacher_last_name} · ${termLabels[enrollment.academic_term]} · ${meetings}`
}

function formErrorFor(sourceCourses: SourceCourseDraft[], replacementCourses: ReplacementCourseDraft[], enrollments: ScheduleEnrollment[]): string | null {
  if (sourceCourses.length < 1 || sourceCourses.length > MAX_REPLACEMENTS) return 'Choose one or two current courses.'
  if (replacementCourses.length < 1 || replacementCourses.length > MAX_REPLACEMENTS) return 'Choose one or two replacement courses.'
  if (sourceCourses.some((draft) => !draft.enrollmentId) || replacementCourses.some((draft) => !draft.replacementCourse)) return 'Complete every course selection before submitting.'
  const enrollmentIds = sourceCourses.map((draft) => draft.enrollmentId)
  if (new Set(enrollmentIds).size !== enrollmentIds.length) return 'Each current course can only be replaced once.'
  const courseIds = replacementCourses.map((draft) => draft.replacementCourse?.id ?? '')
  if (new Set(courseIds).size !== courseIds.length) return 'Choose different replacement courses.'
  for (const draft of sourceCourses) {
    const enrollment = enrollments.find((item) => item.id === draft.enrollmentId)
    if (!enrollment) return 'One of the selected current courses is no longer in your schedule.'
    if (courseIds.includes(enrollment.class.course_name_id)) return 'A course cannot replace itself.'
  }
  return null
}

function CourseCatalogPicker({
  draft,
  excludedCourseIds,
  onChange,
}: {
  draft: ReplacementCourseDraft
  excludedCourseIds: ReadonlySet<string>
  onChange: (next: Pick<ReplacementCourseDraft, 'courseQuery' | 'replacementCourse'>) => void
}) {
  const [open, setOpen] = useState(false)
  const search = useCourseNameSearch(draft.courseQuery)
  const results = search.results.filter((course) => !excludedCourseIds.has(course.id)).slice(0, 6)
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
              onPointerDown={(event) => event.preventDefault()}
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
    cancelled: { label: 'Cancelled', icon: <XCircle aria-hidden="true" /> },
    completed: { label: 'Completed', icon: <CheckCircle2 aria-hidden="true" /> },
    failed: { label: 'Failed', icon: <AlertCircle aria-hidden="true" /> },
  } as const
  const current = labels[job.status]
  return (
    <section className={`engine-status engine-status-${job.status}`} role="status" aria-live="polite">
      {current.icon}
      <div><strong>{current.label}</strong><span>{job.sourceCourses.length} course{job.sourceCourses.length === 1 ? '' : 's'} → {job.replacementCourses.length} course{job.replacementCourses.length === 1 ? '' : 's'}</span></div>
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
  const [sourceCourses, setSourceCourses] = useState<SourceCourseDraft[]>(() => [newSourceCourse()])
  const [replacementCourses, setReplacementCourses] = useState<ReplacementCourseDraft[]>(() => [newReplacementCourse()])
  const [emailNotification, setEmailNotification] = useState(true)
  const [jobs, setJobs] = useState<ScheduleEngineJob[]>([])
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [jobLoading, setJobLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [cancellingJobId, setCancellingJobId] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [creatingNew, setCreatingNew] = useState(false)
  const [selectedTerm, setSelectedTerm] = useState<SemesterTerm>('semester_1')

  const refreshJobs = useCallback(async (preferredJobId?: string) => {
    try {
      const nextJobs = await listScheduleEngineJobs()
      setJobs(nextJobs)
      setSelectedJobId((current) => preferredJobId ?? (current && nextJobs.some((job) => job.id === current) ? current : nextJobs[0]?.id ?? null))
    } finally {
      setJobLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshJobs().catch(() => setJobLoading(false))
  }, [refreshJobs])

  useEffect(() => {
    if (!jobs.some((job) => job.status === 'queued' || job.status === 'processing')) return
    const timer = window.setInterval(() => { void refreshJobs().catch(() => undefined) }, JOB_POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [jobs, refreshJobs])

  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? null
  const activeRequestCount = jobs.filter((job) => job.status === 'queued' || job.status === 'processing').length
  const validationError = useMemo(() => formErrorFor(sourceCourses, replacementCourses, enrollments), [sourceCourses, replacementCourses, enrollments])
  const selectedEnrollmentIds = useMemo(() => new Set(sourceCourses.map((draft) => draft.enrollmentId).filter(Boolean)), [sourceCourses])
  const selectedCurrentCourseIds = useMemo(() => new Set(sourceCourses.flatMap((draft) => {
    const enrollment = enrollments.find((item) => item.id === draft.enrollmentId)
    return enrollment ? [enrollment.class.course_name_id] : []
  })), [sourceCourses, enrollments])
  const selectedReplacementCourseIds = useMemo(() => new Set(replacementCourses.map((draft) => draft.replacementCourse?.id).filter((id): id is string => Boolean(id))), [replacementCourses])

  function updateReplacementCourse(key: string, update: Partial<ReplacementCourseDraft>) {
    setReplacementCourses((current) => current.map((draft) => draft.key === key ? { ...draft, ...update } : draft))
    setSubmitError(null)
  }

  function resetForm() {
    if (activeRequestCount >= MAX_ACTIVE_REQUESTS) return
    setSourceCourses([newSourceCourse()])
    setReplacementCourses([newReplacementCourse()])
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
      const jobId = await createScheduleEngineJob({
        enrollmentIds: sourceCourses.map((draft) => draft.enrollmentId),
        replacementCourseIds: replacementCourses.map((draft) => draft.replacementCourse!.id),
      }, emailNotification)
      setCreatingNew(false)
      await refreshJobs(jobId)
    } catch (caught) {
      setSubmitError(caught instanceof Error ? caught.message : 'The request could not be submitted.')
    } finally {
      setSubmitting(false)
    }
  }

  async function cancelJob(jobId: string) {
    if (!window.confirm('Cancel this queued Schedule Engine request?')) return
    setCancellingJobId(jobId)
    setSubmitError(null)
    try {
      await cancelScheduleEngineJob(jobId)
      await refreshJobs(jobId)
    } catch (caught) {
      setSubmitError(caught instanceof Error ? caught.message : 'The request could not be cancelled.')
    } finally {
      setCancellingJobId(null)
    }
  }

  const showForm = creatingNew || (!jobLoading && jobs.length === 0)
  return (
    <div className="schedule-engine-page">
      <header className="page-heading">
        <div><h1>Schedule Engine</h1><p>See how your schedule might change if you replace one or more courses.</p></div>
      </header>

      {jobLoading ? <div className="engine-loading" role="status"><span className="loader" aria-hidden="true" /> Loading your requests…</div> : null}

      {!jobLoading && jobs.length > 0 ? (
        <section className="engine-queue-browser" aria-labelledby="engine-queue-heading">
          <header>
            <div><h2 id="engine-queue-heading">Your requests</h2><p>{activeRequestCount} of {MAX_ACTIVE_REQUESTS} active request slots used</p></div>
            <button className="button button-primary" type="button" disabled={activeRequestCount >= MAX_ACTIVE_REQUESTS || creatingNew} onClick={resetForm}><Plus size={18} /> New request</button>
          </header>
          <div className="engine-request-tabs" role="list" aria-label="Schedule Engine request history">
            {jobs.map((job) => (
              <button className={job.id === selectedJobId ? 'is-selected' : ''} key={job.id} type="button" onClick={() => { setCreatingNew(false); setSelectedJobId(job.id) }}>
                <span className={`engine-queue-dot status-${job.status}`} aria-hidden="true" />
                <span><strong>{job.replacementCourses.map((course) => course.courseName).join(' + ')}</strong><small>{new Date(job.createdAt).toLocaleString()} · {job.status}</small></span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {!showForm && selectedJob ? (
        <>
          <JobStatus job={selectedJob} />
          <section className="engine-request-details" aria-label="Requested course changes">
            <h2>Requested changes</h2>
            <div><span>{selectedJob.sourceCourses.map((course) => course.courseName).join(' + ')}</span><ArrowRight size={17} aria-label="changed to" /><strong>{selectedJob.replacementCourses.map((course) => course.courseName).join(' + ')}</strong></div>
            <p>Email notification: <strong>{selectedJob.emailNotification ? 'On' : 'Off'}</strong></p>
          </section>
          {selectedJob.status === 'queued' || selectedJob.status === 'processing' ? (
            <section className="engine-waiting-panel">
              <Clock3 aria-hidden="true" />
              <div><h2>{selectedJob.status === 'queued' ? 'Your request is in the queue' : 'Your request is being processed'}</h2><p>Your request will usually be processed within a couple of hours.</p></div>
              {selectedJob.status === 'queued' ? <button className="button button-secondary" disabled={cancellingJobId === selectedJob.id} type="button" onClick={() => void cancelJob(selectedJob.id)}>{cancellingJobId === selectedJob.id ? 'Cancelling…' : 'Cancel request'}</button> : null}
            </section>
          ) : null}
          {selectedJob.status === 'cancelled' ? <section className="notice-box"><XCircle aria-hidden="true" />This request was cancelled before processing.</section> : null}
          {selectedJob.status === 'failed' ? (
            <section className="notice-box error" role="alert"><AlertCircle aria-hidden="true" /><span>{selectedJob.errorMessage ?? 'The request could not be processed.'}</span></section>
          ) : null}
          {selectedJob.status === 'completed' ? (
            <section className="engine-results">
              {selectedJob.predictions.length > 0 ? (
                <>
                  <div className="engine-results-toolbar"><TermSelector value={selectedTerm} onChange={setSelectedTerm} label="Predicted schedule semester" /></div>
                  <div className={`engine-prediction-grid result-count-${selectedJob.predictions.length}`}>
                    {selectedJob.predictions.map((prediction) => <PredictionCard key={prediction.rank} prediction={prediction} selectedTerm={selectedTerm} />)}
                  </div>
                </>
              ) : <p className="notice-box"><Info aria-hidden="true" />This request completed without any displayable predictions.</p>}
            </section>
          ) : null}
          {submitError ? <p className="form-error" role="alert">{submitError}</p> : null}
          <EngineNotes />
        </>
      ) : showForm ? (
        <div className="engine-request-layout">
          <form className="engine-request-form" onSubmit={(event) => void submit(event)}>
            <div className="engine-form-heading"><h2>Course replacements</h2><p>Choose up to two courses from your schedule, then up to two catalog courses to replace them with.</p></div>
            {scheduleLoading ? <p className="engine-loading" role="status">Loading your current schedule…</p> : scheduleError ? <p className="form-error" role="alert">{scheduleError}</p> : enrollments.length === 0 ? <p className="notice-box"><Info aria-hidden="true" />Add classes to your schedule before creating a Schedule Engine request.</p> : (
              <div className="engine-replacement-list engine-selection-groups">
                <section className="engine-selection-group" aria-labelledby="engine-current-courses-heading">
                  <header><span className="engine-replacement-number" aria-hidden="true">1</span><div><h3 id="engine-current-courses-heading">Courses to replace</h3><p>From your current schedule</p></div></header>
                  {sourceCourses.map((draft, index) => {
                    const excludedEnrollments = new Set(selectedEnrollmentIds)
                    excludedEnrollments.delete(draft.enrollmentId)
                    return <div className="engine-selection-row" key={draft.key}>
                      <label>Current course {sourceCourses.length > 1 ? index + 1 : ''}
                        <select value={draft.enrollmentId} onChange={(event) => setSourceCourses((current) => current.map((item) => item.key === draft.key ? { ...item, enrollmentId: event.target.value } : item))}>
                          <option value="">Select a current course</option>
                          {enrollments.filter((enrollment) => !excludedEnrollments.has(enrollment.id)).map((enrollment) => <option key={enrollment.id} value={enrollment.id}>{enrollmentLabel(enrollment)}</option>)}
                        </select>
                      </label>
                      {sourceCourses.length > 1 ? <button className="engine-remove-selection" type="button" aria-label={`Remove current course ${index + 1}`} onClick={() => setSourceCourses((current) => current.filter((item) => item.key !== draft.key))}><Trash2 size={15} /></button> : null}
                    </div>
                  })}
                  {sourceCourses.length < Math.min(MAX_REPLACEMENTS, enrollments.length) ? <button className="engine-add-selection" type="button" onClick={() => setSourceCourses((current) => [...current, newSourceCourse()])}><Plus size={14} /> Add another current course</button> : null}
                </section>
                <ArrowRight className="engine-selection-arrow" aria-hidden="true" />
                <section className="engine-selection-group" aria-labelledby="engine-new-courses-heading">
                  <header><span className="engine-replacement-number" aria-hidden="true">2</span><div><h3 id="engine-new-courses-heading">Replace with</h3><p>From the course catalog</p></div></header>
                  {replacementCourses.map((draft, index) => {
                    const excludedCourses = new Set([...selectedReplacementCourseIds, ...selectedCurrentCourseIds])
                    if (draft.replacementCourse) excludedCourses.delete(draft.replacementCourse.id)
                    return <div className="engine-selection-row" key={draft.key}>
                      <CourseCatalogPicker draft={draft} excludedCourseIds={excludedCourses} onChange={(update) => updateReplacementCourse(draft.key, update)} />
                      {replacementCourses.length > 1 ? <button className="engine-remove-selection" type="button" aria-label={`Remove replacement course ${index + 1}`} onClick={() => setReplacementCourses((current) => current.filter((item) => item.key !== draft.key))}><Trash2 size={15} /></button> : null}
                    </div>
                  })}
                  {replacementCourses.length < MAX_REPLACEMENTS ? <button className="engine-add-selection" type="button" onClick={() => setReplacementCourses((current) => [...current, newReplacementCourse()])}><Plus size={14} /> Add another replacement course</button> : null}
                </section>
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
            <div><Clock3 aria-hidden="true" /><p>Keep up to five active requests. Each can replace one or two current courses with one or two catalog courses.</p></div>
            <div><RefreshCw aria-hidden="true" /><p>Return to this page to see when processing is complete.</p></div>
            <EngineNotes />
          </aside>
        </div>
      ) : null}
    </div>
  )
}
