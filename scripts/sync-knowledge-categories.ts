import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import WebSocket from 'ws'

type CliOptions = {
  apiBase: string
  apiKey?: string
  cdpPort: number
  templateKnowledgeBaseName: string
  vaultRoot: string
  waitAfterStartMs: number
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
  model?: {
    id: string
    provider: string
    name?: string
    group?: string
  }
  dimensions?: number
  items?: Array<{
    id: string
    type: string
    content: string
    processingStatus?: string
    uniqueId?: string
    uniqueIds?: string[]
  }>
}

type CdpPage = {
  title: string
  type: string
  url?: string
  webSocketDebuggerUrl: string
}

type CategorySpec = {
  name: string
  path: string
}

type SyncCategoryResult = {
  category: string
  path: string
  createdBase: boolean
  importStarted: boolean
  skippedImport: boolean
  error?: string
}

type SyncRendererResult = {
  ok: boolean
  results: SyncCategoryResult[]
}

const DEFAULT_API_BASE = 'http://127.0.0.1:23333'
const DEFAULT_CDP_PORT = 9223
const DEFAULT_WAIT_AFTER_START_MS = 10_000

function printHelp(): void {
  console.log(`Usage:
  node --import tsx scripts/sync-knowledge-categories.ts \\
    --vault-root '/absolute/vault/path' \\
    --template-knowledge-base '测试知识库' \\
    [--api-base ${DEFAULT_API_BASE}] \\
    [--api-key <key>] \\
    [--cdp-port ${DEFAULT_CDP_PORT}] \\
    [--wait-after-start-ms ${DEFAULT_WAIT_AFTER_START_MS}]
`)
}

function parseCliArgs(argv: string[]): CliOptions {
  const options: Partial<CliOptions> = {
    apiBase: DEFAULT_API_BASE,
    cdpPort: DEFAULT_CDP_PORT,
    waitAfterStartMs: DEFAULT_WAIT_AFTER_START_MS
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = argv[i + 1]
    switch (arg) {
      case '--help':
      case '-h':
        printHelp()
        process.exit(0)
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
      case '--template-knowledge-base':
        options.templateKnowledgeBaseName = next
        i++
        break
      case '--vault-root':
        options.vaultRoot = next
        i++
        break
      case '--wait-after-start-ms':
        options.waitAfterStartMs = Number(next)
        i++
        break
      default:
        if (arg.startsWith('--')) {
          throw new Error(`Unknown argument: ${arg}`)
        }
    }
  }

  if (!options.vaultRoot) {
    throw new Error('Missing required argument: --vault-root')
  }

  if (!options.templateKnowledgeBaseName) {
    throw new Error('Missing required argument: --template-knowledge-base')
  }

  return options as CliOptions
}

function parseApiServerConfigLines(lines: string[]): ApiServerRuntimeConfig | null {
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
  return [...configs].reverse().find((config) => config.enabled) || configs[configs.length - 1]
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

function collectTopLevelCategories(vaultRoot: string): CategorySpec[] {
  const entries = fs.readdirSync(vaultRoot, { withFileTypes: true })
  const raw = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      originalName: entry.name,
      normalizedName: decodeURIComponent(entry.name)
    }))
    .filter((entry) => !entry.originalName.startsWith('.'))

  const deduped = new Map<string, CategorySpec>()
  for (const entry of raw) {
    if (!deduped.has(entry.normalizedName)) {
      deduped.set(entry.normalizedName, {
        name: entry.normalizedName,
        path: path.join(vaultRoot, entry.originalName)
      })
    }
  }

  const preferredOrder = ['04 OpenClaw Brain', 'AI产品经理']
  return [...deduped.values()].sort((a, b) => {
    const aPriority = preferredOrder.indexOf(a.name)
    const bPriority = preferredOrder.indexOf(b.name)
    if (aPriority !== -1 || bPriority !== -1) {
      if (aPriority === -1) return 1
      if (bPriority === -1) return -1
      return aPriority - bPriority
    }
    return a.name.localeCompare(b.name, 'zh-Hans-CN')
  })
}

