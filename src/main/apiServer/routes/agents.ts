import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { loggerService } from '@logger'
import { sessionMessageOrchestrator } from '@main/services/agents/services/SessionMessageOrchestrator'
import type { GetAgentSessionResponse } from '@types'
import type { TextStreamPart } from 'ai'
import type { Request, Response } from 'express'
import express from 'express'

const logger = loggerService.withContext('ApiServerAgentRoutes')
const router = express.Router()

const parseOrderedIds = (value: unknown): string[] | null => {
  if (!Array.isArray(value)) return null
  if (value.length === 0) return null
  if (!value.every((id) => typeof id === 'string' && id.length > 0)) return null
  return value
}

const invalidOrderedIds = (res: Response, resource: 'agent' | 'session') =>
  res.status(400).json({
    success: false,
    error: {
      message: `ordered_ids must be a non-empty array of ${resource} IDs`,
      type: 'invalid_request',
      code: 'invalid_ordered_ids'
    }
  })

const sendAgentRouteError = (res: Response, status: number, message: string, code: string) => {
  if (res.headersSent) {
    res.write(`data: ${JSON.stringify({ type: 'error', error: { message, code } })}\n\n`)
    res.end()
    return
  }

  res.status(status).json({
    success: false,
    error: {
      message,
      type: status >= 500 ? 'server_error' : 'invalid_request',
      code
    }
  })
}

async function writeStreamAsSSE(
  stream: ReadableStream<TextStreamPart<Record<string, any>>>,
  res: Response
): Promise<void> {
  const reader = stream.getReader()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(`data: ${JSON.stringify(value)}\n\n`)
    }

    res.write('data: [DONE]\n\n')
    res.end()
  } finally {
    reader.releaseLock()
  }
}

export async function handleAgentSessionMessagePost(req: Request, res: Response) {
  const { agentId, sessionId } = req.params
  const content = typeof req.body?.content === 'string' ? req.body.content : ''

  if (!content.trim()) {
    sendAgentRouteError(res, 400, 'content must be a non-empty string', 'invalid_content')
    return
  }

  const session = (await agentSessionService.getSession(agentId, sessionId)) as GetAgentSessionResponse | null
  if (!session) {
    sendAgentRouteError(res, 404, `Session ${sessionId} not found`, 'session_not_found')
    return
  }

  const abortController = new AbortController()
  res.on('close', () => {
    if (!res.writableEnded) {
      abortController.abort('client disconnected')
    }
  })

  try {
    const { stream, completion } = await sessionMessageOrchestrator.createSessionMessage(
      session,
      {
        content,
        ...(req.body?.effort ? { effort: req.body.effort } : {}),
        ...(req.body?.thinking ? { thinking: req.body.thinking } : {})
      },
      abortController,
      { persist: false }
    )

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders?.()

    await writeStreamAsSSE(stream, res)
    await completion
  } catch (error) {
    logger.error('Failed to stream agent session message through legacy HTTP route', error as Error)
    const message = error instanceof Error ? error.message : 'Failed to stream agent session message'
    sendAgentRouteError(res, 500, message, 'agent_message_stream_failed')
  }
}

router.put('/reorder', async (req: Request, res: Response) => {
  try {
    const orderedIds = parseOrderedIds(req.body?.ordered_ids)
    if (!orderedIds) return invalidOrderedIds(res, 'agent')

    await agentService.reorderAgents(orderedIds)
    logger.info('Agents reordered through legacy HTTP route', { count: orderedIds.length })
    return res.json({ success: true })
  } catch (error) {
    logger.error('Failed to reorder agents through legacy HTTP route', error as Error)
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to reorder agents', type: 'server_error', code: 'reorder_failed' }
    })
  }
})

router.post('/:agentId/sessions/:sessionId/messages', handleAgentSessionMessagePost)

router.put('/:agentId/sessions/reorder', async (req: Request, res: Response) => {
  try {
    const { agentId } = req.params
    const orderedIds = parseOrderedIds(req.body?.ordered_ids)
    if (!orderedIds) return invalidOrderedIds(res, 'session')

    await agentSessionService.reorderSessions(agentId, orderedIds)
    logger.info('Sessions reordered through legacy HTTP route', { agentId, count: orderedIds.length })
    return res.json({ success: true })
  } catch (error) {
    logger.error('Failed to reorder sessions through legacy HTTP route', error as Error)
    return res.status(500).json({
      success: false,
      error: { message: 'Failed to reorder sessions', type: 'server_error', code: 'reorder_failed' }
    })
  }
})

export const agentRoutes = router
