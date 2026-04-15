import OpenClawLogo from '@renderer/assets/images/providers/openclaw.svg'
import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { CopyIcon } from '@renderer/components/Icons'
import ModelSelector from '@renderer/components/ModelSelector'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { useProviders } from '@renderer/hooks/useProvider'
import { loggerService } from '@renderer/services/LoggerService'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import {
  type GatewayStatus,
  type HealthInfo,
  setGatewayPort,
  setGatewayStatus,
  setLastHealthCheck,
  setSelectedModelUniqId
} from '@renderer/store/openclaw'
import { IpcChannel } from '@shared/IpcChannel'
import { Alert, Avatar, Button, Input, Radio, Result, Space, Spin } from 'antd'
import { Download, ExternalLink, Play, Square } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import UpdateButton from './components/UpdateButton'

const logger = loggerService.withContext('OpenClawPage')

const DEFAULT_DOCS_URL = 'https://docs.openclaw.ai/'

type ConnectionMode = 'local' | 'remote'

interface OpenClawConnectionConfig {
  mode: ConnectionMode
  gatewayPort: number
  controlUiBasePath: string
  remoteUrl: string
  remoteToken: string
  remotePassword: string
  remoteTransport: 'ssh' | 'direct'
}

interface TitleSectionProps {
  title: string
  description: string
  clickable?: boolean
  docsUrl?: string
}

const TitleSection: FC<TitleSectionProps> = ({ title, description, clickable = false, docsUrl }) => (
  <div className="-mt-20 mb-8 flex flex-col items-center text-center">
    <Avatar
      src={OpenClawLogo}
      size={64}
      shape="square"
      className={clickable ? 'cursor-pointer' : undefined}
      style={{ borderRadius: 12 }}
      onClick={clickable ? () => window.open(docsUrl ?? DEFAULT_DOCS_URL, '_blank') : undefined}
    />
    <h1
      className={`mt-3 font-semibold text-2xl ${clickable ? 'cursor-pointer hover:text-(--color-primary)' : ''}`}
      style={{ color: 'var(--color-text-1)' }}
      onClick={clickable ? () => window.open(docsUrl ?? DEFAULT_DOCS_URL, '_blank') : undefined}>
      {title}
    </h1>
    <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--color-text-2)' }}>
      {description}
    </p>
  </div>
)

