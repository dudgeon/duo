// Postinstall script — runs after the Orbit app first launches.
// 1. Installs the orbit skill to ~/.claude/skills/orbit/
// 2. Copies orbit CLI to the resources dir (handled by electron-builder extraResources)
// 3. Prompts for CLI symlink installation

import * as fs from 'fs'
import * as path from 'path'
import { execSync } from 'child_process'
import { app } from 'electron'
import { SKILL_INSTALL_DIR } from '../shared/constants'

export function runPostinstall(resourcesPath: string): void {
  installSkill(resourcesPath)
}

function installSkill(resourcesPath: string): void {
  const skillSrc = path.join(resourcesPath, 'skill')
  if (!fs.existsSync(skillSrc)) {
    console.warn('postinstall: skill directory not found at', skillSrc)
    return
  }

  fs.mkdirSync(SKILL_INSTALL_DIR, { recursive: true })

  for (const file of fs.readdirSync(skillSrc, { recursive: true }) as string[]) {
    const src = path.join(skillSrc, file)
    const dest = path.join(SKILL_INSTALL_DIR, file)
    if (fs.statSync(src).isDirectory()) {
      fs.mkdirSync(dest, { recursive: true })
    } else {
      fs.copyFileSync(src, dest)
    }
  }

  console.log('postinstall: skill installed to', SKILL_INSTALL_DIR)
}
