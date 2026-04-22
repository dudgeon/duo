// Stage 3: Unix socket server — the bridge between orbit CLI and the main process
//
// Protocol: JSON-over-Unix-socket, newline-delimited
//   → {"id":"<uuid>","cmd":"text","args":{"selector":"article"}}
//   ← {"id":"<uuid>","ok":true,"result":"..."}
//   ← {"id":"<uuid>","ok":false,"error":"Element not found"}
//
// Socket path: ~/Library/Application Support/orbit/orbit.sock (see constants.ts)
// Security note: for MVP, any local process can send commands. Before broader
// distribution, add a launch-time token or uid check (see §14 of brief).

import * as net from 'net'
import * as fs from 'fs'
import * as path from 'path'
import type { CdpBridge } from './cdp-bridge'
import type { OrbitRequest, OrbitResponse } from '../shared/types'
import { SOCKET_PATH } from '../shared/constants'

export class SocketServer {
  private server: net.Server | null = null
  private cdp: CdpBridge | null = null

  constructor(cdp: CdpBridge) {
    this.cdp = cdp
  }

  start(): void {
    // TODO Stage 3: implement socket server
    void SOCKET_PATH // used once implemented
    throw new Error('SocketServer not yet implemented (Stage 3)')
  }

  private async handleRequest(req: OrbitRequest): Promise<OrbitResponse> {
    void req
    throw new Error('SocketServer.handleRequest not yet implemented (Stage 3)')
  }

  stop(): void {
    this.server?.close()
    try { fs.unlinkSync(SOCKET_PATH) } catch { /* already gone */ }
    this.server = null
  }
}

export function ensureSocketDir(): void {
  fs.mkdirSync(path.dirname(SOCKET_PATH), { recursive: true })
}
