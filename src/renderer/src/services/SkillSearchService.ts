import { loggerService } from '@logger'
import {
  ClaudePluginsSearchResponseSchema,
  ClawhubSearchResponseSchema,
  type SkillSearchResult,
  type SkillSearchSource,
  SkillsShSearchResponseSchema
} from '@types'

const logger = loggerService.withContext('SkillSearchService')

const CLAUDE_PLUGINS_API = 'https://claude-plugins.dev/api/skills'
const SKILLS_SH_API = 'https://skills.sh/api/search'
const CLAWHUB_API = 'https://clawhub.ai/api/v1/search'

const REQUEST_TIMEOUT_MS = 15_000

function normalizeGitHubUrl(input: string): URL | null {
  try {
    const url = new URL(input.trim())
    if (url.hostname !== 'github.com') return null
    return url
  } catch {
    return null
  }
}

function normalizeGitHubQuery(query: string): SkillSearchResult[] {
  const url = normalizeGitHubUrl(query)
  if (!url) return []

  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length < 2) return []

  const owner = segments[0]
  const repoRaw = segments[1]
  const mode = segments[2]
  const ref = segments[3]
  const rest = segments.slice(4)
  const repo = repoRaw.replace(/\.git$/i, '')
  if (!owner || !repo) return []

  let inferredPath = ''
  if (mode === 'tree' && ref && rest.length > 0) {
    inferredPath = rest.join('/')
  } else if (mode === 'blob' && ref && rest.length > 0) {
    inferredPath = rest.slice(0, -1).join('/')
  }

  const label = inferredPath ? `${repo}/${inferredPath.split('/').at(-1)}` : repo
  const sourceUrl = `${url.origin}${url.pathname}`

  return [
    {
      slug: `${owner}/${repo}${inferredPath ? `:${inferredPath}` : ''}`,
      name: label,
      description: inferredPath || `${url.origin}${url.pathname}`,
      author: owner,
      stars: 0,
      downloads: 0,
      sourceRegistry: 'github.com',
      sourceUrl,
      installSource: `github:${encodeURIComponent(sourceUrl)}`
    }
  ]
}

// ===========================================================================
// Normalizers: source-specific response → unified SkillSearchResult[]
// ===========================================================================

function normalizeClaudePlugins(raw: unknown): SkillSearchResult[] {
  const parsed = ClaudePluginsSearchResponseSchema.safeParse(raw)
  if (!parsed.success) return []

  return parsed.data.skills.map((s) => {
    const repoOwner = s.metadata?.repoOwner ?? ''
    const repoName = s.metadata?.repoName ?? ''
    const directoryPath = s.metadata?.directoryPath ?? ''
    return {
      slug: s.id,
      name: s.name,
      description: s.description ?? null,
      author: s.author ?? s.namespace ?? null,
      stars: s.stars ?? 0,
      downloads: s.installs ?? 0,
      sourceRegistry: 'claude-plugins.dev' as SkillSearchSource,
      sourceUrl: s.sourceUrl ?? (repoOwner && repoName ? `https://github.com/${repoOwner}/${repoName}` : null),
      // Encode sourceUrl directly so install can clone + resolve without the resolve API
      installSource: `claude-plugins:${repoOwner}/${repoName}/${directoryPath}`
    }
  })
}

function normalizeSkillsSh(raw: unknown): SkillSearchResult[] {
  const parsed = SkillsShSearchResponseSchema.safeParse(raw)
  if (!parsed.success) return []

  return parsed.data.skills.map((s) => ({
    slug: s.id,
    name: s.name,
    description: null,
    author: s.source.split('/')[0] ?? null,
    stars: 0,
    downloads: s.installs,
    sourceRegistry: 'skills.sh' as SkillSearchSource,
    sourceUrl: s.source ? `https://github.com/${s.source}` : null,
    installSource: `skills.sh:${s.id}`
  }))
}

function normalizeClawhub(raw: unknown): SkillSearchResult[] {
  const parsed = ClawhubSearchResponseSchema.safeParse(raw)
  if (!parsed.success) return []

  return parsed.data.results.map((s) => ({
    slug: s.slug,
    name: s.displayName,
    description: s.summary ?? null,
    author: null,
    stars: 0,
    downloads: 0,
    sourceRegistry: 'clawhub.ai' as SkillSearchSource,
    sourceUrl: `https://clawhub.ai/skills/${s.slug}`,
    installSource: `clawhub:${s.slug}`
  }))
}

// ===========================================================================
// Fetch helpers
// ===========================================================================

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const resp = await fetchWithTimeout(url)
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return resp.json()
}

// ===========================================================================
// Source fetchers
// ===========================================================================

async function searchClaudePlugins(query: string): Promise<SkillSearchResult[]> {
  const url = new URL(CLAUDE_PLUGINS_API)
  url.searchParams.set('q', query)
  url.searchParams.set('limit', '20')
  const json = await fetchJson(url.toString())
  return normalizeClaudePlugins(json)
}

async function searchSkillsSh(query: string): Promise<SkillSearchResult[]> {
  const url = new URL(SKILLS_SH_API)
  url.searchParams.set('q', query)
  const json = await fetchJson(url.toString())
  return normalizeSkillsSh(json)
}

async function searchClawhub(query: string): Promise<SkillSearchResult[]> {
  const url = new URL(CLAWHUB_API)
  url.searchParams.set('q', query)
  const json = await fetchJson(url.toString())
  return normalizeClawhub(json)
}

// ===========================================================================
// Public API
// ===========================================================================

/**
 * Search all 3 skill registries with race semantics.
 * Returns results from whichever source responds first,
 * then merges remaining sources as they complete.
 */
export async function searchSkills(query: string): Promise<SkillSearchResult[]> {
  if (!query.trim()) return []

  const directGitHubMatches = normalizeGitHubQuery(query)
  if (directGitHubMatches.length > 0) {
    return directGitHubMatches
  }

  const sources = [
    searchSkillsSh(query).catch((err) => {
      logger.warn('skills.sh search failed', { error: err instanceof Error ? err.message : String(err) })
      return [] as SkillSearchResult[]
    }),
    searchClaudePlugins(query).catch((err) => {
      logger.warn('claude-plugins search failed', { error: err instanceof Error ? err.message : String(err) })
      return [] as SkillSearchResult[]
    }),
    searchClawhub(query).catch((err) => {
      logger.warn('clawhub search failed', { error: err instanceof Error ? err.message : String(err) })
      return [] as SkillSearchResult[]
    })
  ]

  const results = await Promise.allSettled(sources)
  const allResults: SkillSearchResult[] = []

  for (const result of results) {
    if (result.status === 'fulfilled') {
      allResults.push(...result.value)
    }
  }

  // Deduplicate by name (keep first occurrence = fastest source)
  const seen = new Set<string>()
  return allResults.filter((r) => {
    const key = r.name.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
