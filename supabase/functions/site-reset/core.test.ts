import { describe, expect, it, vi } from 'vitest'
import { handleSiteResetRequest, type SiteResetDependencies } from './core'

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PHRASE = 'RESET SCHEDULESHARE DELETE ALL ACCOUNTS AND CLASSES'

function dependencies(): SiteResetDependencies {
  return {
    verifyUser: vi.fn(async () => ({ id: USER_ID })),
    verifyAccess: vi.fn(async () => true),
    listProfilePicturePaths: vi.fn(async () => [`${USER_ID}/avatar`]),
    deleteProfilePictures: vi.fn(async () => undefined),
    resetDatabase: vi.fn(async () => ({ accounts: 1, classes: 2 })),
  }
}

function request(confirmation = PHRASE) {
  return new Request('https://project.supabase.co/functions/v1/site-reset', {
    method: 'POST',
    headers: { Authorization: 'Bearer verified-token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmation }),
  })
}

describe('site reset Edge Function', () => {
  it('deletes Storage objects before the atomic database reset', async () => {
    const deps = dependencies()
    const response = await handleSiteResetRequest(request(), deps)
    expect(response.status).toBe(200)
    expect(deps.deleteProfilePictures).toHaveBeenCalledWith([`${USER_ID}/avatar`])
    expect(vi.mocked(deps.deleteProfilePictures).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(deps.resetDatabase).mock.invocationCallOrder[0])
    expect(deps.resetDatabase).toHaveBeenCalledWith(USER_ID, PHRASE)
  })

  it('rejects an incorrect confirmation before any deletion', async () => {
    const deps = dependencies()
    const response = await handleSiteResetRequest(request('RESET'), deps)
    expect(response.status).toBe(400)
    expect(deps.deleteProfilePictures).not.toHaveBeenCalled()
    expect(deps.resetDatabase).not.toHaveBeenCalled()
  })

  it('rejects accounts without protected access', async () => {
    const deps = dependencies()
    vi.mocked(deps.verifyAccess).mockResolvedValue(false)
    const response = await handleSiteResetRequest(request(), deps)
    expect(response.status).toBe(403)
    expect(deps.resetDatabase).not.toHaveBeenCalled()
  })
})
