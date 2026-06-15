// ENH-208 Vault — public API for the vault core (PR1+).
// One import surface for the CLI verbs (and Phase 3's renderer share).

export type {
  VaultFile,
  TypeTemplate,
  Corpus,
  VaultInfo,
  SearchHit,
  VaultMode,
} from './types'

export { walk, readNotes, parseFile, splitFrontmatter, extractWikilinks, SKIP_DIRS } from './parse'
export {
  isVaultRoot,
  findVaultRoot,
  listVaults,
  resolveVault,
  detectVaultMode,
  readOkfVersion,
  findVaultWithMode,
} from './detect'
// ENH-216 — the single node-free link helper (core/markdown/vaultLinks.ts).
// Re-exported here so vault consumers import rel-path/slug/extract logic
// from one place and never reimplement it.
export {
  slugStem,
  targetKey,
  relLink,
  serializeOkfLink,
  serializeWikilink,
  linkSerializerFor,
  extractLinkRefs,
  extractLinkKeys,
  type LinkRef,
} from '../markdown/vaultLinks'
export {
  readDefaultVault,
  setDefaultVault,
  clearDefaultVault,
  rememberVault,
  listKnownVaults,
  resolveVaultOrDefault,
  resolveVaultForUi,
  DEFAULT_VAULT_FILE,
} from './default-vault'
export { buildCorpus, loadTemplates, parseBaseYaml } from './corpus'
export { backlinks, orphans, type Backlink } from './graph'
export { search, searchAsync, VAULT_SEARCH_DEFAULT_LIMIT } from './search'
export { initVault, captureNote, seedFrontmatterLines, type InitResult, type CaptureResult } from './scaffold'
export { stubPathFor, createEntityStub, createType, safeName, type StubResult, type CreateTypeResult } from './filing'
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
// ENH-216 OKF Vault Mode (Stage 1) — move / relink engine (D5/D10) and the
// static-listing + promote helpers (D8/D9). Surfaced to the Stage-2 CLI verbs.
export {
  moveNote,
  relinkVault,
  ensureNoteId,
  mdBacklinks,
  danglingMdLinks,
  type MoveResult,
  type RelinkResult,
} from './move'
export {
  generateIndex,
  generateLog,
  writeListings,
  promoteSection,
} from './listings'
