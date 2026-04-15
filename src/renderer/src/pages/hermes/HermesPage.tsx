import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { loggerService } from '@renderer/services/LoggerService'
import { Alert, Avatar, Button, Card, Descriptions, Result, Space, Spin, Tag, Typography } from 'antd'
import { Bot, ExternalLink, FolderOpen, Play, RefreshCw, Settings, Square, Stethoscope, Terminal } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import HermesKnowledgePackSection from './HermesKnowledgePackSection'

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

type HermesCommandId = 'statusDeep' | 'doctor' | 'sessionsList' | 'logsErrors' | 'logsGateway'
type HermesTerminalActionId = 'chat' | 'setup' | 'gatewaySetup' | 'model' | 'skills' | 'sessionsBrowse'

interface HermesCommandResult {
  success: boolean
  id: HermesCommandId
  label: string
  command: string
  exitCode: number | null
  stdout: string
  stderr: string
  durationMs: number
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
  const [runningCommand, setRunningCommand] = useState<HermesCommandId | null>(null)
  const [launchingAction, setLaunchingAction] = useState<HermesTerminalActionId | null>(null)
  const [commandResult, setCommandResult] = useState<HermesCommandResult | null>(null)

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

  const runCommand = useCallback(async (id: HermesCommandId) => {
    setRunningCommand(id)
    try {
      const result = await window.api.hermes.runCommand(id)
      setCommandResult(result)
    } catch (err) {
      logger.error('Failed to run Hermes command', err as Error)
      setCommandResult({
        success: false,
        id,
        label: id,
        command: id,
        exitCode: null,
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
        durationMs: 0
      })
    } finally {
      setRunningCommand(null)
    }
  }, [])

  const openTerminalAction = useCallback(
    async (id: HermesTerminalActionId) => {
      setLaunchingAction(id)
      try {
        const result = await window.api.hermes.openInTerminal(id)
        if (!result.success) {
          setError(result.message || t('hermes.actions.run_in_terminal'))
        }
      } catch (err) {
        logger.error('Failed to open Hermes terminal action', err as Error)
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLaunchingAction(null)
      }
    },
    [t]
  )

  const openChatUi = useCallback(() => {
    void openTerminalAction('chat')
  }, [openTerminalAction])

  const interactiveActions = useMemo(
    () =>
      [
        {
          id: 'chat',
          title: t('hermes.play_modes.chat.title'),
          description: t('hermes.play_modes.chat.description'),
          icon: <Bot size={18} />
        },
        {
          id: 'setup',
          title: t('hermes.play_modes.setup.title'),
          description: t('hermes.play_modes.setup.description'),
          icon: <Settings size={18} />
        },
        {
          id: 'gatewaySetup',
          title: t('hermes.play_modes.gateway_setup.title'),
          description: t('hermes.play_modes.gateway_setup.description'),
          icon: <Play size={18} />
        },
        {
          id: 'model',
          title: t('hermes.play_modes.model.title'),
          description: t('hermes.play_modes.model.description'),
          icon: <RefreshCw size={18} />
        },
        {
          id: 'skills',
          title: t('hermes.play_modes.skills.title'),
          description: t('hermes.play_modes.skills.description'),
          icon: <Terminal size={18} />
        },
        {
          id: 'sessionsBrowse',
          title: t('hermes.play_modes.sessions.title'),
          description: t('hermes.play_modes.sessions.description'),
          icon: <FolderOpen size={18} />
        }
      ] satisfies Array<{ id: HermesTerminalActionId; title: string; description: string; icon: ReactNode }>,
    [t]
  )

  const inspectActions = useMemo(
    () =>
      [
        { id: 'statusDeep', label: t('hermes.diagnostics.status_deep') },
        { id: 'doctor', label: t('hermes.diagnostics.doctor') },
        { id: 'sessionsList', label: t('hermes.diagnostics.sessions') },
        { id: 'logsErrors', label: t('hermes.diagnostics.errors_log') },
        { id: 'logsGateway', label: t('hermes.diagnostics.gateway_log') }
      ] satisfies Array<{ id: HermesCommandId; label: string }>,
    [t]
  )

  const playbookCards = useMemo(
    () => [
      {
        key: 'quick_start',
        title: t('hermes.playbooks.quick_start.title'),
        summary: t('hermes.playbooks.quick_start.summary'),
        steps: [
          t('hermes.playbooks.quick_start.step1'),
          t('hermes.playbooks.quick_start.step2'),
          t('hermes.playbooks.quick_start.step3')
        ]
      },
      {
        key: 'model_setup',
        title: t('hermes.playbooks.model_setup.title'),
        summary: t('hermes.playbooks.model_setup.summary'),
        steps: [
          t('hermes.playbooks.model_setup.step1'),
          t('hermes.playbooks.model_setup.step2'),
          t('hermes.playbooks.model_setup.step3')
        ]
      },
      {
        key: 'gateway_onboarding',
        title: t('hermes.playbooks.gateway_onboarding.title'),
        summary: t('hermes.playbooks.gateway_onboarding.summary'),
        steps: [
          t('hermes.playbooks.gateway_onboarding.step1'),
          t('hermes.playbooks.gateway_onboarding.step2'),
          t('hermes.playbooks.gateway_onboarding.step3')
        ]
      },
      {
        key: 'skills_and_sessions',
        title: t('hermes.playbooks.skills_and_sessions.title'),
        summary: t('hermes.playbooks.skills_and_sessions.summary'),
        steps: [
          t('hermes.playbooks.skills_and_sessions.step1'),
          t('hermes.playbooks.skills_and_sessions.step2'),
          t('hermes.playbooks.skills_and_sessions.step3')
        ]
      }
    ],
    [t]
  )

