import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import WebSocket from 'ws'

type CliOptions = {
  apiBase: string
  apiKey?: string
  cdpPort: number
  createIfMissing?: boolean
  directory: string
  forceReload?: boolean
  knowledgeBaseId?: string
  knowledgeBaseName?: string
  pollIntervalMs: number
  templateKnowledgeBaseId?: string
  templateKnowledgeBaseName?: string
  timeoutMs: number
}

type ApiServerRuntimeConfig = {
  apiKey: string
  enabled: boolean
  host: string
  port: number
  timestamp?: string
}

type KnowledgeBaseSummary = {
  id: string
  name: string
  items?: KnowledgeBaseItem[]
}

type KnowledgeBaseItem = {
  id: string
  type: string
  content: string
  processingStatus?: string
  processingError?: string
  uniqueId?: string
  uniqueIds?: string[]
}

type CdpPage = {
  title: string
  type: string
  webSocketDebuggerUrl: string
}

type CdpResponseValue = {
  ok: boolean
  skipped?: boolean
  error?: string
  reason?: string
  baseId?: string
  itemId?: string
  result?: {
    status?: string
    message?: string
    uniqueId?: string
    uniqueIds?: string[]
  }
}

const DEFAULT_API_BASE = 'http://127.0.0.1:23333'
const DEFAULT_CDP_PORT = 9223
const DEFAULT_POLL_INTERVAL_MS = 2000
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000

function printHelp(): void {
  console.log(`Usage:
  pnpm tsx scripts/import-knowledge-directory.ts \\
    --directory '/absolute/path' \\
    --knowledge-base '测试知识库' \\
    [--create-if-missing] \\
    [--template-knowledge-base '测试知识库'] \\
    [--force-reload] \\
    [--api-base ${DEFAULT_API_BASE}] \\
    [--api-key <key>] \\
    [--cdp-port ${DEFAULT_CDP_PORT}] \\
    [--poll-interval-ms ${DEFAULT_POLL_INTERVAL_MS}] \\
    [--timeout-ms ${DEFAULT_TIMEOUT_MS}]

Notes:
  - Cherry Studio must be running with a Chromium DevTools port enabled.
  - Example: 'Cherry Studio --remote-debugging-port=${DEFAULT_CDP_PORT}'
  - If --api-key is omitted, the script will try to discover the API server key from local Cherry Studio logs.
`)
}

export function parseCliArgs(argv: string[]): CliOptions {
  const options: Partial<CliOptions> = {
    apiBase: DEFAULT_API_BASE,
    cdpPort: DEFAULT_CDP_PORT,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    timeoutMs: DEFAULT_TIMEOUT_MS
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = argv[i + 1]

    switch (arg) {
      case '--help':
      case '-h':
        printHelp()
        return process.exit(0)
      case '--api-base':
        options.apiBase = next
        i++
        break
      case '--api-key':
        options.apiKey = next
        i++
        break
      case '--cdp-port':
        options.cdpPort = Number(next)
        i++
        break
      case '--directory':
        options.directory = next
        i++
        break
      case '--create-if-missing':
        options.createIfMissing = true
        break
      case '--force-reload':
        options.forceReload = true
        break
      case '--knowledge-base':
        options.knowledgeBaseName = next
        i++
        break
      case '--knowledge-base-id':
        options.knowledgeBaseId = next
        i++
        break
      case '--template-knowledge-base':
        options.templateKnowledgeBaseName = next
        i++
        break
      case '--template-knowledge-base-id':
        options.templateKnowledgeBaseId = next
        i++
        break
      case '--poll-interval-ms':
        options.pollIntervalMs = Number(next)
        i++
        break
      case '--timeout-ms':
        options.timeoutMs = Number(next)
        i++
        break
      default:
        if (arg.startsWith('--')) {
          throw new Error(`Unknown argument: ${arg}`)
        }
    }
  }

  if (!options.directory) {
    throw new Error('Missing required argument: --directory')
  }

  if (!options.knowledgeBaseId && !options.knowledgeBaseName) {
    throw new Error('One of --knowledge-base or --knowledge-base-id is required')
  }

  if (!Number.isFinite(options.cdpPort) || options.cdpPort! <= 0) {
    throw new Error('Invalid --cdp-port')
  }

  if (!Number.isFinite(options.pollIntervalMs) || options.pollIntervalMs! <= 0) {
    throw new Error('Invalid --poll-interval-ms')
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs! <= 0) {
    throw new Error('Invalid --timeout-ms')
  }

  return options as CliOptions
}

