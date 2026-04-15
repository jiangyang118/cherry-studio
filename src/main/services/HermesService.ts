import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { loggerService } from '@logger'
import type { OperationResult } from '@shared/config/types'

const logger = loggerService.withContext('HermesService')

const HERMES_REPO_PATH = path.join(os.homedir(), 'code', '099-github', 'hermes-agent')
const HERMES_HOME_PATH = path.join(os.homedir(), '.hermes')
const HERMES_RUNTIME_STATUS_PATH = path.join(HERMES_HOME_PATH, 'gateway_state.json')
const HERMES_PID_PATH = path.join(HERMES_HOME_PATH, 'gateway.pid')

export type HermesGatewayStatus = 'stopped' | 'starting' | 'running' | 'error'

export interface HermesInstallInfo {
  available: boolean
  repoPath: string
  venvPath: string | null
  cliPath: string | null
  hermesHome: string
  issues: string[]
}

export interface HermesPlatformInfo {
  id: string
  name: string
  status: 'connected' | 'disconnected' | 'error'
  errorMessage?: string
}

export interface HermesHealthInfo {
  status: 'healthy' | 'unhealthy'
  gatewayState: string | null
  exitReason: string | null
  updatedAt: string | null
  pid: number | null
  platforms: HermesPlatformInfo[]
}

export interface HermesGatewayInfo {
  status: HermesGatewayStatus
  mode: 'manual' | 'service' | 'unknown' | null
  pid: number | null
  message?: string
}

export type HermesCommandId = 'statusDeep' | 'doctor' | 'sessionsList' | 'logsErrors' | 'logsGateway'
export type HermesTerminalActionId = 'chat' | 'setup' | 'gatewaySetup' | 'model' | 'skills' | 'sessionsBrowse'

export interface HermesCommandResult {
  success: boolean
  id: HermesCommandId
  label: string
  command: string
  exitCode: number | null
  stdout: string
  stderr: string
  durationMs: number
}

interface HermesRuntimeStatusFile {
  gateway_state?: string
  exit_reason?: string | null
  updated_at?: string | null
  pid?: number
  platforms?: Record<
    string,
    {
      state?: string
      error_message?: string | null
    }
  >
}

interface CommandResult {
  code: number | null
  stdout: string
  stderr: string
}

export function parseHermesGatewayStatus(output: string, fallbackMessage?: string): HermesGatewayInfo {
  const normalized = output.toLowerCase()
  const pidMatch = output.match(/PID:\s*([0-9]+)/i)
  const pid = pidMatch ? Number(pidMatch[1]) : null

  if (normalized.includes('gateway is running') || normalized.includes('gateway service is loaded')) {
    return {
      status: 'running',
      mode: normalized.includes('not as a system service')
        ? 'manual'
        : normalized.includes('service')
          ? 'service'
          : 'unknown',
      pid
    }
  }

  if (normalized.includes('gateway is not running') || normalized.includes('service is not loaded')) {
    return {
      status: 'stopped',
      mode: normalized.includes('service') ? 'service' : null,
      pid,
      message: fallbackMessage
    }
  }

  return {
    status: 'error',
    mode: null,
    pid,
    message: fallbackMessage || output.trim() || undefined
  }
}

export function mapHermesRuntimePlatforms(platforms: HermesRuntimeStatusFile['platforms']): HermesPlatformInfo[] {
  if (!platforms) {
    return []
  }

  return Object.entries(platforms).map(([id, info]) => ({
    id,
    name: id,
    status: info?.state === 'connected' ? 'connected' : info?.state === 'fatal' ? 'error' : 'disconnected',
    errorMessage: info?.error_message || undefined
  }))
}

