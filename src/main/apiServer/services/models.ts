import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import type { EndpointType, Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import type { ApiModel, ApiModelsFilter, ApiModelsResponse } from '../../../renderer/src/types/apiModels'

const logger = loggerService.withContext('ModelsService')

// Re-export for backward compatibility

export type ModelsFilter = ApiModelsFilter

const ANTHROPIC_ENDPOINT: EndpointType = 'anthropic-messages'
const OLLAMA_ENDPOINTS = new Set<EndpointType>(['ollama-chat', 'ollama-generate'])
const OPENAI_RESPONSE_ENDPOINT: EndpointType = 'openai-responses'
const OPENAI_ENDPOINTS = new Set<EndpointType>([
  'openai-chat-completions',
  'openai-responses',
  'openai-text-completions'
])
const GEMINI_ENDPOINT: EndpointType = 'google-generate-content'

type ProviderType = NonNullable<ApiModel['provider_type']>

function getProviderEndpointTypes(provider: Provider): EndpointType[] {
  return Object.keys(provider.endpointConfigs ?? {}) as EndpointType[]
}

function inferProviderType(provider: Provider): ProviderType {
  const endpoints = getProviderEndpointTypes(provider)
  const defaultEndpoint = provider.defaultChatEndpoint

  if (defaultEndpoint === ANTHROPIC_ENDPOINT) return 'anthropic'
  if (defaultEndpoint === OPENAI_RESPONSE_ENDPOINT) return 'openai-response'
  if (defaultEndpoint === GEMINI_ENDPOINT) return 'gemini'
  if (defaultEndpoint && OLLAMA_ENDPOINTS.has(defaultEndpoint)) return 'ollama'
  if (defaultEndpoint && OPENAI_ENDPOINTS.has(defaultEndpoint)) return 'openai'

  if (endpoints.some((endpoint) => OLLAMA_ENDPOINTS.has(endpoint))) return 'ollama'
  if (endpoints.includes(ANTHROPIC_ENDPOINT)) return 'anthropic'
  if (endpoints.includes(OPENAI_RESPONSE_ENDPOINT)) return 'openai-response'
  if (endpoints.includes(GEMINI_ENDPOINT)) return 'gemini'

  return 'openai'
}

function providerSupportsFilter(provider: Provider, providerType?: ProviderType): boolean {
  if (!providerType) return true

  const inferredType = inferProviderType(provider)
  if (inferredType === providerType) return true

  if (providerType === 'anthropic') {
    return getProviderEndpointTypes(provider).includes(ANTHROPIC_ENDPOINT)
  }

  return false
}

function modelSupportsFilter(model: Model, providerType?: ProviderType): boolean {
  if (!providerType) return true

  const endpointTypes = model.endpointTypes ?? []
  if (endpointTypes.length === 0) return true

  if (providerType === 'anthropic') return endpointTypes.includes(ANTHROPIC_ENDPOINT)
  if (providerType === 'ollama') return endpointTypes.some((endpoint) => OLLAMA_ENDPOINTS.has(endpoint))
  if (providerType === 'openai-response') return endpointTypes.includes(OPENAI_RESPONSE_ENDPOINT)
  if (providerType === 'gemini') return endpointTypes.includes(GEMINI_ENDPOINT)
  if (providerType === 'openai') return endpointTypes.some((endpoint) => OPENAI_ENDPOINTS.has(endpoint))

  return true
}

function transformV2ModelToOpenAI(model: Model, provider: Provider): ApiModel {
  return {
    id: `${model.providerId}:${model.apiModelId}`,
    object: 'model',
    name: model.name,
    created: Math.floor(Date.now() / 1000),
    owned_by: provider.name || model.providerId,
    provider: model.providerId,
    provider_name: provider.name,
    provider_type: inferProviderType(provider),
    provider_model_id: model.apiModelId
  }
}

export class ModelsService {
  async getModels(filter: ModelsFilter): Promise<ApiModelsResponse> {
    try {
      logger.debug('Getting available models from providers', { filter })

      const [providers, models] = await Promise.all([
        providerService.list({ enabled: true }),
        modelService.list({ enabled: true })
      ])
      const providerById = new Map(providers.map((provider) => [provider.id, provider]))
      // Use Map to deduplicate models by their full ID (provider:model_id)
      const uniqueModels = new Map<string, ApiModel>()

      for (const model of models) {
        const provider = providerById.get(model.providerId)
        // logger.debug(`Processing model ${model.id}`)
        if (!provider) {
          logger.debug(`Skipping model ${model.id} . Reason: Provider not found.`)
          continue
        }

        if (
          !providerSupportsFilter(provider, filter.providerType) ||
          !modelSupportsFilter(model, filter.providerType)
        ) {
          logger.debug(`Skipping model ${model.id}. Reason: Not compatible with provider type filter.`, {
            providerId: provider.id,
            providerType: filter.providerType
          })
          continue
        }

        const openAIModel = transformV2ModelToOpenAI(model, provider)
        const fullModelId = openAIModel.id // This is already in format "provider:model_id"

        // Only add if not already present (first occurrence wins)
        if (!uniqueModels.has(fullModelId)) {
          uniqueModels.set(fullModelId, openAIModel)
        } else {
          logger.debug(`Skipping duplicate model: ${fullModelId}`)
        }
      }

      let modelData = Array.from(uniqueModels.values())
      const total = modelData.length

      // Apply pagination
      const offset = filter?.offset || 0
      const limit = filter?.limit

      if (limit !== undefined) {
        modelData = modelData.slice(offset, offset + limit)
        logger.debug(
          `Applied pagination: offset=${offset}, limit=${limit}, showing ${modelData.length} of ${total} models`
        )
      } else if (offset > 0) {
        modelData = modelData.slice(offset)
        logger.debug(`Applied offset: offset=${offset}, showing ${modelData.length} of ${total} models`)
      }

      logger.info('Models retrieved', {
        returned: modelData.length,
        discovered: models.length,
        filter
      })

      if (models.length > total) {
        logger.debug(`Filtered out ${models.length - total} models after deduplication and filtering`)
      }

      const response: ApiModelsResponse = {
        object: 'list',
        data: modelData
      }

      // Add pagination metadata if applicable
      if (filter?.limit !== undefined || filter?.offset !== undefined) {
        response.total = total
        response.offset = offset
        if (filter?.limit !== undefined) {
          response.limit = filter.limit
        }
      }

      return response
    } catch (error: any) {
      logger.error('Error getting models', { error, filter })
      return {
        object: 'list',
        data: []
      }
    }
  }
}

// Export singleton instance
export const modelsService = new ModelsService()
