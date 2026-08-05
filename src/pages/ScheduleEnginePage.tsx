import { AlertCircle, ArrowRight, CheckCircle2, Clock3, History, Info, Lightbulb, Plus, RefreshCw, Trash2, XCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { TermSelector } from '../components/schedule/TermSelector'
import { ScheduleGrid } from '../components/schedule/ScheduleGrid'
import { useCourseNameSearch } from '../hooks/useCourseNameSearch'
import { useSchedule } from '../hooks/useSchedule'
import { termLabels, type CourseNameSearchResult, type DayType, type ScheduleEngineJob, type ScheduleEnginePrediction, type ScheduleEnrollment, type SemesterTerm } from '../lib/domain'
import { applyScheduleEnginePrediction, cancelScheduleEngineJob, createScheduleEngineJob, listScheduleEngineJobs } from '../lib/supabase/data'

const MAX_REPLACEMENTS = 3
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
  if (sourceCourses.length < 1 || sourceCourses.length > MAX_REPLACEMENTS) return 'Choose up to three current courses.'
  if (replacementCourses.length < 1 || replacementCourses.length > MAX_REPLACEMENTS) return 'Choose up to three replacement courses.'
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

function predictionLabel(rank: number): string {
  return rank === 1 ? 'Most likely' : `Alternative ${rank}`
}

function predictionReason(prediction: ScheduleEnginePrediction): string {
  if (prediction.collateralChangeCount === 0) return 'Your requested courses fit without moving any unrelated courses.'
  if (prediction.collateralChangeCount === 1) return 'Your requested courses fit by moving one other course to an existing section.'
  return `Your requested courses fit by moving ${prediction.collateralChangeCount} other courses to existing sections.`
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
      {job.status === 'completed' ? <span>{job.predictions.length > 0 ? `${job.predictions.length} valid predicted schedule${job.predictions.length === 1 ? '' : 's'}` : 'No valid schedule found'}</span> : null}
    </section>
  )
}

function PredictionCard({
  prediction,
  selectedTerm,
  mobileDay,
  onMobileDayChange,
  onApply,
  applying,
  applied,
}: {
  prediction: ScheduleEnginePrediction
  selectedTerm: SemesterTerm
  mobileDay: DayType
  onMobileDayChange: (day: DayType) => void
  onApply: () => void
  applying: boolean
  applied: boolean
}) {
  const changedEnrollmentIds = useMemo(
    () => new Set(prediction.schedule.filter((enrollment) => enrollment.changedFromEnrollmentId).map((enrollment) => enrollment.id)),
    [prediction.schedule],
  )
  const rankLabel = predictionLabel(prediction.rank)
  const collateralLabel = prediction.collateralChangeCount === 0
    ? 'No unrelated courses moved'
    : `${prediction.collateralChangeCount} unrelated course${prediction.collateralChangeCount === 1 ? '' : 's'} moved`
  return (
    <article className="engine-prediction-card">
      <header className="engine-selected-result-heading">
        <div className="engine-selected-result-title"><CheckCircle2 aria-hidden="true" /><span>Selected result: <strong>{rankLabel}</strong></span></div>
        <span className={prediction.developmentPlaceholder ? 'engine-collateral-summary is-placeholder' : 'engine-collateral-summary'}>{prediction.developmentPlaceholder ? 'Development placeholder' : collateralLabel}</span>
        <div className="engine-result-actions">
          <button className="button button-primary" type="button" disabled={applying || applied || prediction.developmentPlaceholder} onClick={onApply}>
            <CheckCircle2 size={18} aria-hidden="true" />{applying ? 'Updating your schedule…' : applied ? 'Schedule updated' : 'Make this my schedule'}
          </button>
          <span><Info size={16} aria-hidden="true" />Predictions are estimates</span>
        </div>
      </header>
      <div className="engine-mobile-day-selector" role="group" aria-label="Predicted schedule day">
        {(['A', 'B'] as DayType[]).map((day) => <button className={mobileDay === day ? 'is-active' : ''} aria-pressed={mobileDay === day} key={day} type="button" onClick={() => onMobileDayChange(day)}>{day} Day</button>)}
      </div>
      <ScheduleGrid
        enrollments={prediction.schedule}
        selectedTerm={selectedTerm}
        changedEnrollmentIds={changedEnrollmentIds}
        mobileDay={mobileDay}
        readOnly
        onAdd={() => undefined}
        onRemove={() => undefined}
        onReplace={() => undefined}
      />
      <section className="engine-prediction-explanations" aria-label={`Explanation for ${rankLabel}`}>
        <Lightbulb aria-hidden="true" />
        <strong>Why it works</strong>
        <p>{predictionReason(prediction)}</p>
      </section>
    </article>
  )
}

