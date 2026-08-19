import { lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AllowGuest, RequireAdmin, RequireAuth } from './components/auth/RouteGuards'
import { AuthPromptRoute } from './components/auth/AuthPromptRoute'
import { WhyScheduleShareRoute } from './components/auth/WhyScheduleShareRoute'
import { AppShell } from './components/layout/AppShell'
import { useAuth } from './features/auth/AuthProvider'

const AdminPage = lazy(() => import('./pages/AdminPage').then((module) => ({ default: module.AdminPage })))
const ClassesPage = lazy(() => import('./pages/ClassesPage').then((module) => ({ default: module.ClassesPage })))
const HomePage = lazy(() => import('./pages/HomePage').then((module) => ({ default: module.HomePage })))
const OnboardingPage = lazy(() => import('./pages/OnboardingPage').then((module) => ({ default: module.OnboardingPage })))
const PasswordResetPage = lazy(() => import('./pages/PasswordResetPage').then((module) => ({ default: module.PasswordResetPage })))
const ProfilePage = lazy(() => import('./pages/ProfilePage').then((module) => ({ default: module.ProfilePage })))
const ReportPage = lazy(() => import('./pages/ReportPage').then((module) => ({ default: module.ReportPage })))
const SchedulePage = lazy(() => import('./pages/SchedulePage').then((module) => ({ default: module.SchedulePage })))
const ScheduleEnginePage = lazy(() => import('./pages/ScheduleEnginePage').then((module) => ({ default: module.ScheduleEnginePage })))
const SharedSchedulePage = lazy(() => import('./pages/SharedSchedulePage').then((module) => ({ default: module.SharedSchedulePage })))
const StudentDetailPage = lazy(() => import('./pages/StudentDetailPage').then((module) => ({ default: module.StudentDetailPage })))
const StudentsPage = lazy(() => import('./pages/StudentsPage').then((module) => ({ default: module.StudentsPage })))
const WhyScheduleSharePage = lazy(() => import('./pages/WhyScheduleSharePage').then((module) => ({ default: module.WhyScheduleSharePage })))

function deferredPage(page: ReactNode) {
  return <Suspense fallback={<div className="route-loading" role="status" aria-live="polite"><span className="loader" aria-hidden="true" /><p>Loading page…</p></div>}>{page}</Suspense>
}

export function App() {
  const auth = useAuth()
  if (auth.passwordRecovery) return deferredPage(<PasswordResetPage />)
  return (
    <Routes>
      <Route path="/auth" element={<AuthPromptRoute />} />
      <Route element={<RequireAuth />}>
        <Route path="/onboarding" element={deferredPage(<OnboardingPage />)} />
      </Route>
      <Route element={<AppShell />}>
        <Route path="share/:token" element={deferredPage(<SharedSchedulePage />)} />
      </Route>
      <Route element={<AllowGuest />}>
        <Route element={<AppShell />}>
          <Route index element={deferredPage(<HomePage />)} />
          <Route path="schedule" element={deferredPage(<SchedulePage />)} />
          <Route path="classes" element={deferredPage(<ClassesPage />)} />
          <Route path="classes/:classId" element={deferredPage(<ClassesPage />)} />
          <Route path="why-scheduleshare" element={<WhyScheduleShareRoute>{deferredPage(<WhyScheduleSharePage />)}</WhyScheduleShareRoute>} />
          <Route element={<RequireAuth />}>
            <Route path="students" element={deferredPage(<StudentsPage />)} />
            <Route path="schedule-engine" element={deferredPage(<ScheduleEnginePage />)} />
            <Route path="students/:studentId" element={deferredPage(<StudentDetailPage />)} />
            <Route path="directory" element={deferredPage(<StudentsPage />)} />
            <Route path="classmates" element={<Navigate to="/students" replace />} />
            <Route path="profile" element={deferredPage(<ProfilePage />)} />
            <Route path="privacy" element={<Navigate to="/profile" replace />} />
            <Route path="report" element={deferredPage(<ReportPage />)} />
            <Route element={<RequireAdmin />}>
              <Route path="admin" element={deferredPage(<AdminPage />)} />
            </Route>
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