export function parseApiServerConfigLines(lines: string[]): ApiServerRuntimeConfig | null {
  const configs = lines.flatMap((line) => {
    try {
      const parsed = JSON.parse(line) as Partial<ApiServerRuntimeConfig> & { message?: string }
      if (parsed.message !== 'API server config:') {
        return []
      }
      if (typeof parsed.apiKey !== 'string' || typeof parsed.host !== 'string' || typeof parsed.port !== 'number') {
        return []
      }
      return [
        {
          apiKey: parsed.apiKey,
          enabled: parsed.enabled === true,
          host: parsed.host,
          port: parsed.port,
          timestamp: parsed.timestamp
        }
      ]
    } catch {
      return []
    }
  })

  if (configs.length === 0) {
    return null
  }

  configs.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''))
  const enabledConfig = [...configs].reverse().find((config) => config.enabled)
  return enabledConfig || configs[configs.length - 1]
}

function discoverApiServerConfig(): ApiServerRuntimeConfig | null {
  const roots = [
    path.join(os.homedir(), 'Library/Application Support/CherryStudio/logs'),
    path.join(os.homedir(), 'Library/Application Support/CherryStudioDev/logs')
  ]

  const files = roots.flatMap((root) => {
    if (!fs.existsSync(root)) {
      return []
    }
    return fs
      .readdirSync(root)
      .filter((entry) => entry.startsWith('app.') && entry.endsWith('.log'))
      .map((entry) => path.join(root, entry))
  })

  const lines = files.flatMap((file) => fs.readFileSync(file, 'utf-8').split('\n'))
  return parseApiServerConfigLines(lines)
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`)
  }
  return (await response.json()) as T
}

async function listKnowledgeBases(apiBase: string, apiKey: string): Promise<KnowledgeBaseSummary[]> {
  const response = await requestJson<{ knowledge_bases: KnowledgeBaseSummary[] }>(`${apiBase}/v1/knowledge-bases`, {
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  })
  return response.knowledge_bases
}

async function getCdpPage(cdpPort: number): Promise<CdpPage> {
  let pages: CdpPage[]
  try {
    pages = await requestJson<CdpPage[]>(`http://127.0.0.1:${cdpPort}/json/list`)
  } catch (error) {
    throw new Error(
      `Cannot reach Cherry Studio CDP on port ${cdpPort}. Start the app with --remote-debugging-port=${cdpPort}.`
    )
  }
  const page = pages.find((item) => item.type === 'page' && item.title === 'Cherry Studio')
  if (!page) {
    throw new Error(
      `Cherry Studio renderer page not found on CDP port ${cdpPort}. Start the app with --remote-debugging-port=${cdpPort}.`
    )
  }
  return page
}

class CdpClient {
  private nextId = 0
  private readonly pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()

  constructor(private readonly ws: WebSocket) {
    ws.on('message', (raw) => {
      const message = JSON.parse(String(raw))
      if (!message.id || !this.pending.has(message.id)) {
        return
      }
      const deferred = this.pending.get(message.id)!
      this.pending.delete(message.id)
      if (message.error) {
        deferred.reject(new Error(JSON.stringify(message.error)))
      } else {
        deferred.resolve(message.result)
      }
    })
  }

  send<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
}

