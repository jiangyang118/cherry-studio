import type { Model } from '@renderer/types'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useKnowledgeBaseForm } from '../useKnowledgeBaseForm'

const mocks = vi.hoisted(() => ({
  providers: [
    {
      id: 'openai',
      name: 'OpenAI',
      models: [
        {
          id: 'text-embedding-3-small',
          provider: 'openai',
          name: 'text-embedding-3-small',
          group: 'embedding'
        }
      ]
    }
  ] as any[],
  preprocessProviders: [] as any[],
  t: vi.fn((key: string) => key)
}))

vi.mock('@renderer/hooks/useProvider', () => ({
  useProviders: () => ({ providers: mocks.providers })
}))

vi.mock('@renderer/hooks/usePreprocess', () => ({
  usePreprocessProviders: () => ({ preprocessProviders: mocks.preprocessProviders })
}))

vi.mock('@renderer/config/models', () => ({
  isEmbeddingModel: (model: Model) => model.group === 'embedding'
}))

vi.mock('@renderer/config/embedings', () => ({
  getEmbeddingMaxContext: vi.fn()
}))

vi.mock('@renderer/services/ModelService', () => ({
  getModelUniqId: (model: Model | undefined) => (model ? `${model.provider}/${model.id}` : undefined)
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mocks.t })
}))

describe('useKnowledgeBaseForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.providers.splice(0, mocks.providers.length, {
      id: 'openai',
      name: 'OpenAI',
      models: [
        {
          id: 'text-embedding-3-small',
          provider: 'openai',
          name: 'text-embedding-3-small',
          group: 'embedding'
        }
      ]
    } as any)
  })

  it('auto selects the first available embedding model for new knowledge bases', async () => {
    const { result } = renderHook(() => useKnowledgeBaseForm())

    await waitFor(() => {
      expect(result.current.newBase.model?.id).toBe('text-embedding-3-small')
      expect(result.current.newBase.model?.provider).toBe('openai')
    })
  })

  it('does not override existing base model when editing', async () => {
    const existingBaseModel = {
      id: 'custom-embedding',
      provider: 'custom',
      name: 'custom-embedding',
      group: 'embedding'
    } as Model

    const { result } = renderHook(() =>
      useKnowledgeBaseForm({
        id: 'base-id',
        name: 'Existing Base',
        model: existingBaseModel,
        items: [],
        created_at: Date.now(),
        updated_at: Date.now(),
        version: 1
      })
    )

    await waitFor(() => {
      expect(result.current.newBase.model).toEqual(existingBaseModel)
    })
  })
})
