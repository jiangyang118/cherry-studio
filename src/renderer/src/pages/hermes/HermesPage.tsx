import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { loggerService } from '@renderer/services/LoggerService'
import { Alert, Avatar, Button, Descriptions, Result, Space, Spin, Tag } from 'antd'
import { Bot, ExternalLink, FolderOpen, Play, RefreshCw, Square } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

const logger = loggerService.withContext('HermesPage')

type HermesGatewayStatus = 'stopped' | 'starting' | 'running' | 'error'

interface HermesInstallInfo {
  available: boolean
  repoPath: string
  venvPath: string | null
  cliPath: string | null
  hermesHome: string
  issues: string[]
}

interface HermesPlatformInfo {
  id: string
  name: string
  status: 'connected' | 'disconnected' | 'error'
  errorMessage?: string
}

interface HermesHealthInfo {
  status: 'healthy' | 'unhealthy'
  gatewayState: string | null
  exitReason: string | null
  updatedAt: string | null
  pid: number | null
  platforms: HermesPlatformInfo[]
}

const DEFAULT_DOCS_URL = 'https://hermes-agent.nousresearch.com/docs/'

interface TitleSectionProps {
  title: string
  description: string
  docsUrl: string
}

const TitleSection: FC<TitleSectionProps> = ({ title, description, docsUrl }) => (
  <div className="-mt-20 mb-8 flex flex-col items-center text-center">
    <Avatar
      icon={<Bot size={30} />}
      size={64}
      style={{
        borderRadius: 12,
        background: 'linear-gradient(135deg, #1f2937, #111827)',
        cursor: 'pointer'
      }}
      onClick={() => window.open(docsUrl, '_blank')}
    />
    <h1
      className="mt-3 cursor-pointer font-semibold text-2xl hover:text-(--color-primary)"
      style={{ color: 'var(--color-text-1)' }}
      onClick={() => window.open(docsUrl, '_blank')}>
      {title}
    </h1>
    <p className="mt-3 max-w-[720px] text-sm leading-relaxed" style={{ color: 'var(--color-text-2)' }}>
      {description}
    </p>
  </div>
)

