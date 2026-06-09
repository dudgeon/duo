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
export { buildCorpus, loadTemplates, parseBaseYaml } from './corpus'
export { backlinks, orphans, type Backlink } from './graph'
export { search } from './search'