const OpenClawPage: FC = () => {
  const { t, i18n } = useTranslation()
  const dispatch = useAppDispatch()
  const { providers } = useProviders()
  const { openSmartMinapp } = useMinappPopup()

  const docsUrl = useMemo(() => {
    const lang = i18n.language?.toLowerCase() ?? ''
    if (lang.startsWith('zh-cn')) {
      return 'https://docs.openclaw.ai/zh-CN'
    }
    return DEFAULT_DOCS_URL
  }, [i18n.language])

  const { gatewayStatus, gatewayPort, selectedModelUniqId } = useAppSelector((state) => state.openclaw)

  const [error, setError] = useState<string | null>(null)
  const [isInstalled, setIsInstalled] = useState<boolean | null>(null)
  const [isConnectionConfigLoaded, setIsConnectionConfigLoaded] = useState(false)
  const [needsMigration, setNeedsMigration] = useState(false)
  const [installPath, setInstallPath] = useState<string | null>(null)
  const [installError, setInstallError] = useState<string | null>(null)
  const [connectionMode, setConnectionMode] = useState<ConnectionMode>('local')
  const [remoteUrl, setRemoteUrl] = useState('')
  const [remoteToken, setRemoteToken] = useState('')
  const [remotePassword, setRemotePassword] = useState('')
  const [controlUiBasePath, setControlUiBasePath] = useState('')

  const [isInstalling, setIsInstalling] = useState(false)
  const [isUninstalling, setIsUninstalling] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [isStopping, setIsStopping] = useState(false)
  const [installLogs, setInstallLogs] = useState<Array<{ message: string; type: 'info' | 'warn' | 'error' }>>([])
  const [showLogs, setShowLogs] = useState(false)
  const [uninstallSuccess, setUninstallSuccess] = useState(false)
  const [isOpenClawUpdating, setIsOpenClawUpdating] = useState(false)

  const noApiKeyProviders = ['ollama', 'lmstudio', 'gpustack']
  const availableProviders = providers.filter((p) => p.enabled && (p.apiKey || noApiKeyProviders.includes(p.type)))

  const selectedModelInfo = useMemo(() => {
    if (!selectedModelUniqId) return null
    try {
      const parsed = JSON.parse(selectedModelUniqId) as { id: string; provider: string }
      for (const provider of availableProviders) {
        const model = provider.models.find((item) => item.id === parsed.id && item.provider === parsed.provider)
        if (model) {
          return { provider, model }
        }
      }
    } catch {
      return null
    }
    return null
  }, [selectedModelUniqId, availableProviders])

  const selectedProvider = selectedModelInfo?.provider ?? null
  const selectedModel = selectedModelInfo?.model ?? null
  const isRemoteMode = connectionMode === 'remote'

  type PageState = 'checking' | 'not_installed' | 'installed' | 'installing' | 'uninstalling'
  const pageState: PageState = useMemo(() => {
    if (isUninstalling) return 'uninstalling'
    if (isInstalling) return 'installing'
    if (isInstalled === null || !isConnectionConfigLoaded) return 'checking'
    if (isInstalled || isRemoteMode) return 'installed'
    return 'not_installed'
  }, [isConnectionConfigLoaded, isInstalled, isInstalling, isRemoteMode, isUninstalling])

  const checkInstallation = useCallback(async () => {
    try {
      const result = await window.api.openclaw.checkInstalled()
      setIsInstalled(result.installed)
      setNeedsMigration(result.needsMigration)
      setShowLogs(false)
      setInstallPath(result.path)
    } catch (err) {
      logger.debug('Failed to check installation', err as Error)
      setIsInstalled(false)
    }
  }, [])

  const loadConnectionConfig = useCallback(async () => {
    try {
      const result = (await window.api.openclaw.getConnectionConfig()) as OpenClawConnectionConfig
      setConnectionMode(result.mode)
      setRemoteUrl(result.remoteUrl)
      setRemoteToken(result.remoteToken)
      setRemotePassword(result.remotePassword)
      setControlUiBasePath(result.controlUiBasePath)
      dispatch(setGatewayPort(result.gatewayPort))
    } catch (err) {
      logger.error('Failed to load OpenClaw connection config', err as Error)
    } finally {
      setIsConnectionConfigLoaded(true)
    }
  }, [dispatch])

  const handleInstall = useCallback(async () => {
    setIsInstalling(true)
    setInstallError(null)
    setInstallLogs([])
    setShowLogs(true)
    try {
      const result = await window.api.openclaw.install()
      if (result.success) {
        await checkInstallation()
      } else {
        setInstallError(result.message)
      }
    } catch (err) {
      logger.error('Failed to install OpenClaw', err as Error)
      setInstallError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsInstalling(false)
    }
  }, [checkInstallation])

  const handleUninstall = useCallback(async () => {
    const confirmed = window.confirm(t('openclaw.uninstall_confirm'))
    if (!confirmed) {
      return
    }

    setIsUninstalling(true)
    setUninstallSuccess(false)
    setInstallError(null)
    setInstallLogs([])
    setShowLogs(true)
    try {
      const result = await window.api.openclaw.uninstall()
      if (result.success) {
        setUninstallSuccess(true)
      } else {
        setInstallError(result.message)
        setIsUninstalling(false)
      }
    } catch (err) {
      logger.error('Failed to uninstall OpenClaw', err as Error)
      setInstallError(err instanceof Error ? err.message : String(err))
      setIsUninstalling(false)
    }
  }, [t])

  const handleUninstallComplete = useCallback(() => {
    setShowLogs(false)
    setIsUninstalling(false)
    if (uninstallSuccess) {
      setIsInstalled(false)
      setUninstallSuccess(false)
    }
  }, [uninstallSuccess])

  const isInstallPage = pageState === 'installed'

  useSWR(
    isInstallPage ? 'openclaw/status' : null,
    async () => {
      const [status] = await Promise.all([window.api.openclaw.getStatus(), checkInstallation()])
      dispatch(setGatewayStatus(status.status as GatewayStatus))
      return status
    },
    { refreshInterval: 5000, revalidateOnFocus: false }
  )

  useSWR(
    isInstallPage && gatewayStatus === 'running' ? 'openclaw/health' : null,
    async () => {
      const health = await window.api.openclaw.checkHealth()
      dispatch(setLastHealthCheck(health as HealthInfo))
      return health
    },
    { refreshInterval: 5000, revalidateOnFocus: false }
  )

  useEffect(() => {
    void Promise.all([checkInstallation(), loadConnectionConfig()])
  }, [checkInstallation, loadConnectionConfig])

  useEffect(() => {
    const cleanup = window.electron.ipcRenderer.on(
      IpcChannel.OpenClaw_InstallProgress,
      (_, data: { message: string; type: 'info' | 'warn' | 'error' }) => {
        setInstallLogs((prev) => [...prev, data])
      }
    )
    return cleanup
  }, [])

  const handleModelSelect = (modelUniqId: string) => {
    dispatch(setSelectedModelUniqId(modelUniqId))
  }

  const handleStartGateway = async () => {
    if (!isRemoteMode && (!selectedProvider || !selectedModel)) {
      setError(t('openclaw.error.select_provider_model'))
      return
    }

    if (isRemoteMode && !remoteUrl.trim()) {
      setError(t('openclaw.error.remote_url_required'))
      return
    }

    setIsStarting(true)
    setError(null)

    try {
      const connectionResult = await window.api.openclaw.saveConnectionConfig({
        mode: connectionMode,
        gatewayPort,
        controlUiBasePath,
        remoteUrl,
        remoteToken,
        remotePassword,
        remoteTransport: 'direct'
      })
      if (!connectionResult.success) {
        setError(connectionResult.message)
        setIsStarting(false)
        return
      }

      if (!isRemoteMode) {
        const syncResult = await window.api.openclaw.syncConfig(selectedProvider!, selectedModel!)
        if (!syncResult.success) {
          setError(syncResult.message)
          setIsStarting(false)
          return
        }
      }

      const startResult = await window.api.openclaw.startGateway(isRemoteMode ? undefined : gatewayPort)
      if (!startResult.success) {
        setError(startResult.message)
        setIsStarting(false)
        return
      }

      const dashboardUrl = await window.api.openclaw.getDashboardUrl()
      openSmartMinapp({
        id: 'openclaw-dashboard',
        name: 'OpenClaw',
        url: dashboardUrl,
        logo: OpenClawLogo
      })

      setTimeout(() => {
        dispatch(setGatewayStatus('running'))
        setIsStarting(false)
      }, 500)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setIsStarting(false)
    }
  }

  const handleStopGateway = async () => {
    setIsStopping(true)
    try {
      const result = await window.api.openclaw.stopGateway()
      if (result.success) {
        dispatch(setGatewayStatus('stopped'))
      } else {
        setError(result.message)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsStopping(false)
    }
  }

  const handleOpenDashboard = async () => {
    const dashboardUrl = await window.api.openclaw.getDashboardUrl()
    openSmartMinapp({
      id: 'openclaw-dashboard',
      name: 'OpenClaw',
      url: dashboardUrl,
      logo: OpenClawLogo
    })
  }

  const renderLogContainer = (expanded = false) => (
    <div className="mb-6 overflow-hidden rounded-lg" style={{ background: 'var(--color-background-soft)' }}>
      <div
        className="flex items-center justify-between px-3 py-2 font-medium text-[13px]"
        style={{ background: 'var(--color-background-mute)' }}>
        <span>{t(expanded ? 'openclaw.uninstall_progress' : 'openclaw.install_progress')}</span>
        {!expanded && (
          <Button size="small" type="text" onClick={() => setShowLogs(false)}>
            {t('common.close')}
          </Button>
        )}
      </div>
      <div className={`overflow-y-auto px-3 py-2 font-mono text-xs leading-relaxed ${expanded ? 'h-75' : 'h-37.5'}`}>
        {installLogs.map((log, index) => (
          <div
            key={index}
            className="whitespace-pre-wrap break-all"
            style={{
              color:
                log.type === 'error'
                  ? 'var(--color-error)'
                  : log.type === 'warn'
                    ? 'var(--color-warning)'
                    : 'var(--color-text-2)'
            }}>
            {log.message}
          </div>
        ))}
      </div>
    </div>
  )

  const renderConnectionSection = () => (
    <div className="mb-6">
      <div className="mb-2 flex items-center gap-2 font-medium text-sm" style={{ color: 'var(--color-text-1)' }}>
        {t('openclaw.connection.title')}
      </div>
      <Radio.Group
        optionType="button"
        buttonStyle="solid"
        value={connectionMode}
        onChange={(event) => setConnectionMode(event.target.value as ConnectionMode)}>
        <Radio.Button value="local">{t('openclaw.connection.local')}</Radio.Button>
        <Radio.Button value="remote">{t('openclaw.connection.remote')}</Radio.Button>
      </Radio.Group>
      <div className="mt-1 text-xs" style={{ color: 'var(--color-text-3)' }}>
        {t(isRemoteMode ? 'openclaw.connection.remote_hint' : 'openclaw.connection.local_hint')}
      </div>
    </div>
  )

  const renderGatewayConfigSection = () => {
    if (!isRemoteMode) {
      return (
        <>
          <div className="mb-2 flex items-center gap-2 font-medium text-sm" style={{ color: 'var(--color-text-1)' }}>
            {t('openclaw.model_config.model')}
          </div>
          <ModelSelector
            style={{ width: '100%' }}
            placeholder={t('openclaw.model_config.select_model')}
            providers={availableProviders}
            value={selectedModelUniqId}
            onChange={handleModelSelect}
            grouped
            showAvatar
            showSuffix
          />
          <div className="mt-1 text-xs" style={{ color: 'var(--color-text-3)' }}>
            {t('openclaw.model_config.sync_hint')}
          </div>
        </>
      )
    }

    return (
      <>
        <div className="mb-2 flex items-center gap-2 font-medium text-sm" style={{ color: 'var(--color-text-1)' }}>
          {t('openclaw.connection.remote_url')}
        </div>
        <Input
          value={remoteUrl}
          onChange={(event) => setRemoteUrl(event.target.value)}
          placeholder={t('openclaw.connection.remote_url_placeholder')}
        />

        <div className="mt-4 mb-2 flex items-center gap-2 font-medium text-sm" style={{ color: 'var(--color-text-1)' }}>
          {t('openclaw.connection.control_ui_base_path')}
        </div>
        <Input
          value={controlUiBasePath}
          onChange={(event) => setControlUiBasePath(event.target.value)}
          placeholder={t('openclaw.connection.control_ui_base_path_placeholder')}
        />

        <div className="mt-4 mb-2 flex items-center gap-2 font-medium text-sm" style={{ color: 'var(--color-text-1)' }}>
          {t('openclaw.connection.remote_token')}
        </div>
        <Input.Password
          value={remoteToken}
          onChange={(event) => setRemoteToken(event.target.value)}
          placeholder={t('openclaw.connection.remote_token_placeholder')}
        />

        <div className="mt-4 mb-2 flex items-center gap-2 font-medium text-sm" style={{ color: 'var(--color-text-1)' }}>
          {t('openclaw.connection.remote_password')}
        </div>
        <Input.Password
          value={remotePassword}
          onChange={(event) => setRemotePassword(event.target.value)}
          placeholder={t('openclaw.connection.remote_password_placeholder')}
        />

        <div className="mt-1 text-xs" style={{ color: 'var(--color-text-3)' }}>
          {t('openclaw.connection.remote_auth_hint')}
        </div>
      </>
    )
  }

  const renderNotInstalledContent = () => (
    <div id="content-container" className="flex flex-1 flex-col overflow-y-auto py-5">
      <div className="flex-1" />
      <div className="mx-auto min-h-fit w-130 shrink-0">
        <Result
          icon={<Avatar src={OpenClawLogo} size={64} shape="square" style={{ borderRadius: 12 }} />}
          title={t(needsMigration ? 'openclaw.migration.title' : 'openclaw.not_installed.title')}
          subTitle={t(needsMigration ? 'openclaw.migration.description' : 'openclaw.not_installed.description')}
          extra={
            <Space>
              <Button
                type="primary"
                icon={<Download size={16} />}
                disabled={isInstalling}
                onClick={handleInstall}
                loading={isInstalling}>
                {t(needsMigration ? 'openclaw.migration.install_button' : 'openclaw.not_installed.install_button')}
              </Button>
              <Button
                icon={<ExternalLink size={16} />}
                disabled={isInstalling}
                onClick={() => window.open(docsUrl, '_blank')}>
                {t('openclaw.quick_actions.view_docs')}
              </Button>
            </Space>
          }
        />
        {installError && (
          <Alert
            message={installError}
            type="error"
            closable
            onClose={() => setInstallError(null)}
            style={{ marginBottom: 16 }}
          />
        )}

        {showLogs && installLogs.length > 0 && renderLogContainer()}
      </div>
      <div className="flex-1" />
    </div>
  )

  const renderInstalledContent = () => (
    <div id="content-container" className="flex flex-1 overflow-y-auto py-5">
      <div className="m-auto min-h-fit w-130">
        <TitleSection title={t('openclaw.title')} description={t('openclaw.description')} clickable docsUrl={docsUrl} />

        {installPath && gatewayStatus !== 'running' && !isRemoteMode && (
          <div
            className="mb-6 flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm"
            style={{ background: 'var(--color-background-soft)', color: 'var(--color-text-3)' }}>
            <div className="min-w-0 shrink overflow-hidden">
              <div className="mb-1">{t('openclaw.installed_at')}</div>
              <div className="flex items-center gap-2">
                <div className="truncate text-xs" title={installPath}>
                  {installPath}
                </div>
                <Button
                  type="link"
                  className="h-auto! w-3! p-0!"
                  aria-label={t('common.copy')}
                  icon={<CopyIcon className="size-3!" />}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(installPath)
                      window.toast.success(t('common.copied'))
                    } catch (err) {
                      window.toast.error(t('common.copy_failed'))
                      logger.error('Failed to copy install path:', err as Error)
                    }
                  }}
                />
                <UpdateButton onUpdateComplete={checkInstallation} onUpdatingChange={setIsOpenClawUpdating} />
              </div>
            </div>
            <span
              className="cursor-pointer whitespace-nowrap text-xs transition-colors hover:text-(--color-error)!"
              style={{ color: 'var(--color-text-3)' }}
              onClick={handleUninstall}>
              {t('openclaw.quick_actions.uninstall')}
            </span>
          </div>
        )}

        {gatewayStatus === 'running' && (
          <div
            className="mb-6 flex items-center justify-between rounded-lg p-3"
            style={{ background: 'var(--color-background-soft)' }}>
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-green-500" />
              <span className="font-medium text-sm" style={{ color: 'var(--color-text-1)' }}>
                {t(isRemoteMode ? 'openclaw.status.connected' : 'openclaw.status.running')}
              </span>
              {isRemoteMode ? (
                <span className="max-w-80 truncate font-mono text-[13px]" style={{ color: 'var(--color-text-3)' }}>
                  {remoteUrl}
                </span>
              ) : (
                <span className="font-mono text-[13px]" style={{ color: 'var(--color-text-3)' }}>
                  :{gatewayPort}
                </span>
              )}
            </div>
            {!isRemoteMode && (
              <Button
                size="small"
                type="text"
                icon={<Square size={14} />}
                onClick={handleStopGateway}
                loading={isStopping}
                disabled={isStopping}
                danger>
                {t('openclaw.gateway.stop')}
              </Button>
            )}
          </div>
        )}

        {error && (
          <div className="mb-6">
            <Alert
              message={
                <div className="flex items-start justify-between gap-2">
                  <span className="max-h-25 flex-1 overflow-y-auto whitespace-pre-wrap break-all">{error}</span>
                  <Button
                    type="link"
                    className="h-auto! w-3! shrink-0 p-0!"
                    aria-label={t('common.copy')}
                    icon={<CopyIcon className="size-3!" />}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(error)
                        window.toast.success(t('common.copied'))
                      } catch {
                        window.toast.error(t('common.copy_failed'))
                      }
                    }}
                  />
                </div>
              }
              type="error"
              closable
              onClose={() => setError(null)}
              className="rounded-lg!"
            />
          </div>
        )}

        {gatewayStatus !== 'running' && renderConnectionSection()}

        {gatewayStatus !== 'running' && (
          <div className="mb-6">
            {renderGatewayConfigSection()}

            <div
              className="mt-4 rounded-lg p-3 text-xs leading-relaxed"
              style={{ background: 'var(--color-background-mute)', color: 'var(--color-text-3)' }}>
              <div className="mb-1">💡 {t('openclaw.tips.title')}</div>
              <ul className="list-inside list-disc space-y-1">
                <li>{t('openclaw.tips.permissions')}</li>
                <li>{t('openclaw.tips.token_usage')}</li>
              </ul>
            </div>
          </div>
        )}

        {showLogs && installLogs.length > 0 && renderLogContainer()}

        {gatewayStatus !== 'running' && (
          <Button
            type="primary"
            icon={<Play size={16} />}
            onClick={handleStartGateway}
            loading={isStarting || gatewayStatus === 'starting'}
            disabled={
              isRemoteMode
                ? !remoteUrl.trim() || isStarting || gatewayStatus === 'starting'
                : !selectedProvider ||
                  !selectedModel ||
                  isStarting ||
                  gatewayStatus === 'starting' ||
                  isOpenClawUpdating
            }
            size="large"
            block>
            {t('openclaw.gateway.start')}
          </Button>
        )}
        {gatewayStatus === 'running' && (
          <Button type="primary" onClick={handleOpenDashboard} size="large" block>
            {t('openclaw.quick_actions.open_dashboard')}
          </Button>
        )}
      </div>
    </div>
  )

  const renderCheckingContent = () => (
    <div id="content-container" className="flex flex-1 flex-col items-center justify-center">
      <Spin size="large" />
      <div className="mt-4" style={{ color: 'var(--color-text-3)' }}>
        {t('openclaw.checking_installation')}
      </div>
    </div>
  )

  const renderUninstallingContent = () => (
    <div id="content-container" className="flex flex-1 overflow-y-auto py-5">
      <div className="m-auto min-h-fit w-130">
        <TitleSection
          title={t(uninstallSuccess ? 'openclaw.uninstalled.title' : 'openclaw.uninstalling.title')}
          description={t(uninstallSuccess ? 'openclaw.uninstalled.description' : 'openclaw.uninstalling.description')}
        />

        {installError && (
          <div className="mb-6">
            <Alert
              message={installError}
              type="error"
              closable
              onClose={() => setInstallError(null)}
              className="rounded-lg!"
            />
          </div>
        )}

        {renderLogContainer(true)}

        <Button disabled={!uninstallSuccess} type="primary" onClick={handleUninstallComplete} block size="large">
          {t('common.close')}
        </Button>
      </div>
    </div>
  )

  const renderContent = () => {
    switch (pageState) {
      case 'uninstalling':
        return renderUninstallingContent()
      case 'checking':
        return renderCheckingContent()
      case 'installed':
        return renderInstalledContent()
      case 'not_installed':
      case 'installing':
        return renderNotInstalledContent()
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('openclaw.title')}</NavbarCenter>
      </Navbar>
      <div className="flex flex-1 flex-col">{renderContent()}</div>
    </div>
  )
}

export default OpenClawPage
