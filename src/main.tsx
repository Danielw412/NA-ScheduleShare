import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { App } from './App'
import { GuestAccountPromptProvider } from './components/auth/GuestAccountPrompt'
import { ClubPromptProvider } from './components/club/ClubPromptProvider'
import { AuthProvider } from './features/auth/AuthProvider'
import './styles.css'
import './mobile-layout-fixes.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <AuthProvider>
        <GuestAccountPromptProvider>
          <ClubPromptProvider>
            <App />
          </ClubPromptProvider>
        </GuestAccountPromptProvider>
      </AuthProvider>
    </HashRouter>
  </StrictMode>,
)