async function createCdpClient(cdpPort: number): Promise<CdpClient> {
  const page = await getCdpPage(cdpPort)
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve())
    ws.once('error', reject)
  })
  const client = new CdpClient(ws)
  await client.send('Runtime.enable')
  return client
}

function buildImportExpression(params: {
  createIfMissing?: boolean
  directory: string
  forceReload?: boolean
  knowledgeBaseId?: string
  knowledgeBaseName?: string
  templateKnowledgeBaseId?: string
  templateKnowledgeBaseName?: string
}): string {
  return `
    (async () => {
      const createIfMissing = ${JSON.stringify(params.createIfMissing === true)};
      const directoryPath = ${JSON.stringify(params.directory)};
      const forceReload = ${JSON.stringify(params.forceReload === true)};
      const knowledgeBaseId = ${JSON.stringify(params.knowledgeBaseId || null)};
      const knowledgeBaseName = ${JSON.stringify(params.knowledgeBaseName || null)};
      const templateKnowledgeBaseId = ${JSON.stringify(params.templateKnowledgeBaseId || null)};
      const templateKnowledgeBaseName = ${JSON.stringify(params.templateKnowledgeBaseName || null)};

      const trimTrailingSlash = (value) => (value || '').replace(/\\/+$/, '');
      const withoutTrailingSharp = (value) => value.endsWith('#') ? value.slice(0, -1) : value;
      const supportedEndpoints = [
        'chat/completions',
        'responses',
        'messages',
        'generateContent',
        'streamGenerateContent',
        'images/generations',
        'images/edits',
        'predict'
      ];

      const routeToEndpoint = (apiHost) => {
        const trimmedHost = (apiHost || '').trim();
        if (!trimmedHost.endsWith('#')) {
          return { baseURL: trimmedHost, endpoint: '' };
        }
        const host = trimmedHost.slice(0, -1);
        const endpoint = supportedEndpoints.find((candidate) => host.endsWith(candidate));
        if (!endpoint) {
          return { baseURL: trimTrailingSlash(host), endpoint: '' };
        }
        const baseSegment = host.slice(0, host.length - endpoint.length);
        return { baseURL: trimTrailingSlash(baseSegment).replace(/:$/, ''), endpoint };
      };

      const getApiKey = (provider) => {
        return (provider.apiKey || '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)[0] || 'secret';
      };

      const buildBaseParams = (base, state) => {
        const provider = state.llm.providers.find((item) => item.id === base.model.provider);
        if (!provider) {
          throw new Error('provider not found: ' + base.model.provider);
        }

        const { baseURL: embedBaseURL } = routeToEndpoint(provider.apiHost || '');
        const baseParams = {
          id: base.id,
          dimensions: base.dimensions,
          chunkSize: base.chunkSize,
          chunkOverlap: base.chunkOverlap,
          documentCount: base.documentCount,
          preprocessProvider: base.preprocessProvider,
          embedApiClient: {
            model: base.model.id,
            provider: base.model.provider,
            apiKey: getApiKey(provider),
            baseURL:
              provider.id === 'gemini'
                ? embedBaseURL + '/openai'
                : provider.id === 'azure-openai'
                  ? embedBaseURL + '/v1'
                  : provider.id === 'ollama'
                    ? embedBaseURL.replace(/\\/api$/, '')
                    : embedBaseURL
          }
        };

        if (base.rerankModel) {
          const rerankProvider = state.llm.providers.find((item) => item.id === base.rerankModel.provider);
          if (rerankProvider) {
            const { baseURL: rerankBaseURL } = routeToEndpoint(rerankProvider.apiHost || '');
            baseParams.rerankApiClient = {
              model: base.rerankModel.id,
              provider: base.rerankModel.provider,
              apiKey: getApiKey(rerankProvider),
              baseURL: rerankBaseURL
            };
          }
        }

        return baseParams;
      };

      const state = window.store.getState();
      let base = state.knowledge.bases.find((item) =>
        knowledgeBaseId ? item.id === knowledgeBaseId : item.name === knowledgeBaseName
      );

      if (!base && createIfMissing) {
        const templateBase = state.knowledge.bases.find((item) =>
          templateKnowledgeBaseId
            ? item.id === templateKnowledgeBaseId
            : templateKnowledgeBaseName
              ? item.name === templateKnowledgeBaseName
              : true
        );

        if (!templateBase) {
          return { ok: false, error: 'template knowledge base not found' };
        }

        const now = Date.now();
        base = {
          ...templateBase,
          id: crypto.randomUUID(),
          name: knowledgeBaseName || templateBase.name,
          items: [],
          created_at: now,
          updated_at: now
        };

        await window.api.knowledgeBase.create(buildBaseParams(base, state));
        window.store.dispatch({ type: 'knowledge/addBase', payload: base });
      }

      if (!base) {
        return { ok: false, error: 'knowledge base not found' };
      }

      const existing = base.items.find((item) => item.type === 'directory' && item.content === directoryPath);
      if (existing) {
        if (!forceReload) {
          return {
            ok: true,
            skipped: true,
            reason: 'directory already exists',
            baseId: base.id,
            itemId: existing.id,
            result: {
              uniqueId: existing.uniqueId,
              uniqueIds: existing.uniqueIds || []
            }
          };
        }

        if (existing.uniqueId || (existing.uniqueIds && existing.uniqueIds.length > 0)) {
          await window.api.knowledgeBase.remove({
            uniqueId: existing.uniqueId || '',
            uniqueIds: existing.uniqueIds || (existing.uniqueId ? [existing.uniqueId] : []),
            base: buildBaseParams(base, state)
          });
        }

        window.store.dispatch({ type: 'knowledge/removeItem', payload: { baseId: base.id, item: existing } });
      }

      if (existing && !forceReload) {
        return {
          ok: true,
          skipped: true,
          reason: 'directory already exists',
          baseId: base.id,
          itemId: existing.id,
          result: {
            uniqueId: existing.uniqueId,
            uniqueIds: existing.uniqueIds || []
          }
        };
      }

      const now = Date.now();
      const item = {
        id: crypto.randomUUID(),
        type: 'directory',
        content: directoryPath,
        created_at: now,
        updated_at: now,
        processingStatus: 'processing',
        processingProgress: 0,
        processingError: '',
        retryCount: 1
      };

      window.store.dispatch({ type: 'knowledge/addItem', payload: { baseId: base.id, item } });

      const result = await window.api.knowledgeBase.add({
        base: buildBaseParams(base, state),
        item,
        userId: ''
      });

      if (!result || result.status === 'failed') {
        window.store.dispatch({
          type: 'knowledge/updateItemProcessingStatus',
          payload: {
            baseId: base.id,
            itemId: item.id,
            status: 'failed',
            error: result?.message || 'backend processing failed',
            retryCount: 1
          }
        });
        return { ok: false, baseId: base.id, itemId: item.id, result };
      }

      window.store.dispatch({
        type: 'knowledge/updateItemProcessingStatus',
        payload: { baseId: base.id, itemId: item.id, status: 'completed' }
      });
      window.store.dispatch({
        type: 'knowledge/updateBaseItemUniqueId',
        payload: {
          baseId: base.id,
          itemId: item.id,
          uniqueId: result.uniqueId,
          uniqueIds: result.uniqueIds
        }
      });
      window.store.dispatch({ type: 'knowledge/clearCompletedProcessing', payload: { baseId: base.id } });

      return { ok: true, baseId: base.id, itemId: item.id, result };
    })()
  `
}

