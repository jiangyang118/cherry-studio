import { ErrorCode } from '@shared/data/api/apiErrors'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const dataApiServiceMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn()
}))

vi.mock('@data/DataApiService', () => ({
  dataApiService: dataApiServiceMock
}))

vi.mock('@data/PreferenceService', () => ({
  preferenceService: {
    get: vi.fn(),
    isCached: vi.fn(() => true)
  }
}))

vi.mock('@renderer/store', () => ({
  default: {
    getState: vi.fn(() => ({
      assistants: {
        assistants: [],
        defaultAssistant: { settings: {} }
      },
      llm: {},
      settings: {
        providers: []
      }
    })),
    dispatch: vi.fn()
  }
}))

vi.mock('@renderer/store/assistants', () => ({
  addAssistant: vi.fn()
}))

import { ensureLegacyTopicInDataApi, mapLegacyTopicToDto } from '../AssistantService'

const legacyTopic = {
  id: 'legacy-topic',
  assistantId: 'default',
  name: '默认话题',
  createdAt: '2026-05-06T00:00:00.000Z',
  updatedAt: '2026-05-06T00:00:00.000Z',
  messages: [],
  isNameManuallyEdited: false
}

describe('AssistantService topic Data API compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('omits legacy assistant ids when creating a topic DTO', () => {
    expect(mapLegacyTopicToDto(legacyTopic)).toEqual({ name: '默认话题' })
  })

  it('creates a Data API topic when the legacy active topic is missing', async () => {
    dataApiServiceMock.get.mockRejectedValue({ code: ErrorCode.NOT_FOUND })
    dataApiServiceMock.post.mockResolvedValue({
      id: '16855992-aabb-4d28-8f46-f0d1285c0f7f',
      name: '默认话题',
      assistantId: null,
      isNameManuallyEdited: false,
      activeNodeId: null,
      groupId: null,
      orderKey: 'a0',
      createdAt: '2026-05-06T01:00:00.000Z',
      updatedAt: '2026-05-06T01:00:00.000Z'
    })

    const ensuredTopic = await ensureLegacyTopicInDataApi(legacyTopic)

    expect(dataApiServiceMock.post).toHaveBeenCalledWith('/topics', { body: { name: '默认话题' } })
    expect(ensuredTopic).toMatchObject({
      id: '16855992-aabb-4d28-8f46-f0d1285c0f7f',
      assistantId: 'default',
      name: '默认话题',
      messages: []
    })
  })
})