  useEffect(() => {
    if (pageState === 'ready' && !commandResult && !runningCommand) {
      void runCommand('statusDeep')
    }
  }, [commandResult, pageState, runCommand, runningCommand])

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

            <Descriptions
              title={
                <div className="flex items-center justify-between gap-3">
                  <span>{t('hermes.sections.platforms')}</span>
                  <Button
                    size="small"
                    icon={<Bot size={14} />}
                    loading={launchingAction === 'chat'}
                    onClick={openChatUi}>
                    {t('hermes.play_modes.chat.title')}
                  </Button>
                </div>
              }
              column={1}
              bordered
              size="small">
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
                <Button
                  type="primary"
                  icon={<Bot size={16} />}
                  loading={launchingAction === 'chat'}
                  onClick={openChatUi}>
                  {t('hermes.play_modes.chat.title')}
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

            <div>
              <div className="mb-2 font-medium text-sm" style={{ color: 'var(--color-text-1)' }}>
                {t('hermes.sections.play_modes')}
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {interactiveActions.map((action) => (
                  <Card key={action.id} size="small">
                    <div className="flex h-full flex-col gap-3">
                      <div
                        className="flex items-center gap-2 font-medium text-sm"
                        style={{ color: 'var(--color-text-1)' }}>
                        {action.icon}
                        <span>{action.title}</span>
                      </div>
                      <div className="min-h-[48px] text-sm" style={{ color: 'var(--color-text-2)' }}>
                        {action.description}
                      </div>
                      <Button
                        icon={<Terminal size={16} />}
                        loading={launchingAction === action.id}
                        onClick={() => void openTerminalAction(action.id)}>
                        {t('hermes.actions.run_in_terminal')}
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 font-medium text-sm" style={{ color: 'var(--color-text-1)' }}>
                {t('hermes.sections.playbooks')}
              </div>
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {playbookCards.map((card) => (
                  <Card key={card.key} size="small" title={card.title}>
                    <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
                      {card.summary}
                    </Typography.Paragraph>
                    <ol className="mb-0 pl-5 text-sm leading-7" style={{ color: 'var(--color-text-1)' }}>
                      {card.steps.map((step, index) => (
                        <li key={index}>{step}</li>
                      ))}
                    </ol>
                  </Card>
                ))}
              </div>
            </div>

            <HermesKnowledgePackSection />

            <div>
              <div className="mb-2 font-medium text-sm" style={{ color: 'var(--color-text-1)' }}>
                {t('hermes.sections.diagnostics')}
              </div>
              <Space wrap>
                {inspectActions.map((action) => (
                  <Button
                    key={action.id}
                    icon={<Stethoscope size={16} />}
                    loading={runningCommand === action.id}
                    onClick={() => void runCommand(action.id)}>
                    {action.label}
                  </Button>
                ))}
              </Space>
            </div>

            <Card size="small" title={t('hermes.sections.output')}>
              {commandResult ? (
                <div className="flex flex-col gap-3">
                  <Space wrap>
                    <Tag color={commandResult.success ? 'success' : 'error'}>{commandResult.label}</Tag>
                    <Tag>{`${t('hermes.output.duration')}: ${commandResult.durationMs}ms`}</Tag>
                    <Tag>{`${t('hermes.output.exit_code')}: ${commandResult.exitCode ?? 'null'}`}</Tag>
                  </Space>
                  <Typography.Text copyable={{ text: commandResult.command }} code>
                    {commandResult.command}
                  </Typography.Text>
                  {commandResult.stdout && (
                    <div>
                      <div className="mb-1 font-medium text-xs" style={{ color: 'var(--color-text-2)' }}>
                        {t('hermes.output.stdout')}
                      </div>
                      <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--color-background-soft)] p-3 text-xs">
                        {commandResult.stdout}
                      </pre>
                    </div>
                  )}
                  {commandResult.stderr && (
                    <div>
                      <div className="mb-1 font-medium text-xs" style={{ color: 'var(--color-text-2)' }}>
                        {t('hermes.output.stderr')}
                      </div>
                      <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--color-background-soft)] p-3 text-xs">
                        {commandResult.stderr}
                      </pre>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-sm" style={{ color: 'var(--color-text-2)' }}>
                  {t('hermes.output.empty')}
                </div>
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}

export default HermesPage
