import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { useAgentMock, createSessionMock } = vi.hoisted(() => ({
  useAgentMock: vi.fn(),
  createSessionMock: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (key === 'common.unnamed' ? '未命名' : key)
  })
}))

vi.mock('../useAgent', () => ({
  useAgent: useAgentMock
}))

vi.mock('../useSessions', () => ({
  useSessions: () => ({
    createSession: createSessionMock
  })
}))

import { useCreateDefaultSession } from '../useCreateDefaultSession'

describe('useCreateDefaultSession', () => {
  beforeEach(() => {
    MockCacheUtils.resetMocks()
    vi.clearAllMocks()
  })

  it('creates a session with only session DTO fields instead of spreading the agent entity', async () => {
    useAgentMock.mockReturnValue({
      agent: {
        id: 'agent-1',
        type: 'claude-code',
        name: 'Agent',
        description: '',
        accessiblePaths: ['/tmp/workspace'],
        instructions: 'You are helpful',
        model: 'ollama:qwen3.6:27b',
        allowedTools: [],
        configuration: { permission_mode: 'bypassPermissions' },
        sortOrder: -1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    })
    createSessionMock.mockResolvedValue({ id: 'session-1' })

    const { result } = renderHook(() => useCreateDefaultSession('agent-1'))

    await act(async () => {
      await result.current.createDefaultSession()
    })

    expect(createSessionMock).toHaveBeenCalledWith({ name: '未命名' })
  })
})
