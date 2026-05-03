// Renderer-side re-export so call sites under renderer/ keep their
// existing import path. The canonical implementation lives in
// `shared/html-boilerplate.ts` so the main process (`duo html new`
// socket handler) and the renderer (⌘N + `.html` commit) draw from one
// skeleton.
export { htmlBoilerplate } from '@shared/html-boilerplate'
