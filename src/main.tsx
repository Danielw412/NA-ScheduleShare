import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { App } from './App'
import { GuestAccountPromptProvider } from './components/auth/GuestAccountPrompt'
import { AuthProvider } from './features/auth/AuthProvider'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <AuthProvider>
        <GuestAccountPromptProvider>
          <App />
        </GuestAccountPromptProvider>
      </AuthProvider>
    </HashRouter>
  </StrictMode>,
)
