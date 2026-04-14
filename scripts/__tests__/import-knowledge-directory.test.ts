import { describe, expect, it } from 'vitest'

import { parseApiServerConfigLines, parseCliArgs } from '../import-knowledge-directory'

describe('import-knowledge-directory', () => {
  describe('parseCliArgs', () => {
    it('parses required name-based import arguments', () => {
      const options = parseCliArgs([
        '--directory',
        '/tmp/vault',
        '--knowledge-base',
        '测试知识库',
        '--cdp-port',
        '9223'
      ])

      expect(options.directory).toBe('/tmp/vault')
      expect(options.knowledgeBaseName).toBe('测试知识库')
      expect(options.cdpPort).toBe(9223)
    })

    it('accepts knowledge base id as an alternative selector', () => {
      const options = parseCliArgs([
        '--directory',
        '/tmp/vault',
        '--knowledge-base-id',
        'kb-123',
        '--api-key',
        'secret'
      ])

      expect(options.knowledgeBaseId).toBe('kb-123')
      expect(options.apiKey).toBe('secret')
    })
  })

  describe('parseApiServerConfigLines', () => {
    it('prefers the latest enabled config entry', () => {
      const config = parseApiServerConfigLines([
        JSON.stringify({
          message: 'API server config:',
          apiKey: 'old-key',
          enabled: false,
          host: '127.0.0.1',
          port: 23333,
          timestamp: '2026-04-13 10:00:00'
        }),
        JSON.stringify({
          message: 'API server config:',
          apiKey: 'new-key',
          enabled: true,
          host: '127.0.0.1',
          port: 23333,
          timestamp: '2026-04-13 11:00:00'
        })
      ])

      expect(config).toEqual({
        apiKey: 'new-key',
        enabled: true,
        host: '127.0.0.1',
        port: 23333,
        timestamp: '2026-04-13 11:00:00'
      })
    })

    it('returns null when no config entries exist', () => {
      expect(parseApiServerConfigLines(['noise', '{"message":"other"}'])).toBeNull()
    })
  })
})
