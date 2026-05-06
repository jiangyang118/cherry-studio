import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listModelsMock, listProvidersMock } = vi.hoisted(() => ({
  listModelsMock: vi.fn(),
  listProvidersMock: vi.fn()
}))

vi.mock('@data/services/ModelService', () => ({
  modelService: {
    list: listModelsMock
  }
}))

vi.mock('@data/services/ProviderService', () => ({
  providerService: {
    list: listProvidersMock
  }
}))

import { modelsService } from '../models'

describe('ModelsService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns v2 SQLite models in the OpenAI-compatible shape used by agent model selection', async () => {
    listProvidersMock.mockResolvedValueOnce([
      {
        id: 'openai',
        name: 'OpenAI',
        defaultChatEndpoint: 'openai-responses',
        endpointConfigs: { 'openai-responses': { baseUrl: 'https://api.openai.com' } },
        isEnabled: true
      }
    ])
    listModelsMock.mockResolvedValueOnce([
      {
        providerId: 'openai',
        apiModelId: 'gpt-4o',
        name: 'GPT-4o',
        endpointTypes: ['openai-responses'],
        isEnabled: true
      }
    ])

    const result = await modelsService.getModels({ offset: 0, limit: 20 })

    expect(listProvidersMock).toHaveBeenCalledWith({ enabled: true })
    expect(listModelsMock).toHaveBeenCalledWith({ enabled: true })
    expect(result).toEqual({
      object: 'list',
      data: [
        {
          id: 'openai:gpt-4o',
          object: 'model',
          name: 'GPT-4o',
          created: expect.any(Number),
          owned_by: 'OpenAI',
          provider: 'openai',
          provider_name: 'OpenAI',
          provider_type: 'openai-response',
          provider_model_id: 'gpt-4o'
        }
      ],
      total: 1,
      offset: 0,
      limit: 20
    })
  })

  it('filters anthropic-compatible models from v2 endpoint metadata', async () => {
    listProvidersMock.mockResolvedValueOnce([
      {
        id: 'anthropic',
        name: 'Anthropic',
        defaultChatEndpoint: 'anthropic-messages',
        endpointConfigs: { 'anthropic-messages': { baseUrl: 'https://api.anthropic.com' } },
        isEnabled: true
      },
      {
        id: 'openai',
        name: 'OpenAI',
        defaultChatEndpoint: 'openai-responses',
        endpointConfigs: { 'openai-responses': { baseUrl: 'https://api.openai.com' } },
        isEnabled: true
      }
    ])
    listModelsMock.mockResolvedValueOnce([
      {
        providerId: 'anthropic',
        apiModelId: 'claude-sonnet-4-5',
        name: 'Claude Sonnet 4.5',
        endpointTypes: ['anthropic-messages'],
        isEnabled: true
      },
      {
        providerId: 'openai',
        apiModelId: 'gpt-4o',
        name: 'GPT-4o',
        endpointTypes: ['openai-responses'],
        isEnabled: true
      }
    ])

    const result = await modelsService.getModels({ providerType: 'anthropic', offset: 0, limit: 20 })

    expect(result.data.map((model) => model.id)).toEqual(['anthropic:claude-sonnet-4-5'])
    expect(result.total).toBe(1)
  })
})
