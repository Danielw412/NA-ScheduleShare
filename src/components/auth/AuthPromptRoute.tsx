import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useGuestAccountPrompt } from './GuestAccountPrompt'

export function AuthPromptRoute() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { openAccountPrompt, openSignInPrompt } = useGuestAccountPrompt()
  const mode = searchParams.get('mode') === 'sign-up' ? 'sign-up' : 'sign-in'
  const next = searchParams.get('next') ?? '/schedule'

  useEffect(() => {
    if (mode === 'sign-up') openAccountPrompt(next)
    else openSignInPrompt(next)
    void navigate('/', { replace: true })
  }, [mode, navigate, next, openAccountPrompt, openSignInPrompt])

  return null
}
