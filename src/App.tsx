import { Navigate, Route, Routes } from 'react-router-dom'
import { AllowGuest, RequireAdmin, RequireAuth } from './components/auth/RouteGuards'
import { AuthPromptRoute } from './components/auth/AuthPromptRoute'
import { AppShell } from './components/layout/AppShell'
import { AdminPage } from './pages/AdminPage'
import { ClassesPage } from './pages/ClassesPage'
import { HomePage } from './pages/HomePage'
import { OnboardingPage } from './pages/OnboardingPage'
import { ProfilePage } from './pages/ProfilePage'
import { ReportPage } from './pages/ReportPage'
import { SchedulePage } from './pages/SchedulePage'
import { SharedSchedulePage } from './pages/SharedSchedulePage'
import { StudentDetailPage } from './pages/StudentDetailPage'
import { StudentsPage } from './pages/StudentsPage'

export function App() {
  return (
    <Routes>
      <Route path="/auth" element={<AuthPromptRoute />} />
      <Route element={<RequireAuth />}>
        <Route path="/onboarding" element={<OnboardingPage />} />
      </Route>
      <Route element={<AppShell />}>
        <Route path="share/:token" element={<SharedSchedulePage />} />
      </Route>
      <Route element={<AllowGuest />}>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="schedule" element={<SchedulePage />} />
          <Route path="classes" element={<ClassesPage />} />
          <Route path="classes/:classId" element={<ClassesPage />} />
          <Route element={<RequireAuth />}>
            <Route path="students" element={<StudentsPage />} />
            <Route path="students/:studentId" element={<StudentDetailPage />} />
            <Route path="directory" element={<StudentsPage />} />
            <Route path="classmates" element={<Navigate to="/students" replace />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="privacy" element={<Navigate to="/profile" replace />} />
            <Route path="report" element={<ReportPage />} />
            <Route element={<RequireAdmin />}>
              <Route path="admin" element={<AdminPage />} />
            </Route>
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