async function getCdpPage(cdpPort: number): Promise<CdpPage> {
  const pages = await requestJson<CdpPage[]>(`http://127.0.0.1:${cdpPort}/json/list`)
  const page =
    pages.find((item) => item.type === 'page' && item.title === 'Cherry Studio') ||
    pages.find((item) => item.type === 'page' && item.url?.includes('Cherry%20Studio.app')) ||
    pages.find((item) => item.type === 'page')

  if (!page) {
    throw new Error(`Cherry Studio renderer page not found on CDP port ${cdpPort}`)
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

function buildSyncExpression(params: { templateKnowledgeBaseName: string; categories: CategorySpec[] }): string {
  return `
    (async () => {
      const templateName = ${JSON.stringify(params.templateKnowledgeBaseName)};
      const categories = ${JSON.stringify(params.categories)};
      const trimTrailingSlash = (value) => (value || '').replace(/\\/+$/, '');
      const firstApiKey = (provider) =>
        (provider?.apiKey || '')
          .split(',')
          .map((item) => item.trim())
          .find(Boolean) || 'secret';

      const buildBaseParams = (base) => {
        const state = window.store.getState();
        const provider = state.llm.providers.find((item) => item.id === base.model.provider);
        if (!provider) {
          throw new Error('Provider not found: ' + base.model.provider);
        }
        let baseURL = trimTrailingSlash((provider.apiHost || '').trim()).replace(/#$/, '');
        if (base.model.provider === 'ollama') {
          baseURL = baseURL.replace(/\\/api$/, '');
        }
        return {
          id: base.id,
          dimensions: base.dimensions,
          embedApiClient: {
            model: base.model.id,
            provider: base.model.provider,
            apiKey: firstApiKey(provider),
            baseURL
          },
          chunkSize: base.chunkSize,
          chunkOverlap: base.chunkOverlap,
          documentCount: base.documentCount,
          preprocessProvider: base.preprocessProvider
        };
      };

      const state = window.store.getState();
      const templateBase = state.knowledge.bases.find((item) => item.name === templateName);
      if (!templateBase) {
        return { ok: false, results: [{ category: templateName, path: '', createdBase: false, importStarted: false, skippedImport: false, error: 'template knowledge base not found' }] };
      }

      const results = [];

      for (const category of categories) {
        try {
          let currentBase = window.store.getState().knowledge.bases.find((item) => item.name === category.name);
          let createdBase = false;
          if (!currentBase) {
            currentBase = {
              ...structuredClone(templateBase),
              id: crypto.randomUUID(),
              name: category.name,
              items: [],
              created_at: Date.now(),
              updated_at: Date.now()
            };
            window.store.dispatch({ type: 'knowledge/addBase', payload: currentBase });
            createdBase = true;
          }

          const existingItem = currentBase.items.find((item) => item.type === 'directory' && item.content === category.path);
          if (existingItem) {
            results.push({
              category: category.name,
              path: category.path,
              createdBase,
              importStarted: false,
              skippedImport: true
            });
            continue;
          }

          const item = {
            id: crypto.randomUUID(),
            type: 'directory',
            content: category.path,
            created_at: Date.now(),
            updated_at: Date.now(),
            processingStatus: 'processing',
            processingProgress: 0,
            processingError: '',
            retryCount: 1
          };

          window.store.dispatch({ type: 'knowledge/addItem', payload: { baseId: currentBase.id, item } });
          // Fire and keep running inside Cherry Studio. We mark it started immediately.
          void window.api.knowledgeBase
            .add({ base: buildBaseParams(currentBase), item, userId: '' })
            .then((result) => {
              if (result?.status === 'failed') {
                window.store.dispatch({
                  type: 'knowledge/updateItemProcessingStatus',
                  payload: {
                    baseId: currentBase.id,
                    itemId: item.id,
                    status: 'failed',
                    error: result.message || 'backend processing failed',
                    retryCount: 1
                  }
                });
                return;
              }
              window.store.dispatch({
                type: 'knowledge/updateBaseItemUniqueId',
                payload: {
                  baseId: currentBase.id,
                  itemId: item.id,
                  uniqueId: result.uniqueId,
                  uniqueIds: result.uniqueIds
                }
              });
              window.store.dispatch({
                type: 'knowledge/updateItemProcessingStatus',
                payload: { baseId: currentBase.id, itemId: item.id, status: 'completed' }
              });
              window.store.dispatch({ type: 'knowledge/clearCompletedProcessing', payload: { baseId: currentBase.id } });
            })
            .catch((error) => {
              window.store.dispatch({
                type: 'knowledge/updateItemProcessingStatus',
                payload: {
                  baseId: currentBase.id,
                  itemId: item.id,
                  status: 'failed',
                  error: error instanceof Error ? error.message : String(error),
                  retryCount: 1
                }
              });
            });

          results.push({
            category: category.name,
            path: category.path,
            createdBase,
            importStarted: true,
            skippedImport: false
          });
        } catch (error) {
          results.push({
            category: category.name,
            path: category.path,
            createdBase: false,
            importStarted: false,
            skippedImport: false,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      return { ok: true, results };
    })()
  `
}

async function syncCategoriesViaRenderer(options: CliOptions, categories: CategorySpec[]): Promise<SyncRendererResult> {
  const client = await createCdpClient(options.cdpPort)
  const result = await client.send<{
    result: {
      value: SyncRendererResult
    }
  }>('Runtime.evaluate', {
    expression: buildSyncExpression({
      templateKnowledgeBaseName: options.templateKnowledgeBaseName,
      categories
    }),
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  })

  return result.result.value
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2))
  if (!fs.existsSync(options.vaultRoot) || !fs.statSync(options.vaultRoot).isDirectory()) {
    throw new Error(`Vault root does not exist or is not a directory: ${options.vaultRoot}`)
  }

  const categories = collectTopLevelCategories(options.vaultRoot)
  const discoveredConfig = discoverApiServerConfig()
  const apiKey = options.apiKey || discoveredConfig?.apiKey
  if (!apiKey) {
    throw new Error('API server key not found. Pass --api-key or enable the Cherry Studio API server first.')
  }

  await listKnowledgeBases(options.apiBase, apiKey)
  const rendererResult = await syncCategoriesViaRenderer(options, categories)
  await new Promise((resolve) => setTimeout(resolve, options.waitAfterStartMs))
  const bases = await listKnowledgeBases(options.apiBase, apiKey)

  const summary = rendererResult.results.map((result) => {
    const base = bases.find((item) => item.name === result.category)
    const directoryItem = base?.items?.find((item) => item.type === 'directory' && item.content === result.path)
    return {
      category: result.category,
      createdBase: result.createdBase,
      importStarted: result.importStarted,
      skippedImport: result.skippedImport,
      baseId: base?.id,
      directoryProcessingStatus: directoryItem?.processingStatus,
      directoryUniqueId: directoryItem?.uniqueId,
      error: result.error
    }
  })

  console.log(
    JSON.stringify(
      {
        ok: rendererResult.ok,
        categoryCount: categories.length,
        results: summary
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
