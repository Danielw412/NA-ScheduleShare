export interface GoogleCredentialResponse {
  credential: string
  select_by: string
  state?: string
}

interface GoogleIdentityApi {
  initialize(options: {
    client_id: string
    callback: (response: GoogleCredentialResponse) => void
    nonce?: string
    ux_mode?: 'popup' | 'redirect'
  }): void

  renderButton(
    parent: HTMLElement,
    options: {
      type?: 'standard' | 'icon'
      theme?: 'outline' | 'filled_blue' | 'filled_black' | 'outline_dark'
      size?: 'large' | 'medium' | 'small'
      text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin'
      shape?: 'rectangular' | 'pill' | 'circle' | 'square'
      logo_alignment?: 'left' | 'center'
      width?: string
    },
  ): void
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: GoogleIdentityApi
      }
    }
  }
}

let loadPromise: Promise<GoogleIdentityApi> | null = null

export function loadGoogleIdentity(): Promise<GoogleIdentityApi> {
  if (window.google?.accounts.id) {
    return Promise.resolve(window.google.accounts.id)
  }

  if (loadPromise) return loadPromise

  const promise = new Promise<GoogleIdentityApi>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true

    script.addEventListener(
      'load',
      () => {
        if (window.google?.accounts.id) {
          resolve(window.google.accounts.id)
        } else {
          reject(new Error('Google sign-in loaded incorrectly.'))
        }
      },
      { once: true },
    )

    script.addEventListener(
      'error',
      () => {
        script.remove()
        reject(new Error('Could not load Google sign-in.'))
      },
      { once: true },
    )

    document.head.appendChild(script)
  })

  loadPromise = promise

  void promise.catch(() => {
    if (loadPromise === promise) loadPromise = null
  })

  return promise
}

export async function createGoogleNonce(): Promise<{
  nonce: string
  hashedNonce: string
}> {
  const randomBytes = crypto.getRandomValues(new Uint8Array(32))
  const nonce = btoa(String.fromCharCode(...randomBytes))

  const encodedNonce = new TextEncoder().encode(nonce)
  const hashBuffer = await crypto.subtle.digest('SHA-256', encodedNonce)

  const hashedNonce = Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')

  return { nonce, hashedNonce }
}