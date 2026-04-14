type ApiServerEndpoint = {
  host: string
  port: number
}

type ErrorWithCode = Error & {
  code?: string
}

export function formatApiServerError(error: unknown, endpoint: ApiServerEndpoint): Error {
  if ((error as ErrorWithCode | null)?.code === 'EADDRINUSE') {
    return new Error(
      `listen EADDRINUSE: address already in use ${endpoint.host}:${endpoint.port}. Another Cherry Studio instance may already be using this port. Stop the other instance or change the API server port in Settings.`
    )
  }

  if (error instanceof Error) {
    return error
  }

  if (typeof error === 'string' && error.trim()) {
    return new Error(error)
  }

  return new Error('Unknown error')
}
