import { describe, expect, it, vi } from 'vitest'
import { handleDeleteAccountRequest, type DeleteAccountDependencies } from './core'

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function dependencies(): DeleteAccountDependencies {
  return {
    verifyUser: vi.fn(async () => ({ id: USER_ID })),
    deleteAvatar: vi.fn(async () => undefined),
    deleteUser: vi.fn(async () => undefined),
    recordEvent: vi.fn(async () => undefined),
  }
}

function request(body: unknown = { confirmation: 'DELETE' }, authorization = 'Bearer caller-token') {
  return new Request('http://localhost/functions/v1/delete-account', {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('delete-account Edge Function', () => {
  it('derives the account from the verified JWT and removes its avatar before Auth', async () => {
    const deps = dependencies()
    const response = await handleDeleteAccountRequest(request({ confirmation: 'DELETE', user_id: 'attacker-target' }), deps)
    expect(response.status).toBe(200)
    expect(deps.verifyUser).toHaveBeenCalledWith('caller-token')
    expect(deps.deleteAvatar).toHaveBeenCalledWith(USER_ID)
    expect(deps.deleteUser).toHaveBeenCalledWith(USER_ID)
    expect((deps.deleteAvatar as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0])
      .toBeLessThan((deps.deleteUser as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0])
  })

  it('requires an exact explicit confirmation', async () => {
    const deps = dependencies()
    const response = await handleDeleteAccountRequest(request({ confirmation: 'delete' }), deps)
    expect(response.status).toBe(400)
    expect(deps.verifyUser).not.toHaveBeenCalled()
    expect(deps.deleteUser).not.toHaveBeenCalled()
  })

  it('requires authentication', async () => {
    const response = await handleDeleteAccountRequest(request({ confirmation: 'DELETE' }, ''), dependencies())
    expect(response.status).toBe(401)
  })

  it('does not delete Auth when profile-picture cleanup fails', async () => {
    const deps = dependencies()
    vi.mocked(deps.deleteAvatar).mockRejectedValue(new Error('storage unavailable'))
    const response = await handleDeleteAccountRequest(request(), deps)
    expect(response.status).toBe(500)
    expect(deps.deleteUser).not.toHaveBeenCalled()
  })
})
