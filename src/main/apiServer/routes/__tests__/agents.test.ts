import { EventEmitter } from 'node:events'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const agentSessionServiceMock = vi.hoisted(() => ({
  getSession: vi.fn()
}))

const sessionMessageOrchestratorMock = vi.hoisted(() => ({
  createSessionMessage: vi.fn()
}))

vi.mock('@data/services/AgentService', () => ({
  agentService: {
    reorderAgents: vi.fn()
  }
}))

vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: agentSessionServiceMock
}))

vi.mock('@main/services/agents/services/SessionMessageOrchestrator', () => ({
  sessionMessageOrchestrator: sessionMessageOrchestratorMock
}))

import { handleAgentSessionMessagePost } from '../agents'

class MockResponse extends EventEmitter {
  public statusCode = 200
  public headersSent = false
  public writableEnded = false
  public headers: Record<string, string> = {}
  public chunks: string[] = []
  public jsonBody: unknown

  status(code: number) {
    this.statusCode = code
    return this
  }

  json(body: unknown) {
    this.headersSent = true
    this.jsonBody = body
    this.end()
    return this
  }

  setHeader(name: string, value: string) {
    this.headers[name] = value
    this.headersSent = true
    return this
  }

  flushHeaders() {
    this.headersSent = true
  }

  write(chunk: string) {
    this.headersSent = true
    this.chunks.push(chunk)
    return true
  }

  end() {
    this.writableEnded = true
    return this
  }
}

const makeRequest = (body: Record<string, unknown> = { content: 'hello' }) =>
  ({
    params: {
      agentId: 'agent-1',
      sessionId: 'session-1'
    },
    body
  }) as any

describe('apiServer agent routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('streams session messages through SSE', async () => {
    const session = { id: 'session-1', agentId: 'agent-1', model: 'ollama:qwen3.6:27b' }
    agentSessionServiceMock.getSession.mockResolvedValue(session)
    sessionMessageOrchestratorMock.createSessionMessage.mockResolvedValue({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'text-delta', text: 'hello' })
          controller.close()
        }
      }),
      completion: Promise.resolve({})
    })

    const res = new MockResponse()
    await handleAgentSessionMessagePost(makeRequest(), res as any)

    expect(agentSessionServiceMock.getSession).toHaveBeenCalledWith('agent-1', 'session-1')
    expect(sessionMessageOrchestratorMock.createSessionMessage).toHaveBeenCalledWith(
      session,
      { content: 'hello' },
      expect.any(AbortController),
      { persist: false }
    )
    expect(res.headers['Content-Type']).toBe('text/event-stream; charset=utf-8')
    expect(res.chunks.join('')).toContain('data: {"type":"text-delta","text":"hello"}')
    expect(res.chunks.join('')).toContain('data: [DONE]')
  })

  it('rejects empty content before starting an agent stream', async () => {
    const res = new MockResponse()
    await handleAgentSessionMessagePost(makeRequest({ content: '   ' }), res as any)

    expect(res.statusCode).toBe(400)
    expect(sessionMessageOrchestratorMock.createSessionMessage).not.toHaveBeenCalled()
  })
})
