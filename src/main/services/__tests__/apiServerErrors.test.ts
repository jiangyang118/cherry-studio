import { describe, expect, it } from 'vitest'

import { formatApiServerError } from '../utils/apiServerErrors'

describe('formatApiServerError', () => {
  it('rewrites EADDRINUSE into an actionable Cherry Studio error', () => {
    const error = Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' })

    const result = formatApiServerError(error, { host: '127.0.0.1', port: 23333 })

    expect(result.message).toBe(
      'listen EADDRINUSE: address already in use 127.0.0.1:23333. Another Cherry Studio instance may already be using this port. Stop the other instance or change the API server port in Settings.'
    )
  })

  it('keeps ordinary errors unchanged', () => {
    const error = new Error('boom')

    const result = formatApiServerError(error, { host: '127.0.0.1', port: 23333 })

    expect(result).toBe(error)
  })

  it('converts string errors into Error instances', () => {
    const result = formatApiServerError('boom', { host: '127.0.0.1', port: 23333 })

    expect(result).toBeInstanceOf(Error)
    expect(result.message).toBe('boom')
  })
})