class HermesService {
  constructor() {
    this.checkInstalled = this.checkInstalled.bind(this)
    this.getStatus = this.getStatus.bind(this)
    this.checkHealth = this.checkHealth.bind(this)
    this.getPlatforms = this.getPlatforms.bind(this)
    this.startGateway = this.startGateway.bind(this)
    this.stopGateway = this.stopGateway.bind(this)
    this.getDocsUrl = this.getDocsUrl.bind(this)
    this.runCommand = this.runCommand.bind(this)
    this.openInTerminal = this.openInTerminal.bind(this)
  }

  private getVenvPath(): string | null {
    for (const candidate of [path.join(HERMES_REPO_PATH, 'venv'), path.join(HERMES_REPO_PATH, '.venv')]) {
      if (fs.existsSync(candidate)) {
        return candidate
      }
    }
    return null
  }

  private getCliPath(venvPath: string | null): string | null {
    if (!venvPath) {
      return null
    }

    const candidates =
      process.platform === 'win32'
        ? [path.join(venvPath, 'Scripts', 'hermes.exe'), path.join(venvPath, 'Scripts', 'hermes')]
        : [path.join(venvPath, 'bin', 'hermes')]

    return candidates.find((candidate) => fs.existsSync(candidate)) || null
  }

  private readRuntimeStatus(): HermesRuntimeStatusFile | null {
    try {
      if (!fs.existsSync(HERMES_RUNTIME_STATUS_PATH)) {
        return null
      }

      const raw = fs.readFileSync(HERMES_RUNTIME_STATUS_PATH, 'utf8').trim()
      if (!raw) {
        return null
      }

      return JSON.parse(raw) as HermesRuntimeStatusFile
    } catch (error) {
      logger.warn('Failed to read Hermes runtime status', error as Error)
      return null
    }
  }

  private readPidFile(): number | null {
    try {
      if (!fs.existsSync(HERMES_PID_PATH)) {
        return null
      }

      const raw = fs.readFileSync(HERMES_PID_PATH, 'utf8').trim()
      if (!raw) {
        return null
      }

      const payload = JSON.parse(raw) as { pid?: number } | number
      if (typeof payload === 'number') {
        return payload
      }

      return typeof payload.pid === 'number' ? payload.pid : null
    } catch {
      return null
    }
  }