export function ScheduleEnginePage() {
  const { enrollments, loading: scheduleLoading, error: scheduleError, reload: reloadSchedule } = useSchedule()
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
  const [selectedPredictionRank, setSelectedPredictionRank] = useState(1)
  const [mobileDay, setMobileDay] = useState<DayType>('A')
  const [applyingPredictionKey, setApplyingPredictionKey] = useState<string | null>(null)
  const [appliedPredictionKey, setAppliedPredictionKey] = useState<string | null>(null)

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
  const selectedPrediction = selectedJob?.predictions.find((prediction) => prediction.rank === selectedPredictionRank) ?? selectedJob?.predictions[0] ?? null
  const selectedPredictionKey = selectedJob && selectedPrediction ? `${selectedJob.id}:${selectedPrediction.rank}` : null
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

  async function applyPrediction(job: ScheduleEngineJob, prediction: ScheduleEnginePrediction) {
    if (!window.confirm(`Replace your current schedule with ${predictionLabel(prediction.rank).toLowerCase()} prediction?`)) return
    const predictionKey = `${job.id}:${prediction.rank}`
    setApplyingPredictionKey(predictionKey)
    setSubmitError(null)
    try {
      await applyScheduleEnginePrediction(job.id, prediction.rank)
      await reloadSchedule()
      setAppliedPredictionKey(predictionKey)
    } catch (caught) {
      setSubmitError(caught instanceof Error ? caught.message : 'Your schedule could not be updated.')
    } finally {
      setApplyingPredictionKey(null)
    }
  }

  const showForm = creatingNew || (!jobLoading && jobs.length === 0)
  return (
    <div className="schedule-engine-page">
      <header className="page-heading engine-page-heading">
        <div><h1>Schedule Engine</h1><p>See how your schedule will change if you replace one or more courses.</p></div>
        {!jobLoading && jobs.length > 0 ? (
          <div className="engine-page-actions">
            <label className="engine-history-select">
              <History size={17} aria-hidden="true" />
              <span>Request history</span>
              <select aria-label="Request history" value={selectedJobId ?? ''} onChange={(event) => { setCreatingNew(false); setSelectedJobId(event.target.value); setSubmitError(null) }}>
                {jobs.map((job) => <option value={job.id} key={job.id}>{job.replacementCourses.map((course) => course.courseName).join(' + ')} · {job.status}</option>)}
              </select>
            </label>
            <button className="button button-primary" type="button" disabled={activeRequestCount >= MAX_ACTIVE_REQUESTS || creatingNew} onClick={resetForm}><Plus size={18} /> New request</button>
          </div>
        ) : null}
      </header>

      {jobLoading ? <div className="engine-loading" role="status"><span className="loader" aria-hidden="true" /> Loading your requests…</div> : null}

      {!showForm && selectedJob ? (
        <>
          {selectedJob.status !== 'completed' ? <JobStatus job={selectedJob} /> : null}
          <section className="engine-request-overview" aria-label="Requested course changes">
            <div className="engine-request-summary">
              <span className="engine-section-label">Your requested changes</span>
              <div className="engine-request-flow"><span>{selectedJob.sourceCourses.map((course) => course.courseName).join(' + ')}</span><ArrowRight size={19} aria-label="changed to" /><strong>{selectedJob.replacementCourses.map((course) => course.courseName).join(' + ')}</strong></div>
              <p>{new Date(selectedJob.createdAt).toLocaleString()} · Email notification: <strong>{selectedJob.emailNotification ? 'On' : 'Off'}</strong></p>
            </div>
            {selectedJob.status === 'completed' && selectedJob.predictions.length > 0 ? (
              <div className="engine-result-controls">
                <section aria-labelledby="engine-result-picker-heading">
                  <h2 id="engine-result-picker-heading">Choose a predicted schedule</h2>
                  <div className="engine-result-picker" role="radiogroup" aria-label="Predicted schedules">
                    {selectedJob.predictions.map((prediction) => (
                      <button className={selectedPrediction?.rank === prediction.rank ? 'is-selected' : ''} role="radio" aria-checked={selectedPrediction?.rank === prediction.rank} key={prediction.rank} type="button" onClick={() => { setSelectedPredictionRank(prediction.rank); setSubmitError(null) }}>
                        <span className="engine-result-radio" aria-hidden="true" />
                        <strong>{predictionLabel(prediction.rank)}</strong>
                      </button>
                    ))}
                  </div>
                </section>
                <section className="engine-term-control" aria-labelledby="engine-semester-heading">
                  <h2 id="engine-semester-heading">Semester</h2>
                  <TermSelector value={selectedTerm} onChange={setSelectedTerm} label="Predicted schedule semester" />
                </section>
              </div>
            ) : null}
          </section>
          {selectedJob.status === 'queued' || selectedJob.status === 'processing' ? (
            <section className="engine-waiting-panel">
              <Clock3 aria-hidden="true" />
              <div><h2>{selectedJob.status === 'queued' ? 'Your request is in the queue' : 'Your request is being processed'}</h2><p>{selectedJob.emailNotification ? 'You can leave this page. We’ll email you when your schedules are ready.' : 'You can leave this page and check back for your results.'}</p></div>
              {selectedJob.status === 'queued' ? <button className="button button-secondary" disabled={cancellingJobId === selectedJob.id} type="button" onClick={() => void cancelJob(selectedJob.id)}>{cancellingJobId === selectedJob.id ? 'Cancelling…' : 'Cancel request'}</button> : null}
            </section>
          ) : null}
          {selectedJob.status === 'cancelled' ? <section className="notice-box"><XCircle aria-hidden="true" />This request was cancelled before processing.</section> : null}
          {selectedJob.status === 'failed' ? (
            <section className="notice-box error" role="alert"><AlertCircle aria-hidden="true" /><span>{selectedJob.errorMessage ?? 'The request could not be processed.'}</span></section>
          ) : null}
          {selectedJob.status === 'completed' ? (
            <section className="engine-results">
              {selectedPrediction ? <PredictionCard
                prediction={selectedPrediction}
                selectedTerm={selectedTerm}
                mobileDay={mobileDay}
                onMobileDayChange={setMobileDay}
                onApply={() => void applyPrediction(selectedJob, selectedPrediction)}
                applying={applyingPredictionKey === selectedPredictionKey}
                applied={appliedPredictionKey === selectedPredictionKey}
              /> : (
                <section className="engine-no-result" role="status">
                  <Info aria-hidden="true" />
                  <div><h2>No valid schedule yet</h2><p>Try again in a couple of hours as more students join, or ask your friends to add their schedules. Schedule Engine gets more accurate over time.</p>
                    {selectedJob.noValidScheduleReason ? <details><summary>What blocked this request?</summary><p>{selectedJob.noValidScheduleReason}</p></details> : null}
                  </div>
                </section>
              )}
            </section>
          ) : null}
          {selectedPredictionKey && appliedPredictionKey === selectedPredictionKey ? <p className="form-success engine-apply-success" role="status">This prediction is now your schedule.</p> : null}
          {submitError ? <p className="form-error" role="alert">{submitError}</p> : null}
        </>
      ) : showForm ? (
        <div className="engine-request-layout">
          <form className="engine-request-form" onSubmit={(event) => void submit(event)}>
            <div className="engine-form-heading"><h2>Course replacements</h2><p>Choose up to three courses from your schedule, then up to three catalog courses to replace them with.</p></div>
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
              <p>You can leave this page after submitting and return when your results are ready.</p>
              {submitError ? <p className="form-error" role="alert">{submitError}</p> : null}
              <button className="button button-primary" disabled={submitting || scheduleLoading || enrollments.length === 0 || Boolean(validationError)} type="submit">{submitting ? 'Submitting…' : 'Submit request'}</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  )
}
