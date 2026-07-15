import { Navigate, Route, Routes } from 'react-router-dom'
import { RequireAdmin, RequireAuth } from './components/auth/RouteGuards'
import { AppShell } from './components/layout/AppShell'
import { AdminPage } from './pages/AdminPage'
import { AuthPage } from './pages/AuthPage'
import { ClassesPage } from './pages/ClassesPage'
import { ClassmatesPage } from './pages/ClassmatesPage'
import { HomePage } from './pages/HomePage'
import { OnboardingPage } from './pages/OnboardingPage'
import { PrivacyPage } from './pages/PrivacyPage'
import { ReportPage } from './pages/ReportPage'
import { SchedulePage } from './pages/SchedulePage'
import { StudentDetailPage } from './pages/StudentDetailPage'
import { StudentsPage } from './pages/StudentsPage'

export function App() {
  return (
    <Routes>
      <Route path="/auth" element={<AuthPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="schedule" element={<SchedulePage />} />
          <Route path="classes" element={<ClassesPage />} />
          <Route path="classes/:classId" element={<ClassesPage />} />
          <Route path="students" element={<StudentsPage />} />
          <Route path="students/:studentId" element={<StudentDetailPage />} />
          <Route path="classmates" element={<ClassmatesPage />} />
          <Route path="directory" element={<StudentsPage />} />
          <Route path="privacy" element={<PrivacyPage />} />
          <Route path="report" element={<ReportPage />} />
          <Route element={<RequireAdmin />}>
            <Route path="admin" element={<AdminPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
