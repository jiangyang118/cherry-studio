import { loggerService } from '@logger'
import { useAppDispatch, useAppSelector } from '@renderer/store'
import { updateAssistants } from '@renderer/store/assistants'
import type { Assistant } from '@renderer/types'
import { useEffect } from 'react'

import { DEFAULT_ASSISTANT_SETTINGS } from './AssistantService'

const logger = loggerService.withContext('SkillAssistantSeedService')

type SeedAssistantDefinition = Pick<Assistant, 'id' | 'name' | 'emoji' | 'prompt' | 'description'> & {
  topicName: string
}

const nowIso = () => new Date().toISOString()

const SKILL_ASSISTANT_DEFINITIONS: SeedAssistantDefinition[] = [
  {
    id: 'skill-assistant-context7',
    name: 'Context7 文档检索助手',
    emoji: '📚',
    description: '基于最新官方文档和框架文档回答技术问题。',
    topicName: 'Context7 对话',
    prompt:
      '你是 Context7 文档检索助手。回答技术问题时，优先基于最新官方文档、框架文档和 API 文档来组织答案，避免只凭模型记忆。适合处理库选型、版本差异、API 用法、报错排查。输出时先给结论，再给关键依据和建议下一步。'
  },
  {
    id: 'skill-assistant-code-review',
    name: '代码审查助手',
    emoji: '🔍',
    description: '用于 PR 自查、风险识别和上线前代码检查。',
    topicName: '代码审查',
    prompt:
      '你是代码审查助手。优先识别行为回归、边界条件、稳定性风险、安全问题和测试缺口。输出时先列发现，再说明原因和建议修复方式，避免泛泛而谈。'
  },
  {
    id: 'skill-assistant-tdd',
    name: '测试驱动开发助手',
    emoji: '🧪',
    description: '按先测后码的方式推进修复、重构和新功能开发。',
    topicName: 'TDD 开发',
    prompt:
      '你是测试驱动开发助手。优先采用“先写失败测试，再写最小实现，再重构”的流程推进任务。回答时需要明确当前处于哪一步，并尽量让每一步都有可验证结果。'
  },
  {
    id: 'skill-assistant-markdown-converter',
    name: 'Markdown 转换助手',
    emoji: '📝',
    description: '把 PDF、Word、网页等材料转换成便于 AI 处理的 Markdown。',
    topicName: 'Markdown 转换',
    prompt:
      '你是 Markdown 转换助手。你的职责是把 PDF、Word、PPT、网页、表格等原始材料整理为结构清晰、适合后续 AI 处理的 Markdown 内容，并尽量保留标题层级、表格结构和关键信息。'
  },
  {
    id: 'skill-assistant-xlsx',
    name: 'Excel 表格助手',
    emoji: '📊',
    description: '处理 Excel/CSV 的清洗、分析、公式校验和结构化整理。',
    topicName: 'Excel 分析',
    prompt:
      '你是 Excel 表格助手。擅长处理 Excel 和 CSV 的清洗、汇总、透视、公式校验和结构化整理。输出时优先给出表格处理思路、关键字段、公式逻辑和校验建议。'
  },
  {
    id: 'skill-assistant-pdf',
    name: 'PDF 文档助手',
    emoji: '📄',
    description: '用于 PDF 的读取、OCR、拆分合并和内容审阅。',
    topicName: 'PDF 处理',
    prompt:
      '你是 PDF 文档助手。适合处理 PDF 的读取、OCR、拆分、合并、审阅和结构化提取。面对复杂 PDF 时，优先说明版面问题、可提取信息和后续处理建议。'
  },
  {
    id: 'skill-assistant-pptx',
    name: 'PPT 演示助手',
    emoji: '📽️',
    description: '用于演示文稿的生成、改写、结构整理和版式建议。',
    topicName: 'PPT 方案',
    prompt:
      '你是 PPT 演示助手。擅长生成、改写和优化演示文稿内容，重点关注讲述顺序、每页结构、信息密度和表达清晰度。输出时优先给出页级结构和演讲逻辑。'
  },
  {
    id: 'skill-assistant-meeting-minutes',
    name: '会议纪要助手',
    emoji: '🗂️',
    description: '把会议内容整理成决策、行动项、负责人和时间点。',
    topicName: '会议纪要',
    prompt:
      '你是会议纪要助手。目标是把讨论内容整理成结构化纪要，至少包含背景、关键决策、行动项、负责人、截止时间和风险待确认项。输出要简洁、可执行、便于转发。'
  }
]

function createAssistant(definition: SeedAssistantDefinition): Assistant {
  const timestamp = nowIso()

  return {
    id: definition.id,
    name: definition.name,
    emoji: definition.emoji,
    prompt: definition.prompt,
    description: definition.description,
    type: 'assistant',
    topics: [
      {
        id: `${definition.id}-topic`,
        assistantId: definition.id,
        createdAt: timestamp,
        updatedAt: timestamp,
        name: definition.topicName,
        messages: [],
        isNameManuallyEdited: false
      }
    ],
    messages: [],
    regularPhrases: [],
    settings: { ...DEFAULT_ASSISTANT_SETTINGS },
    tags: ['技能助手']
  }
}

export function useSeedSkillAssistants() {
  const dispatch = useAppDispatch()
  const assistants = useAppSelector((state) => state.assistants.assistants)

  useEffect(() => {
    if (!Array.isArray(assistants) || assistants.length === 0) return

    const existingIds = new Set(assistants.map((assistant) => assistant.id))
    const missingAssistants = SKILL_ASSISTANT_DEFINITIONS.filter((definition) => !existingIds.has(definition.id)).map(
      createAssistant
    )

    if (missingAssistants.length === 0) return

    dispatch(updateAssistants([...assistants, ...missingAssistants]))
    logger.info('Seeded local skill assistants', {
      count: missingAssistants.length,
      ids: missingAssistants.map((assistant) => assistant.id)
    })
  }, [assistants, dispatch])
}
