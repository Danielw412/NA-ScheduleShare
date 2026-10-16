import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { App } from './App'
import { GuestAccountPromptProvider } from './components/auth/GuestAccountPrompt'
import { ClubPromptProvider } from './components/club/ClubPromptProvider'
import { ErrorBoundary } from './components/errors/ErrorBoundary'
import { ErrorFallback } from './components/errors/ErrorFallback'
import { ToastProvider } from './components/ui/Toast'
import { AuthProvider } from './features/auth/AuthProvider'
import { setupObservability } from './lib/observability/setup'
import { isSupabaseConfigured } from './lib/supabase/client'
import { reportAppIssue } from './lib/supabase/data'
import { applyStoredTheme } from './lib/theme'
import './styles/index.css'

setupObservability({ reportIssue: isSupabaseConfigured ? reportAppIssue : undefined })
applyStoredTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary scope="app" fallback={(props) => <ErrorFallback {...props} fullscreen />}>
      <HashRouter>
        <AuthProvider>
          <ToastProvider>
            <GuestAccountPromptProvider>
              <ClubPromptProvider>
                <App />
              </ClubPromptProvider>
            </GuestAccountPromptProvider>
          </ToastProvider>
        </AuthProvider>
      </HashRouter>
    </ErrorBoundary>
  </StrictMode>,
)
