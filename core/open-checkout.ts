// ENH-224 Phase 1 — the opaque managed checkout (P3).
//
// "Open just this doc" pulls a GitHub file into a Duo-owned working tree under
// ~/.claude/duo/checkouts/<owner>-<repo>@<ref>/ that the user never has to
// locate — then it opens exactly like a local file (P4). Saving writes there;
// the baseline SHA captured here is the divergence anchor Phase 2 uses for the
// "Propose changes" → PR round-trip.
//
// DR6 (2026-06-21): v1 pulls a **depth-1 whole-repo shallow clone** at the URL's
// ref — asset-complete (all relative links/images resolve), real git for the PR
// diff, and it reuses the tested `runClone` (gh-preferred, git fallback) with
// zero new sparse plumbing. Sparse-folder narrowing is the deferred optimization
// (same opaque behavior; swap the clone call). No-sidecar (§12): we return a
// POINTER resolved live, never a mirror of GitHub state.

import * as fs from 'fs/promises'
import * as fssync from 'fs'
import * as path from 'path'
import * as os from 'os'
import { runClone } from './git/clone'
import { execGit } from './git/exec'
import type { CheckoutPointer, CheckoutResult, CheckoutTarget } from '../shared/types'

// Canonical type home is shared/types.ts (so the renderer + preload share the
// IPC contract). Re-exported here for core importers (e.g. the main handler).
export type { CheckoutPointer, CheckoutResult, CheckoutTarget }

export interface ManagedCheckoutOpts {
  /** Injectable for tests; defaults to ~/.claude/duo/checkouts. */
  baseDir?: string
}

const DEFAULT_CHECKOUTS_DIR = path.join(os.homedir(), '.claude', 'duo', 'checkouts')

/**
 * A 7–40 char hex string is treated as a commit SHA. `git clone --branch <sha>`
 * is rejected, so a SHA ref needs a plain clone + `git checkout <sha>`.
 */
export function isLikelySha(ref: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(ref)
}

/**
 * The opaque, deterministic checkout dir for an owner/repo@ref. Pure +
 * exported so it's unit-testable. Sanitizes the ref (a branch may contain `/`,
 * e.g. `release/1.x`) into a single path segment.
 */
export function managedCheckoutDir(
  owner: string,
  repo: string,
  ref: string,
  baseDir: string = DEFAULT_CHECKOUTS_DIR
): string {
  const safeRef = ref.replace(/[^\w.-]+/g, '-') || 'HEAD'
  return path.join(baseDir, `${owner}-${repo}@${safeRef}`)
}

/**
 * Check out a GitHub file into the managed home and return its pointer.
 * Idempotent: an existing checkout for this owner/repo@ref is reused (no
 * re-clone). Network/git work — call from main, not a sandboxed CLI.
 */
export async function runManagedCheckout(
  target: CheckoutTarget,
  opts: ManagedCheckoutOpts = {}
): Promise<CheckoutResult> {
  const { owner, repo, ref, filePath } = target
  // ENH-224 security — ref + filePath come from the (untrusted) URL. Reject a ref
  // that could be read as a git flag, and a filePath that escapes the checkout
  // (path traversal), BEFORE any clone/checkout/read.
  if (ref.startsWith('-')) {
    return { ok: false, errorKind: 'checkout-failed', error: `Invalid ref: ${ref}` }
  }
  const checkoutDir = managedCheckoutDir(owner, repo, ref, opts.baseDir)
  const fileAbsPath = path.join(checkoutDir, filePath)
  const relInside = path.relative(checkoutDir, fileAbsPath)
  if (relInside.startsWith('..') || path.isAbsolute(relInside)) {
    return { ok: false, errorKind: 'file-missing', error: `Invalid file path: ${filePath}` }
  }
  const cloneUrl = `https://github.com/${owner}/${repo}`

  // Idempotent reuse — the existing checkout IS the managed copy (§12 pointer,
  // resolved live). Re-rev-parse the baseline; re-check the file is present.
  if (fssync.existsSync(path.join(checkoutDir, '.git'))) {
    if (!fssync.existsSync(fileAbsPath)) {
      return { ok: false, errorKind: 'file-missing', error: `File not in checkout: ${filePath}` }
    }
    const sha = await revParseHead(checkoutDir)
    return {
      ok: true,
      pointer: { owner, repo, ref, filePath, checkoutDir, fileAbsPath, baselineSha: sha ?? '', via: 'reused' },
    }
  }

  await fs.mkdir(path.dirname(checkoutDir), { recursive: true })

  // depth-1 at the ref for a branch/tag; full clone + checkout for a SHA
  // (git rejects `--branch <sha>`).
  let clone
  if (isLikelySha(ref)) {
    clone = await runClone({ url: cloneUrl, targetDir: checkoutDir })
    if (clone.ok) {
      const co = await execGit('git', ['checkout', ref], { cwd: checkoutDir })
      if (!co.ok) {
        await rmQuiet(checkoutDir)
        return { ok: false, errorKind: 'checkout-failed', error: co.stderr.trim() || `Could not checkout ${ref}.` }
      }
    }
  } else {
    clone = await runClone({ url: cloneUrl, targetDir: checkoutDir, depth: 1, ref })
  }

  if (!clone.ok) {
    await rmQuiet(checkoutDir)
    if (clone.errorKind === 'auth-missing') {
      return { ok: false, errorKind: 'auth-missing', error: clone.error ?? 'GitHub authentication required.' }
    }
    return { ok: false, errorKind: 'checkout-failed', error: clone.error ?? 'Clone failed.' }
  }

  if (!fssync.existsSync(fileAbsPath)) {
    // The repo cloned but the file isn't there at this ref (renamed/moved/typo).
    return { ok: false, errorKind: 'file-missing', error: `File not found in ${owner}/${repo} @ ${ref}: ${filePath}` }
  }

  const sha = await revParseHead(checkoutDir)
  return {
    ok: true,
    pointer: { owner, repo, ref, filePath, checkoutDir, fileAbsPath, baselineSha: sha ?? '', via: clone.via ?? 'git' },
  }
}

async function revParseHead(dir: string): Promise<string | null> {
  const res = await execGit('git', ['rev-parse', 'HEAD'], { cwd: dir })
  return res.ok ? res.stdout.trim() : null
}

/** Best-effort cleanup of a half-made checkout dir after a failed clone. */
async function rmQuiet(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
}
