import { isEmbeddingModel } from '@renderer/config/models'
import { useAgents } from '@renderer/hooks/agents/useAgents'
import { useCreateTask, useTasks, useUpdateTask } from '@renderer/hooks/agents/useTasks'
import { useApiServer } from '@renderer/hooks/useApiServer'
import { useAssistantPresets } from '@renderer/hooks/useAssistantPresets'
import { useKnowledgeBases } from '@renderer/hooks/useKnowledge'
import { useProviders } from '@renderer/hooks/useProvider'
import KnowledgeQueue from '@renderer/queue/KnowledgeQueue'
import { getDefaultModel } from '@renderer/services/AssistantService'
import { getKnowledgeBaseParams } from '@renderer/services/KnowledgeService'
import { useAppDispatch } from '@renderer/store'
import { addItemThunk } from '@renderer/store/thunk/knowledgeThunk'
import type { AgentConfiguration, Assistant, AssistantPreset, KnowledgeBase, Model } from '@renderer/types'
import { Button, Card, Space, Tag, Typography } from 'antd'
import { BookCopy, Bot, Clock3, FolderOpen, Hammer, RefreshCw } from 'lucide-react'
import { nanoid } from 'nanoid'
import { type FC, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const HERMES_PLAYBOOKS_KB_NAME = 'Hermes Agent Playbooks'
const HERMES_PLAYBOOKS_TAG = 'hermes-playbooks-planner'
const HERMES_DAILY_BRIEFING_TASK = 'Hermes Playbooks Daily Briefing'
const HERMES_CRON_HOOKS_TASK = 'Hermes Playbooks Cron Hooks Audit'
const DEFAULT_TASK_AGENT_ID = 'cherry-claw-default'
const HERMES_PLAYBOOKS_DIR = '/Users/jack/Library/Application Support/CherryStudio/Data/Files/hermes-agent-playbooks'
const HERMES_PLAYBOOKS_BUNDLE_FILE = `${HERMES_PLAYBOOKS_DIR}/HERMES_AGENT_PLAYBOOKS_BUNDLE.md`
const KNOWLEDGE_ROUTE = '/knowledge'
const STORE_ROUTE = '/store'
const TASKS_ROUTE = '/settings/scheduled-tasks'

const createKnowledgeBaseDraft = (model: Model): KnowledgeBase => ({
  id: nanoid(),
  name: HERMES_PLAYBOOKS_KB_NAME,
  model,
  description: 'Hermes Agent playbooks bundle and synced markdown sources for Cherry Studio planning.',
  items: [],
  created_at: Date.now(),
  updated_at: Date.now(),
  version: 1
})

const plannerPrompt = `You are a Cherry Studio feature planner focused on Hermes Agent usage patterns.

Use the attached "Hermes Agent Playbooks" knowledge base as the primary source of truth.

When the user asks for an idea, recommendation, or design:
1. Map the request to the closest Hermes playbook theme.
2. Explain why that theme fits.
3. Translate it into Cherry Studio product capabilities, flows, and implementation slices.
4. Call out assumptions, risks, and missing dependencies.
5. Prefer concrete, reviewable output over brainstorming.

If the request is vague, narrow it by comparing these themes first:
- Daily Briefing Bot
- Team Assistant
- Cron + Hooks
- Delegation
- Memory + Skills
`

const dailyBriefingPrompt = `Use the "Hermes Agent Playbooks" knowledge pack as reference and produce one reviewable Cherry Studio feature concept inspired by the Daily Briefing Bot playbook.

Return:
1. Playbook insight
2. Cherry Studio feature proposal
3. User flow
4. Implementation notes
5. Risks

Keep it concise and actionable.`

const cronHooksPrompt = `Use the "Hermes Agent Playbooks" knowledge pack as reference and review how Cherry Studio could better support Cron + Hooks style automation.

Return:
1. Playbook insight
2. Automation scenario
3. Required product or technical changes
4. Suggested rollout order
5. Risks

Focus on pragmatic productization, not generic theory.`

const outputMethodsDraftPrompt = `基于 Hermes Agent Playbooks 知识包，帮我输出一份“玩法方法清单”。

要求：
1. 先按主题归类玩法
2. 每种玩法写清楚适用场景、核心步骤、在 Cherry Studio 里的落点
3. 标出哪些适合先做，哪些适合后做
4. 输出成可 review 的结构化清单
`

type BundleAvailability = {
  checking: boolean
  hasDirectory: boolean
  hasBundleFile: boolean
}

type ActionState = {
  importingKnowledge: boolean
  creatingPreset: boolean
  creatingDailyTask: boolean
  creatingCronHooksTask: boolean
  openingPlanner: boolean
}

const HermesKnowledgePackSection: FC = () => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const { providers } = useProviders()
  const { bases, addKnowledgeBase } = useKnowledgeBases()
  const { presets, addAssistantPreset } = useAssistantPresets()
  const { tasks } = useTasks()
  const { agents } = useAgents()
  const { createTask } = useCreateTask()
  const { updateTask } = useUpdateTask()
  const { apiServerRunning } = useApiServer()

  const [bundleAvailability, setBundleAvailability] = useState<BundleAvailability>({
    checking: true,
    hasDirectory: false,
    hasBundleFile: false
  })
  const [actionState, setActionState] = useState<ActionState>({
    importingKnowledge: false,
    creatingPreset: false,
    creatingDailyTask: false,
    creatingCronHooksTask: false,
    openingPlanner: false
  })

  const embeddingModel = useMemo(
    () => providers.flatMap((provider) => provider.models).find((model) => isEmbeddingModel(model)),
    [providers]
  )

  const knowledgeBase = useMemo(
    () =>
      bases.find(
        (base) =>
          base.name === HERMES_PLAYBOOKS_KB_NAME ||
          base.items.some((item) => item.type === 'directory' && item.content === HERMES_PLAYBOOKS_DIR)
      ),
    [bases]
  )

  const importedDirectoryItem = useMemo(
    () => knowledgeBase?.items.find((item) => item.type === 'directory' && item.content === HERMES_PLAYBOOKS_DIR),
    [knowledgeBase]
  )

  const plannerPreset = useMemo(() => presets.find((preset) => preset.tags?.includes(HERMES_PLAYBOOKS_TAG)), [presets])

  const dailyTask = useMemo(() => tasks.find((task) => task.name === HERMES_DAILY_BRIEFING_TASK), [tasks])
  const cronHooksTask = useMemo(() => tasks.find((task) => task.name === HERMES_CRON_HOOKS_TASK), [tasks])

  const taskAgent = useMemo(
    () =>
      agents?.find((agent) => agent.id === DEFAULT_TASK_AGENT_ID) ||
      agents?.find((agent) => {
        const config = (agent.configuration ?? {}) as AgentConfiguration
        return config.soul_enabled === true || config.permission_mode === 'bypassPermissions'
      }),
    [agents]
  )

  const refreshBundleAvailability = useCallback(async () => {
    setBundleAvailability((prev) => ({ ...prev, checking: true }))
    const [directoryResult, fileResult] = await Promise.allSettled([
      window.api.file.isDirectory(HERMES_PLAYBOOKS_DIR),
      window.api.fs.readText(HERMES_PLAYBOOKS_BUNDLE_FILE)
    ])

    setBundleAvailability({
      checking: false,
      hasDirectory: directoryResult.status === 'fulfilled' ? directoryResult.value : false,
      hasBundleFile: fileResult.status === 'fulfilled'
    })
  }, [])

  useEffect(() => {
    void refreshBundleAvailability()
  }, [refreshBundleAvailability])

  const navigateTo = useCallback((path: string) => {
    if (typeof window.navigate === 'function') {
      window.navigate(path)
    }
  }, [])

  const navigateToPlanner = useCallback((assistant: Assistant, draftPrompt?: string) => {
    if (typeof window.navigate === 'function') {
      window.navigate('/', { state: { assistant, draftPrompt } })
    }
  }, [])

  const ensureKnowledgeBaseImported = useCallback(async (): Promise<KnowledgeBase | undefined> => {
    if (!bundleAvailability.hasDirectory || !bundleAvailability.hasBundleFile) {
      window.toast.error(t('hermes.bundle.errors.bundleMissing'))
      return
    }

    let targetBase = knowledgeBase

    if (!targetBase) {
      if (!embeddingModel) {
        window.toast.error(t('hermes.bundle.errors.embeddingModelMissing'))
        return
      }
      const draft = createKnowledgeBaseDraft(embeddingModel)
      await window.api.knowledgeBase.create(getKnowledgeBaseParams(draft))
      addKnowledgeBase(draft)
      targetBase = draft
    }

    const alreadyImported = targetBase.items.some(
      (item) => item.type === 'directory' && item.content === HERMES_PLAYBOOKS_DIR
    )

    if (!alreadyImported) {
      dispatch(addItemThunk(targetBase.id, 'directory', HERMES_PLAYBOOKS_DIR))
      await KnowledgeQueue.checkAllBases()
    }

    return targetBase
  }, [
    addKnowledgeBase,
    bundleAvailability.hasBundleFile,
    bundleAvailability.hasDirectory,
    dispatch,
    embeddingModel,
    knowledgeBase,
    t
  ])

  const handleImportKnowledge = useCallback(async () => {
    setActionState((prev) => ({ ...prev, importingKnowledge: true }))
    try {
      const targetBase = await ensureKnowledgeBaseImported()
      if (!targetBase) return
      window.toast.success(t('hermes.bundle.messages.knowledgeReady'))
      navigateTo(KNOWLEDGE_ROUTE)
    } catch (error) {
      window.toast.error(error instanceof Error ? error.message : t('hermes.bundle.errors.importFailed'))
    } finally {
      setActionState((prev) => ({ ...prev, importingKnowledge: false }))
    }
  }, [ensureKnowledgeBaseImported, navigateTo, t])

  const ensurePlannerPreset = useCallback(async (): Promise<AssistantPreset | undefined> => {
    if (plannerPreset) {
      return plannerPreset
    }

    const targetBase = await ensureKnowledgeBaseImported()
    if (!targetBase) return

    const preset: AssistantPreset = {
      id: nanoid(),
      name: t('hermes.bundle.planner.name'),
      prompt: plannerPrompt,
      knowledge_bases: [targetBase],
      topics: [],
      type: 'agent',
      messages: [],
      defaultModel: getDefaultModel(),
      knowledgeRecognition: 'on',
      tags: [HERMES_PLAYBOOKS_TAG, 'hermes']
    }

    addAssistantPreset(preset)
    return preset
  }, [addAssistantPreset, ensureKnowledgeBaseImported, plannerPreset, t])

  const handleCreatePlannerPreset = useCallback(async () => {
    setActionState((prev) => ({ ...prev, creatingPreset: true }))
    try {
      const preset = await ensurePlannerPreset()
      if (!preset) return

      if (plannerPreset) {
        window.toast.warning(t('hermes.bundle.messages.presetExists'))
      } else {
        window.toast.success(t('hermes.bundle.messages.presetCreated'))
      }
      navigateTo(STORE_ROUTE)
    } catch (error) {
      window.toast.error(error instanceof Error ? error.message : t('hermes.bundle.errors.presetFailed'))
    } finally {
      setActionState((prev) => ({ ...prev, creatingPreset: false }))
    }
  }, [ensurePlannerPreset, navigateTo, plannerPreset, t])

  const handleOpenPlanner = useCallback(async () => {
    setActionState((prev) => ({ ...prev, openingPlanner: true }))
    try {
      const preset = await ensurePlannerPreset()
      if (!preset) return
      navigateToPlanner(preset, outputMethodsDraftPrompt)
    } catch (error) {
      window.toast.error(error instanceof Error ? error.message : t('hermes.bundle.errors.presetFailed'))
    } finally {
      setActionState((prev) => ({ ...prev, openingPlanner: false }))
    }
  }, [ensurePlannerPreset, navigateToPlanner, t])

  const createPausedTaskTemplate = useCallback(
    async (taskName: string, prompt: string, scheduleValue: string) => {
      if (!apiServerRunning) {
        window.toast.error(t('hermes.bundle.errors.apiServerRequired'))
        return
      }

      if (!taskAgent) {
        window.toast.error(t('hermes.bundle.errors.taskAgentMissing'))
        return
      }

      const existingTask = tasks.find((task) => task.name === taskName)
      if (existingTask) {
        window.toast.warning(t('hermes.bundle.messages.taskExists', { name: taskName }))
        navigateTo(TASKS_ROUTE)
        return
      }

      const created = await createTask(taskAgent.id, {
        name: taskName,
        prompt,
        schedule_type: 'cron',
        schedule_value: scheduleValue,
        timeout_minutes: 15
      })

      if (!created) return
      await updateTask(created.id, { status: 'paused' })
      navigateTo(TASKS_ROUTE)
    },
    [apiServerRunning, createTask, navigateTo, taskAgent, tasks, t, updateTask]
  )

  const handleCreateDailyTask = useCallback(async () => {
    setActionState((prev) => ({ ...prev, creatingDailyTask: true }))
    try {
      await createPausedTaskTemplate(HERMES_DAILY_BRIEFING_TASK, dailyBriefingPrompt, '0 9 * * 1')
    } finally {
      setActionState((prev) => ({ ...prev, creatingDailyTask: false }))
    }
  }, [createPausedTaskTemplate])

  const handleCreateCronHooksTask = useCallback(async () => {
    setActionState((prev) => ({ ...prev, creatingCronHooksTask: true }))
    try {
      await createPausedTaskTemplate(HERMES_CRON_HOOKS_TASK, cronHooksPrompt, '0 10 * * 3')
    } finally {
      setActionState((prev) => ({ ...prev, creatingCronHooksTask: false }))
    }
  }, [createPausedTaskTemplate])

  const importStatusTag = useMemo(() => {
    if (bundleAvailability.checking) {
      return <Tag>{t('hermes.bundle.status.checking')}</Tag>
    }
    if (!bundleAvailability.hasDirectory || !bundleAvailability.hasBundleFile) {
      return <Tag color="error">{t('hermes.bundle.status.missing')}</Tag>
    }
    if (!importedDirectoryItem) {
      return <Tag color="default">{t('hermes.bundle.status.notImported')}</Tag>
    }

    switch (importedDirectoryItem.processingStatus) {
      case 'processing':
      case 'pending':
        return <Tag color="processing">{t('hermes.bundle.status.importing')}</Tag>
      case 'failed':
        return <Tag color="error">{t('hermes.bundle.status.failed')}</Tag>
      default:
        return <Tag color="success">{t('hermes.bundle.status.ready')}</Tag>
    }
  }, [bundleAvailability, importedDirectoryItem, t])

  return (
    <div>
      <div className="mb-2 font-medium text-sm" style={{ color: 'var(--color-text-1)' }}>
        {t('hermes.bundle.sectionTitle')}
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <Card
          size="small"
          title={
            <Space>
              <BookCopy size={16} />
              {t('hermes.bundle.cards.knowledge.title')}
            </Space>
          }>
          <Typography.Paragraph type="secondary">{t('hermes.bundle.cards.knowledge.summary')}</Typography.Paragraph>
          <Space wrap style={{ marginBottom: 12 }}>
            {importStatusTag}
            {knowledgeBase && <Tag color="blue">{knowledgeBase.name}</Tag>}
          </Space>
          <Typography.Paragraph code ellipsis={{ tooltip: HERMES_PLAYBOOKS_BUNDLE_FILE }}>
            {HERMES_PLAYBOOKS_BUNDLE_FILE}
          </Typography.Paragraph>
          <Space wrap>
            <Button
              type="primary"
              loading={actionState.importingKnowledge}
              onClick={() => void handleImportKnowledge()}>
              {t('hermes.bundle.actions.importKnowledge')}
            </Button>
            <Button icon={<FolderOpen size={16} />} onClick={() => void window.api.openPath(HERMES_PLAYBOOKS_DIR)}>
              {t('hermes.bundle.actions.openFolder')}
            </Button>
            <Button onClick={() => navigateTo(KNOWLEDGE_ROUTE)}>{t('hermes.bundle.actions.goToKnowledge')}</Button>
            <Button
              icon={<FolderOpen size={16} />}
              onClick={() => void window.api.openPath(HERMES_PLAYBOOKS_BUNDLE_FILE)}>
              {t('hermes.bundle.actions.openBundle')}
            </Button>
          </Space>
        </Card>

        <Card
          size="small"
          title={
            <Space>
              <Bot size={16} />
              {t('hermes.bundle.cards.planner.title')}
            </Space>
          }>
          <Typography.Paragraph type="secondary">{t('hermes.bundle.cards.planner.summary')}</Typography.Paragraph>
          <Space wrap style={{ marginBottom: 12 }}>
            {plannerPreset ? (
              <Tag color="success">{t('hermes.bundle.status.created')}</Tag>
            ) : (
              <Tag>{t('hermes.bundle.status.notCreated')}</Tag>
            )}
            {plannerPreset && <Tag color="blue">{plannerPreset.name}</Tag>}
          </Space>
          <Typography.Paragraph>{t('hermes.bundle.cards.planner.hint')}</Typography.Paragraph>
          <Space wrap>
            <Button
              type="primary"
              loading={actionState.creatingPreset}
              onClick={() => void handleCreatePlannerPreset()}>
              {t('hermes.bundle.actions.createPlanner')}
            </Button>
            <Button loading={actionState.openingPlanner} onClick={() => void handleOpenPlanner()}>
              {t('hermes.bundle.actions.outputMethods')}
            </Button>
            <Button onClick={() => navigateTo(STORE_ROUTE)}>{t('hermes.bundle.actions.goToPlanner')}</Button>
          </Space>
        </Card>

        <Card
          size="small"
          title={
            <Space>
              <Hammer size={16} />
              {t('hermes.bundle.cards.templates.title')}
            </Space>
          }>
          <Typography.Paragraph type="secondary">{t('hermes.bundle.cards.templates.summary')}</Typography.Paragraph>
          <div className="mb-3 flex flex-col gap-2">
            <Space wrap>
              <Typography.Text strong>{t('hermes.bundle.templates.dailyBriefing')}</Typography.Text>
              {dailyTask ? (
                <Tag color="success">{t('hermes.bundle.status.createdPaused')}</Tag>
              ) : (
                <Tag>{t('hermes.bundle.status.notCreated')}</Tag>
              )}
            </Space>
            <Space wrap>
              <Typography.Text strong>{t('hermes.bundle.templates.cronHooks')}</Typography.Text>
              {cronHooksTask ? (
                <Tag color="success">{t('hermes.bundle.status.createdPaused')}</Tag>
              ) : (
                <Tag>{t('hermes.bundle.status.notCreated')}</Tag>
              )}
            </Space>
            {taskAgent ? (
              <Tag color="blue">{t('hermes.bundle.messages.taskAgent', { name: taskAgent.name || taskAgent.id })}</Tag>
            ) : (
              <Tag color="warning">{t('hermes.bundle.errors.taskAgentMissing')}</Tag>
            )}
            {!apiServerRunning && <Tag color="warning">{t('hermes.bundle.errors.apiServerRequired')}</Tag>}
          </div>
          <Typography.Paragraph>{t('hermes.bundle.cards.templates.hint')}</Typography.Paragraph>
          <Space wrap>
            <Button
              icon={<Clock3 size={16} />}
              loading={actionState.creatingDailyTask}
              disabled={!apiServerRunning || !taskAgent}
              onClick={() => void handleCreateDailyTask()}>
              {t('hermes.bundle.actions.createDailyTask')}
            </Button>
            <Button
              icon={<RefreshCw size={16} />}
              loading={actionState.creatingCronHooksTask}
              disabled={!apiServerRunning || !taskAgent}
              onClick={() => void handleCreateCronHooksTask()}>
              {t('hermes.bundle.actions.createCronHooksTask')}
            </Button>
            <Button disabled={!apiServerRunning} onClick={() => navigateTo(TASKS_ROUTE)}>
              {t('hermes.bundle.actions.goToTasks')}
            </Button>
          </Space>
        </Card>
      </div>
    </div>
  )
}

export default HermesKnowledgePackSection
