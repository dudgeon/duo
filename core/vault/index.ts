// ENH-208 Vault — public API for the vault core (PR1+).
// One import surface for the CLI verbs (and Phase 3's renderer share).

export type {
  VaultFile,
  TypeTemplate,
  Corpus,
  VaultInfo,
  SearchHit,
} from './types'

export { walk, readNotes, parseFile, splitFrontmatter, extractWikilinks, SKIP_DIRS } from './parse'
export { isVaultRoot, findVaultRoot, listVaults, resolveVault } from './detect'
export {
  readDefaultVault,
  setDefaultVault,
  clearDefaultVault,
  resolveVaultOrDefault,
  DEFAULT_VAULT_FILE,
} from './default-vault'
export { buildCorpus, loadTemplates, parseBaseYaml } from './corpus'
export { backlinks, orphans, type Backlink } from './graph'
export { search } from './search'
export { initVault, captureNote, type InitResult, type CaptureResult } from './scaffold'
export {
  renderTarget,
  evaluateBaseDef,
  readCol,
  type RenderTargetResult,
  type EvaluatedBase,
  type EvaluatedView,
  type BaseDef,
} from './render'
export {
  lintVault,
  lintBaseDef,
  type LintFinding,
  type LintResult,
} from './lint'
export {
  buildEngineFiles,
  evalExpr,
  isEvalError,
  DuoDate,
  Link,
  defaultAsOf,
  type EngineFile,
} from './engine'