const HermesPage: FC = () => {
  const { t } = useTranslation()

  const [installInfo, setInstallInfo] = useState<HermesInstallInfo | null>(null)
  const [gatewayInfo, setGatewayInfo] = useState<{
    status: HermesGatewayStatus
    mode: string | null
    pid: number | null
    message?: string
  } | null>(null)
  const [healthInfo, setHealthInfo] = useState<HermesHealthInfo | null>(null)
  const [docsUrl, setDocsUrl] = useState(DEFAULT_DOCS_URL)
  const [error, setError] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isStarting, setIsStarting] = useState(false)
  const [isStopping, setIsStopping] = useState(false)

  const checkInstallation = useCallback(async () => {
    try {
      const [nextInstallInfo, nextDocsUrl] = await Promise.all([
        window.api.hermes.checkInstalled(),
        window.api.hermes.getDocsUrl()
      ])
      setInstallInfo(nextInstallInfo)
      setDocsUrl(nextDocsUrl)
    } catch (err) {
      logger.error('Failed to check Hermes install info', err as Error)
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const refreshRuntime = useCallback(async () => {
    setIsRefreshing(true)
    try {
      const [nextGatewayInfo, nextHealthInfo] = await Promise.all([
        window.api.hermes.getStatus(),
        window.api.hermes.checkHealth()
      ])
      setGatewayInfo(nextGatewayInfo)
      setHealthInfo(nextHealthInfo)
      setError(nextGatewayInfo.message || null)
    } catch (err) {
      logger.error('Failed to refresh Hermes runtime info', err as Error)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void checkInstallation()
  }, [checkInstallation])

  useEffect(() => {
    if (installInfo?.available) {
      void refreshRuntime()
    }
  }, [installInfo?.available, refreshRuntime])

  useSWR(
    installInfo?.available ? 'hermes/runtime' : null,
    async () => {
      const [nextGatewayInfo, nextHealthInfo] = await Promise.all([
        window.api.hermes.getStatus(),
        window.api.hermes.checkHealth()
      ])
      setGatewayInfo(nextGatewayInfo)
      setHealthInfo(nextHealthInfo)
      setError(nextGatewayInfo.message || null)
      return { nextGatewayInfo, nextHealthInfo }
    },
    { refreshInterval: 5000, revalidateOnFocus: false }
  )

  const handleStart = useCallback(async () => {
    setIsStarting(true)
    setError(null)
    try {
      const result = await window.api.hermes.startGateway()
      if (!result.success) {
        setError(result.message || t('hermes.actions.start'))
        return
      }
      await refreshRuntime()
    } catch (err) {
      logger.error('Failed to start Hermes gateway', err as Error)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsStarting(false)
    }
  }, [refreshRuntime, t])

  const handleStop = useCallback(async () => {
    setIsStopping(true)
    setError(null)
    try {
      const result = await window.api.hermes.stopGateway()
      if (!result.success) {
        setError(result.message || t('hermes.actions.stop'))
        return
      }
      await refreshRuntime()
    } catch (err) {
      logger.error('Failed to stop Hermes gateway', err as Error)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsStopping(false)
    }
  }, [refreshRuntime, t])

  const modeLabel = useMemo(() => {
    const modeKeyMap = {
      manual: 'hermes.mode.manual',
      service: 'hermes.mode.service',
      unknown: 'hermes.mode.unknown'
    } as const

    const modeKey =
      gatewayInfo?.mode && gatewayInfo.mode in modeKeyMap
        ? modeKeyMap[gatewayInfo.mode as keyof typeof modeKeyMap]
        : null
    return t(modeKey || 'hermes.mode.unknown')
  }, [gatewayInfo?.mode, t])

  const gatewayStatusTag = useMemo(() => {
    switch (gatewayInfo?.status) {
      case 'running':
        return <Tag color="success">{t('openclaw.status.running')}</Tag>
      case 'starting':
        return <Tag color="processing">{t('openclaw.status.starting')}</Tag>
      case 'error':
        return <Tag color="error">{t('openclaw.status.error')}</Tag>
      default:
        return <Tag>{t('openclaw.status.stopped')}</Tag>
    }
  }, [gatewayInfo?.status, t])

  const pageState = useMemo(() => {
    if (installInfo === null) return 'checking'
    if (!installInfo.available) return 'not_available'
    return 'ready'
  }, [installInfo])

  const openRepo = useCallback(() => {
    if (installInfo?.repoPath) {
      void window.api.openPath(installInfo.repoPath)
    }
  }, [installInfo?.repoPath])

  const openHermesHome = useCallback(() => {
    if (installInfo?.hermesHome) {
      void window.api.openPath(installInfo.hermesHome)
    }
  }, [installInfo?.hermesHome])

  return (
    <div className="size-full">
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{t('hermes.title')}</NavbarCenter>
      </Navbar>

      <div className="mx-auto max-w-[920px] px-6 py-10">
        <TitleSection title={t('hermes.title')} description={t('hermes.description')} docsUrl={docsUrl} />

        {pageState === 'checking' && (
          <div className="flex items-center justify-center py-20">
            <Space>
              <Spin />
              <span>{t('hermes.checking_installation')}</span>
            </Space>
          </div>
        )}

        {pageState === 'not_available' && installInfo && (
          <Result
            status="warning"
            title={t('hermes.not_detected.title')}
            subTitle={t('hermes.not_detected.description')}>
            <div className="mx-auto max-w-[720px] text-left">
              <Alert
                type="warning"
                showIcon
                message={t('hermes.fields.issues')}
                description={
                  <ul className="mb-0 pl-5">
                    {installInfo.issues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                }
              />
              <Descriptions className="mt-6" column={1} bordered size="small">
                <Descriptions.Item label={t('hermes.fields.repo_path')}>{installInfo.repoPath}</Descriptions.Item>
                <Descriptions.Item label={t('hermes.fields.hermes_home')}>{installInfo.hermesHome}</Descriptions.Item>
              </Descriptions>
              <Space className="mt-6" wrap>
                <Button icon={<FolderOpen size={16} />} onClick={openRepo}>
                  {t('hermes.actions.open_repo')}
                </Button>
                <Button icon={<ExternalLink size={16} />} onClick={() => void window.api.openWebsite(docsUrl)}>
                  {t('hermes.actions.view_docs')}
                </Button>
                <Button icon={<RefreshCw size={16} />} onClick={() => void checkInstallation()}>
                  {t('hermes.actions.refresh')}
                </Button>
              </Space>
            </div>
          </Result>
        )}

        {pageState === 'ready' && installInfo && gatewayInfo && (
          <div className="flex flex-col gap-4">
            {error && <Alert type="error" showIcon message={error} />}

            <Descriptions title={t('hermes.sections.local_repo')} column={1} bordered size="small">
              <Descriptions.Item label={t('hermes.fields.repo_path')}>{installInfo.repoPath}</Descriptions.Item>
              <Descriptions.Item label={t('hermes.fields.venv_path')}>{installInfo.venvPath || '-'}</Descriptions.Item>
              <Descriptions.Item label={t('hermes.fields.cli_path')}>{installInfo.cliPath || '-'}</Descriptions.Item>
              <Descriptions.Item label={t('hermes.fields.hermes_home')}>{installInfo.hermesHome}</Descriptions.Item>
            </Descriptions>

            <Descriptions title={t('hermes.sections.gateway')} column={1} bordered size="small">
              <Descriptions.Item label={t('openclaw.gateway.status')}>{gatewayStatusTag}</Descriptions.Item>
              <Descriptions.Item label={t('hermes.fields.mode')}>{modeLabel}</Descriptions.Item>
              <Descriptions.Item label={t('hermes.fields.pid')}>{gatewayInfo.pid || '-'}</Descriptions.Item>
              <Descriptions.Item label={t('hermes.fields.gateway_state')}>
                {healthInfo?.gatewayState || '-'}
              </Descriptions.Item>
              <Descriptions.Item label={t('hermes.fields.updated_at')}>
                {healthInfo?.updatedAt || '-'}
              </Descriptions.Item>
              <Descriptions.Item label={t('hermes.fields.exit_reason')}>
                {healthInfo?.exitReason || '-'}
              </Descriptions.Item>
            </Descriptions>

            <Descriptions title={t('hermes.sections.platforms')} column={1} bordered size="small">
              <Descriptions.Item label={t('hermes.fields.platforms')}>
                {healthInfo?.platforms.length ? (
                  <Space wrap>
                    {healthInfo.platforms.map((platform) => (
                      <Tag
                        key={platform.id}
                        color={
                          platform.status === 'connected'
                            ? 'success'
                            : platform.status === 'error'
                              ? 'error'
                              : 'default'
                        }>
                        {platform.name}
                        {platform.errorMessage ? `: ${platform.errorMessage}` : ''}
                      </Tag>
                    ))}
                  </Space>
                ) : (
                  t('hermes.health.no_platforms')
                )}
              </Descriptions.Item>
            </Descriptions>

            <div>
              <div className="mb-2 font-medium text-sm" style={{ color: 'var(--color-text-1)' }}>
                {t('hermes.sections.quick_actions')}
              </div>
              <Space wrap>
                <Button
                  type="primary"
                  icon={<Play size={16} />}
                  loading={isStarting}
                  disabled={gatewayInfo.status === 'running' || isStopping}
                  onClick={() => void handleStart()}>
                  {t('openclaw.gateway.start')}
                </Button>
                <Button
                  icon={<Square size={16} />}
                  loading={isStopping}
                  disabled={gatewayInfo.status !== 'running' || isStarting}
                  onClick={() => void handleStop()}>
                  {t('openclaw.gateway.stop')}
                </Button>
                <Button icon={<RefreshCw size={16} />} loading={isRefreshing} onClick={() => void refreshRuntime()}>
                  {t('hermes.actions.refresh')}
                </Button>
                <Button icon={<FolderOpen size={16} />} onClick={openRepo}>
                  {t('hermes.actions.open_repo')}
                </Button>
                <Button icon={<FolderOpen size={16} />} onClick={openHermesHome}>
                  {t('hermes.actions.open_home')}
                </Button>
                <Button icon={<ExternalLink size={16} />} onClick={() => void window.api.openWebsite(docsUrl)}>
                  {t('hermes.actions.view_docs')}
                </Button>
              </Space>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default HermesPage