async function importDirectoryViaRenderer(options: CliOptions): Promise<CdpResponseValue> {
  const client = await createCdpClient(options.cdpPort)
  const result = await client.send<{
    result: {
      value: CdpResponseValue
    }
  }>('Runtime.evaluate', {
    expression: buildImportExpression({
      createIfMissing: options.createIfMissing,
      directory: options.directory,
      forceReload: options.forceReload,
      knowledgeBaseId: options.knowledgeBaseId,
      knowledgeBaseName: options.knowledgeBaseName,
      templateKnowledgeBaseId: options.templateKnowledgeBaseId,
      templateKnowledgeBaseName: options.templateKnowledgeBaseName
    }),
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  })

  return result.result.value
}

async function waitForImportCompletion(
  apiBase: string,
  apiKey: string,
  baseId: string,
  directory: string,
  timeoutMs: number,
  pollIntervalMs: number
): Promise<KnowledgeBaseItem> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const bases = await listKnowledgeBases(apiBase, apiKey)
    const base = bases.find((item) => item.id === baseId)
    if (!base) {
      throw new Error(`Knowledge base not found during polling: ${baseId}`)
    }
    const directoryItem = base.items?.find((item) => item.type === 'directory' && item.content === directory)
    if (!directoryItem) {
      throw new Error(`Directory item not found during polling: ${directory}`)
    }

    if (directoryItem.processingStatus === 'failed') {
      throw new Error(directoryItem.processingError || 'Knowledge import failed')
    }

    if (directoryItem.uniqueId && (!directoryItem.processingStatus || directoryItem.processingStatus === 'completed')) {
      return directoryItem
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }

  throw new Error(`Timed out waiting for directory import to finish after ${timeoutMs} ms`)
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2))

  if (!fs.existsSync(options.directory)) {
    throw new Error(`Directory does not exist: ${options.directory}`)
  }
  if (!fs.statSync(options.directory).isDirectory()) {
    throw new Error(`Path is not a directory: ${options.directory}`)
  }

  const discoveredConfig = discoverApiServerConfig()
  const apiKey = options.apiKey || discoveredConfig?.apiKey
  if (!apiKey) {
    throw new Error('API server key not found. Pass --api-key or enable the Cherry Studio API server first.')
  }

  const apiBase =
    options.apiBase ||
    (discoveredConfig ? `http://${discoveredConfig.host}:${discoveredConfig.port}` : DEFAULT_API_BASE)
  const bases = await listKnowledgeBases(apiBase, apiKey)
  const base = bases.find((item) =>
    options.knowledgeBaseId ? item.id === options.knowledgeBaseId : item.name === options.knowledgeBaseName
  )

  if (!base && !options.createIfMissing) {
    throw new Error(
      options.knowledgeBaseId
        ? `Knowledge base ID not found: ${options.knowledgeBaseId}`
        : `Knowledge base name not found: ${options.knowledgeBaseName}`
    )
  }

  const result = await importDirectoryViaRenderer(options)
  if (!result.ok) {
    throw new Error(result.error || result.result?.message || 'Renderer import failed')
  }

  const basesAfter = await listKnowledgeBases(apiBase, apiKey)
  const resolvedBase = basesAfter.find((item) =>
    options.knowledgeBaseId ? item.id === options.knowledgeBaseId : item.name === options.knowledgeBaseName
  )
  if (!resolvedBase) {
    throw new Error(
      options.knowledgeBaseId
        ? `Knowledge base ID not found after import: ${options.knowledgeBaseId}`
        : `Knowledge base name not found after import: ${options.knowledgeBaseName}`
    )
  }

  const item = await waitForImportCompletion(
    apiBase,
    apiKey,
    resolvedBase.id,
    options.directory,
    options.timeoutMs,
    options.pollIntervalMs
  )

  console.log(
    JSON.stringify(
      {
        ok: true,
        skipped: result.skipped === true,
        knowledgeBase: {
          id: resolvedBase.id,
          name: resolvedBase.name
        },
        directory: options.directory,
        itemId: item.id,
        uniqueId: item.uniqueId,
        uniqueIds: item.uniqueIds?.length || 0
      },
      null,
      2
    )
  )
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
