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
  isForeignVault,
} from './detect'
// ENH-245 — the OKF generated-listing filename resolution (dual convention:
// `_index.md`/`_log.md` default, `index.md`/`log.md` legacy).
export { resolveIndexFilename, resolveLogFilename, OKF_INDEX_FILENAME_DEFAULT } from './okf-filenames'
// ENH-246 — the rendered-artifact output folder (dual convention: `output/`
// default, legacy `out/`).
export { resolveOutputDir, OUTPUT_DIR_DEFAULT } from './output-dir'
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
  seedObsidianAppJson,
  maybeSeedObsidianAppJson,
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
  bucketRows,
  filterErrorLines,
  type RenderTargetResult,
  type EvaluatedBase,
  type EvaluatedView,
  type BaseDef,
  type DeclaredGroup,
  type FilterError,
  type GroupBucket,
} from './render'
// ENH-229 phase 2 — rollup product layer (change-summary diff + embedding).
export {
  diffSnapshots,
  extractSnapshot,
  extractSummaryLog,
  prependSummary,
  type RollupSnapshot,
  type SummaryEntry,
  type RollupDiff,
} from './rollup'
// ENH-228 — the `type: rollup` lifecycle layer (discovery + provenance) and
// the inbox listing, the data contracts behind the Vault view + its CLI/IPC.
export {
  listRollups,
  resolveRollupNote,
  stampRollupProvenance,
  provenanceStamp,
  type RollupListing,
  type ResolvedRollupNote,
} from './rollup-notes'
export { listInbox, type InboxEntry } from './inbox'
// ENH-243 — the Rollups tab's builder layer (canonical base dialect + live
// view data + frontmatter flips). Shared by the GUI IPC handlers and the
// `duo rollup new|show|set|doctor` CLI verbs.
export {
  serializeBuilderBase,
  parseBuilderBase,
  createRollupNote,
  updateRollupNote,
  saveRollupNoteWithRename,
  setFrontmatterFields,
  entityPanel,
  rollupViewData,
  LINKS_TO_PROP,
  type RollupBuilderModel,
  type BuilderBucket,
  type BuilderFilter,
  type BuilderFilterOp,
  type CreateRollupResult,
  type SaveRollupResult,
  type EntityPanel,
  type EntityField,
  type FieldKind,
  type RollupViewData,
  type RollupViewRow,
} from './builder'
// ENH-244 — "Copy as Markdown" for a rollup (GitHub blob links when the
// vault is in a GitHub-remote repo, vault-relative links otherwise).
export { rollupMarkdownTable, type RollupMarkdownResult } from './rollup-markdown'
// ENH-250 — deterministic render+stamp shared by the Rollups tab's live-save
// and the rendered artifact's "Refresh" button (no Claude required).
export { renderAndStampRollup, type RenderRollupResult } from './rollup-render'
// ENH-248 — rollup lifecycle (R6), artifact introspection for the Duo-native
// toolbar (R2), ad-hoc type views (R7), GitHub link probing (R8).
export {
  deleteRollup,
  duplicateRollup,
  rollupArtifactInfo,
  type DeleteRollupResult,
  type DuplicateRollupResult,
  type RollupArtifactInfo,
} from './rollup-notes'
export { modelViewData } from './builder'
export { probeGitHubLinkBase, gitHubBlobUrl, type GitHubLinkBase } from './rollup-markdown'
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
  migrateFrontmatterLinks,
  type MoveResult,
  type RelinkResult,
  type MigrateFrontmatterLinksResult,
} from './move'
export {
  generateIndex,
  generateLog,
  writeListings,
  promoteSection,
} from './listings'
