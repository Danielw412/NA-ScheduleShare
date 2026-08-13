import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProfileAvatar } from './ProfileAvatar'

const mocks = vi.hoisted(() => ({
  profilePictureUrl: vi.fn(),
}))

vi.mock('../../lib/profile', () => ({
  profilePictureUrl: mocks.profilePictureUrl,
}))

beforeEach(() => {
  mocks.profilePictureUrl.mockReset()
})

afterEach(() => {
  cleanup()
})

describe('ProfileAvatar', () => {
  it('lazy-loads profile pictures so offscreen directory avatars do not all fetch at once', () => {
    mocks.profilePictureUrl.mockReturnValue('https://example.test/avatar-one')
    const { container } = render(<ProfileAvatar userId="user-one" fullName="Example Student" />)
    const image = container.querySelector('img')
    expect(image).toHaveAttribute('loading', 'lazy')
    expect(image).toHaveAttribute('decoding', 'async')
  })

  it('remembers a failed avatar URL and does not request it again after remounting', () => {
    const failedUrl = 'https://example.test/avatar-missing'
    mocks.profilePictureUrl.mockReturnValue(failedUrl)

    const first = render(<ProfileAvatar userId="user-missing" fullName="Missing Avatar" />)
    const firstImage = first.container.querySelector('img')
    expect(firstImage).not.toBeNull()
    fireEvent.error(firstImage!)
    expect(first.container.querySelector('img')).toBeNull()
    first.unmount()

    const second = render(<ProfileAvatar userId="user-missing" fullName="Missing Avatar" />)
    expect(second.container.querySelector('img')).toBeNull()
  })
})
