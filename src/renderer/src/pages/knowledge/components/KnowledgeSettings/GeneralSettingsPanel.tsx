import InputEmbeddingDimension from '@renderer/components/InputEmbeddingDimension'
import ModelSelector from '@renderer/components/ModelSelector'
import { InfoTooltip } from '@renderer/components/TooltipIcons'
import { DEFAULT_KNOWLEDGE_DOCUMENT_COUNT } from '@renderer/config/constant'
import { isEmbeddingModel } from '@renderer/config/models'
import { useAllProviders, useProviders } from '@renderer/hooks/useProvider'
import { getModelUniqId } from '@renderer/services/ModelService'
import type { KnowledgeBase } from '@renderer/types'
import { Button, Input, Slider } from 'antd'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingsItem, SettingsPanel } from './styles'

interface GeneralSettingsPanelProps {
  newBase: KnowledgeBase
  setNewBase: React.Dispatch<React.SetStateAction<KnowledgeBase>>
  handlers: {
    handleEmbeddingModelChange: (value: string) => void
    handleDimensionChange: (value: number | null) => void
  }
}

const GeneralSettingsPanel: React.FC<GeneralSettingsPanelProps> = ({ newBase, setNewBase, handlers }) => {
  const { t } = useTranslation()
  const { providers } = useProviders()
  const allProviders = useAllProviders()
  const { handleEmbeddingModelChange, handleDimensionChange } = handlers
  const hasEmbeddingModels = useMemo(
    () => providers.some((provider) => provider.models.some((model) => isEmbeddingModel(model))),
    [providers]
  )
  const embeddingProviderSettingsPath = useMemo(() => {
    const providerSupportsEmbedding = (provider: (typeof allProviders)[number]) =>
      provider.models.some((model) => isEmbeddingModel(model))

    const candidates = allProviders.filter(providerSupportsEmbedding)
    if (candidates.length === 0) {
      return '/settings/provider'
    }

    const preferredProviderIds = ['openai', 'jina', 'voyageai', 'zhipu', 'dashscope', 'ollama', 'new-api']
    const pick = (...filters: Array<(provider: (typeof allProviders)[number]) => boolean>) =>
      candidates.find((provider) => filters.every((filter) => filter(provider)))

    const hasApiKey = (provider: (typeof allProviders)[number]) => (provider.apiKey ?? '').trim().length > 0
    const isEnabled = (provider: (typeof allProviders)[number]) => provider.enabled === true
    const isPreferred = (provider: (typeof allProviders)[number]) => preferredProviderIds.includes(provider.id)

    const targetProvider =
      pick(isEnabled, hasApiKey) ||
      pick(hasApiKey, isPreferred) ||
      pick(hasApiKey) ||
      pick(isEnabled, isPreferred) ||
      pick(isPreferred) ||
      candidates[0]

    return `/settings/provider?id=${targetProvider.id}`
  }, [allProviders])

  return (
    <SettingsPanel>
      <SettingsItem>
        <div className="settings-label">{t('common.name')}</div>
        <Input
          placeholder={t('common.name')}
          value={newBase.name}
          onChange={(e) => setNewBase((prev) => ({ ...prev, name: e.target.value }))}
        />
      </SettingsItem>

      <SettingsItem>
        <div className="settings-label" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span>{t('models.embedding_model')}</span>
          <InfoTooltip title={t('models.embedding_model_tooltip')} placement="right" />
          <Button
            type="link"
            size="small"
            style={{ paddingInline: 0, height: 'auto' }}
            onClick={() => window.navigate(embeddingProviderSettingsPath)}>
            {t('navigate.provider_settings')}
          </Button>
        </div>
        <ModelSelector
          providers={providers}
          predicate={isEmbeddingModel}
          style={{ width: '100%' }}
          placeholder={t('settings.models.empty')}
          disabled={!hasEmbeddingModels}
          value={getModelUniqId(newBase.model)}
          onChange={handleEmbeddingModelChange}
        />
        {!hasEmbeddingModels && (
          <div className="settings-help" style={{ marginTop: 8, fontSize: 12 }}>
            <span>{t('models.embedding_model_tooltip')}</span>
          </div>
        )}
      </SettingsItem>

      <SettingsItem>
        <div className="settings-label">
          {t('knowledge.dimensions')}
          <InfoTooltip title={t('knowledge.dimensions_size_tooltip')} placement="right" />
        </div>
        <InputEmbeddingDimension
          value={newBase.dimensions}
          onChange={handleDimensionChange}
          model={newBase.model}
          disabled={!newBase.model}
        />
      </SettingsItem>

      <SettingsItem>
        <div className="settings-label">
          {t('knowledge.document_count')}
          <InfoTooltip title={t('knowledge.document_count_help')} placement="right" />
        </div>
        <Slider
          style={{ width: '97%' }}
          min={1}
          max={50}
          step={1}
          value={newBase.documentCount || DEFAULT_KNOWLEDGE_DOCUMENT_COUNT}
          marks={{ 1: '1', 6: t('knowledge.document_count_default'), 30: '30', 50: '50' }}
          onChange={(value) => setNewBase((prev) => ({ ...prev, documentCount: value }))}
        />
      </SettingsItem>
    </SettingsPanel>
  )
}

export default GeneralSettingsPanel