  private async execHermesCommand(args: string[], timeoutMs = 20000): Promise<CommandResult> {
    const installInfo = await this.checkInstalled()
    if (!installInfo.cliPath) {
      return {
        code: null,
        stdout: '',
        stderr: 'Hermes CLI not found. Expected an editable install under the local hermes-agent repository.'
      }
    }

    return new Promise((resolve) => {
      const proc = spawn(installInfo.cliPath!, args, {
        cwd: installInfo.repoPath,
        env: {
          ...process.env,
          HERMES_HOME: installInfo.hermesHome
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })

      let stdout = ''
      let stderr = ''

      proc.stdout?.on('data', (data) => {
        stdout += data.toString()
      })

      proc.stderr?.on('data', (data) => {
        stderr += data.toString()
      })

      const timeout = setTimeout(() => {
        proc.kill('SIGKILL')
        resolve({ code: null, stdout, stderr: stderr || `Command timed out after ${timeoutMs}ms` })
      }, timeoutMs)

      proc.on('exit', (code) => {
        clearTimeout(timeout)
        resolve({ code, stdout, stderr })
      })

      proc.on('error', (error) => {
        clearTimeout(timeout)
        resolve({ code: null, stdout, stderr: error.message })
      })
    })
  }

  private getCommandConfig(id: HermesCommandId): { args: string[]; timeoutMs: number; label: string } {
    switch (id) {
      case 'statusDeep':
        return { args: ['status', '--deep'], timeoutMs: 30000, label: 'Hermes Status' }
      case 'doctor':
        return { args: ['doctor'], timeoutMs: 30000, label: 'Hermes Doctor' }
      case 'sessionsList':
        return { args: ['sessions', 'list', '--limit', '10'], timeoutMs: 20000, label: 'Recent Sessions' }
      case 'logsErrors':
        return { args: ['logs', 'errors', '-n', '50'], timeoutMs: 20000, label: 'Errors Log' }
      case 'logsGateway':
        return { args: ['logs', 'gateway', '-n', '50'], timeoutMs: 20000, label: 'Gateway Log' }
    }
  }

  private getTerminalActionConfig(id: HermesTerminalActionId): { args: string[]; title: string } {
    switch (id) {
      case 'chat':
        return { args: [], title: 'Hermes Chat' }
      case 'setup':
        return { args: ['setup'], title: 'Hermes Setup' }
      case 'gatewaySetup':
        return { args: ['gateway', 'setup'], title: 'Hermes Gateway Setup' }
      case 'model':
        return { args: ['model'], title: 'Hermes Model Selector' }
      case 'skills':
        return { args: ['skills', 'browse'], title: 'Hermes Skills Hub' }
      case 'sessionsBrowse':
        return { args: ['sessions', 'browse'], title: 'Hermes Sessions Browser' }
    }
  }

  private shellEscape(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`
  }

  private writeTerminalLauncherScript(title: string, commandLine: string): string {
    const scriptsDir = path.join(os.tmpdir(), 'cherrystudio-hermes')
    fs.mkdirSync(scriptsDir, { recursive: true })
    const scriptPath = path.join(scriptsDir, `hermes-${Date.now()}.command`)
    const content = [
      '#!/bin/zsh',
      '',
      `cd ${this.shellEscape(HERMES_REPO_PATH)} || exit 1`,
      `source ${this.shellEscape(path.join(HERMES_REPO_PATH, 'venv', 'bin', 'activate'))} 2>/dev/null || source ${this.shellEscape(path.join(HERMES_REPO_PATH, '.venv', 'bin', 'activate'))} 2>/dev/null || true`,
      'clear',
      `echo ${this.shellEscape(title)}`,
      'echo',
      commandLine,
      '',
      'status=$?',
      'echo',
      'echo "Command finished with status: $status"',
      'exec zsh'
    ].join('\n')

    fs.writeFileSync(scriptPath, content, 'utf8')
    fs.chmodSync(scriptPath, 0o755)
    return scriptPath
  }

  private async openScriptInTerminal(scriptPath: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      if (process.platform === 'darwin') {
        const appleScript = [
          'tell application "iTerm"',
          'activate',
          'set newWindow to (create window with default profile)',
          `tell current session of newWindow to write text ${JSON.stringify(this.shellEscape(scriptPath))}`,
          'end tell'
        ]

        const proc = spawn(
          'osascript',
          appleScript.flatMap((line) => ['-e', line]),
          {
            detached: true,
            stdio: 'ignore',
            windowsHide: true
          }
        )

        proc.on('error', reject)
        proc.unref()
        resolve()
        return
      }

      let opener = 'open'
      let args = [scriptPath]

      if (process.platform === 'win32') {
        opener = 'cmd.exe'
        args = ['/c', 'start', '', scriptPath]
      }

      const proc = spawn(opener, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      })

      proc.on('error', reject)
      proc.unref()
      resolve()
    })
  }

  public async checkInstalled(): Promise<HermesInstallInfo> {
    const issues: string[] = []

    if (!fs.existsSync(HERMES_REPO_PATH)) {
      issues.push('Local hermes-agent repository not found')
    }

    const venvPath = this.getVenvPath()
    if (!venvPath) {
      issues.push('Python virtual environment not found')
    }

    const cliPath = this.getCliPath(venvPath)
    if (!cliPath) {
      issues.push('Hermes CLI executable not found in the repository virtual environment')
    }

    return {
      available: issues.length === 0,
      repoPath: HERMES_REPO_PATH,
      venvPath,
      cliPath,
      hermesHome: HERMES_HOME_PATH,
      issues
    }
  }

  public async getStatus(): Promise<HermesGatewayInfo> {
    const installInfo = await this.checkInstalled()
    if (!installInfo.available) {
      return {
        status: 'error',
        mode: null,
        pid: null,
        message: installInfo.issues.join('. ')
      }
    }

    const result = await this.execHermesCommand(['gateway', 'status'])
    const combinedOutput = [result.stdout, result.stderr].filter(Boolean).join('\n')

    if (result.code === 0) {
      return parseHermesGatewayStatus(combinedOutput, undefined)
    }

    return parseHermesGatewayStatus(combinedOutput, result.stderr.trim() || 'Unable to determine Hermes gateway status')
  }

  public async checkHealth(): Promise<HermesHealthInfo> {
    const status = await this.getStatus()
    const runtime = this.readRuntimeStatus()
    const platforms = mapHermesRuntimePlatforms(runtime?.platforms)

    return {
      status: status.status === 'running' ? 'healthy' : 'unhealthy',
      gatewayState: runtime?.gateway_state || null,
      exitReason: runtime?.exit_reason || status.message || null,
      updatedAt: runtime?.updated_at || null,
      pid: status.pid || this.readPidFile() || runtime?.pid || null,
      platforms
    }
  }

  public async getPlatforms(): Promise<HermesPlatformInfo[]> {
    const health = await this.checkHealth()
    return health.platforms
  }

  public async startGateway(): Promise<OperationResult> {
    const installInfo = await this.checkInstalled()
    if (!installInfo.available) {
      return {
        success: false,
        message: installInfo.issues.join('. ')
      }
    }

    const result = await this.execHermesCommand(['gateway', 'start'], 30000)
    if (result.code === 0) {
      return { success: true }
    }

    const message =
      [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n') || 'Failed to start Hermes gateway'
    logger.error('Failed to start Hermes gateway', new Error(message))
    return { success: false, message }
  }

  public async stopGateway(): Promise<OperationResult> {
    const installInfo = await this.checkInstalled()
    if (!installInfo.available) {
      return {
        success: false,
        message: installInfo.issues.join('. ')
      }
    }

    const result = await this.execHermesCommand(['gateway', 'stop'], 30000)
    if (result.code === 0) {
      return { success: true }
    }

    const message =
      [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n') || 'Failed to stop Hermes gateway'
    logger.error('Failed to stop Hermes gateway', new Error(message))
    return { success: false, message }
  }

  public async getDocsUrl(): Promise<string> {
    return 'https://hermes-agent.nousresearch.com/docs/'
  }

  public async runCommand(_: Electron.IpcMainInvokeEvent, id: HermesCommandId): Promise<HermesCommandResult> {
    const installInfo = await this.checkInstalled()
    const commandConfig = this.getCommandConfig(id)

    if (!installInfo.available) {
      return {
        success: false,
        id,
        label: commandConfig.label,
        command: `hermes ${commandConfig.args.join(' ')}`,
        exitCode: null,
        stdout: '',
        stderr: installInfo.issues.join('. '),
        durationMs: 0
      }
    }

    const startedAt = Date.now()
    const result = await this.execHermesCommand(commandConfig.args, commandConfig.timeoutMs)

    return {
      success: result.code === 0,
      id,
      label: commandConfig.label,
      command: `hermes ${commandConfig.args.join(' ')}`.trim(),
      exitCode: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: Date.now() - startedAt
    }
  }

  public async openInTerminal(_: Electron.IpcMainInvokeEvent, id: HermesTerminalActionId): Promise<OperationResult> {
    const installInfo = await this.checkInstalled()
    if (!installInfo.available) {
      return {
        success: false,
        message: installInfo.issues.join('. ')
      }
    }

    try {
      const action = this.getTerminalActionConfig(id)
      const command = [this.shellEscape(installInfo.cliPath!), ...action.args.map((arg) => this.shellEscape(arg))].join(
        ' '
      )
      const scriptPath = this.writeTerminalLauncherScript(action.title, command)
      await this.openScriptInTerminal(scriptPath)
      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Failed to open Hermes terminal action', error as Error)
      return { success: false, message }
    }
  }
}

export const hermesService = new HermesService()
