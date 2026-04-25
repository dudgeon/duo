// Duo design tokens — three warm directions
//
// Direction 1 — "Stationery" — safe evolution. Cream paper, ink, a single
//   warm functional accent. Quiet, professional, recognisably Duo.
// Direction 2 — "Atelier" — confident redesign. Same warmth + a stronger
//   typographic voice (serif chrome accents, bigger contrast between
//   surfaces). The recommended hero.
// Direction 3 — "Field Notebook" — bold rethink. Two-paper layout where
//   the terminal is "graph paper" and the working pane is "manuscript",
//   visually distinct so the must-lose ("terminal vs working too subtle")
//   is solved by texture, not just color.

const DUO_TOKENS = {
  // ─── Direction 1: Stationery ──────────────────────────────────────────
  stationery: {
    name: 'Stationery',
    tagline: 'Safe evolution · cream paper, single warm accent',
    light: {
      // Surfaces, warm grays
      paper: '#FAF7F0',         // primary surface, "page"
      paperDeep: '#F2EDE3',     // chrome, files pane, terminal pane bg
      paperEdge: '#E8E1D2',     // tab strip, subtle dividers
      paperRule: '#DDD4C2',     // hairlines
      ink: '#1F1A14',           // primary text
      inkSoft: '#4A4137',       // secondary
      inkMute: '#7A6F5E',       // tertiary, captions
      inkGhost: '#B5A993',      // disabled / placeholders
      accent: '#B5613A',        // terracotta
      accentSoft: '#E9C9B6',
      accentInk: '#7A3E20',
      mark: '#F4E5C8',          // selection / highlight (manuscript yellow)
      // Terminal canvas (cozy mode swaps in `paper`)
      termBg: '#1F1A14',
      termFg: '#F2EDE3',
      termCozyBg: '#FAF7F0',
      termCozyFg: '#1F1A14',
    },
    dark: {
      paper: '#1B1813',
      paperDeep: '#15120E',
      paperEdge: '#272219',
      paperRule: '#34291C',
      ink: '#F2EDE3',
      inkSoft: '#C9BEA8',
      inkMute: '#8C8270',
      inkGhost: '#5A5142',
      accent: '#D88862',
      accentSoft: '#3A2519',
      accentInk: '#F2C8B0',
      mark: '#3A2F18',
      termBg: '#0E0B07',
      termFg: '#E9DFC8',
      termCozyBg: '#1B1813',
      termCozyFg: '#F2EDE3',
    },
  },

  // ─── Direction 2: Atelier ─────────────────────────────────────────────
  atelier: {
    name: 'Atelier',
    tagline: 'Confident redesign · serif voice, layered papers, ochre',
    light: {
      paper: '#FBF8EE',
      paperDeep: '#F0E9D6',
      paperEdge: '#E5DCC1',
      paperRule: '#D4C8A6',
      ink: '#1A1410',
      inkSoft: '#3D352A',
      inkMute: '#7B6F58',
      inkGhost: '#B8AB8E',
      accent: '#C66A2E',         // warm ochre/amber
      accentSoft: '#F2D9B8',
      accentInk: '#7A3E1A',
      mark: '#F8E59C',
      termBg: '#1A1410',
      termFg: '#F0E9D6',
      termCozyBg: '#FBF8EE',
      termCozyFg: '#1A1410',
    },
    dark: {
      paper: '#1A1611',
      paperDeep: '#13100C',
      paperEdge: '#26201A',
      paperRule: '#352D23',
      ink: '#F0E9D6',
      inkSoft: '#C8BD9E',
      inkMute: '#8A7E66',
      inkGhost: '#5A5142',
      accent: '#E08F4A',
      accentSoft: '#3F2A18',
      accentInk: '#F2D2A8',
      mark: '#3F3318',
      termBg: '#0C0A07',
      termFg: '#E9DEC2',
      termCozyBg: '#1A1611',
      termCozyFg: '#F0E9D6',
    },
  },

  // ─── Direction 3: Field Notebook ─────────────────────────────────────
  fieldnotebook: {
    name: 'Field Notebook',
    tagline: 'Bold rethink · graph-paper terminal, manuscript working pane',
    light: {
      paper: '#F9F4E8',           // manuscript page
      paperDeep: '#EDE3CC',       // chrome
      paperEdge: '#DDD0B0',
      paperRule: '#C9B98F',
      ink: '#1C1812',
      inkSoft: '#3F3729',
      inkMute: '#7A6E51',
      inkGhost: '#B5A77E',
      accent: '#7C5A2E',          // sepia
      accentSoft: '#E5D2A8',
      accentInk: '#523818',
      mark: '#F2DC8C',
      termBg: '#FAF6E8',          // graph paper white-ish
      termFg: '#231D0E',
      termCozyBg: '#F9F4E8',
      termCozyFg: '#1C1812',
    },
    dark: {
      paper: '#181410',
      paperDeep: '#110E0A',
      paperEdge: '#241E16',
      paperRule: '#33291D',
      ink: '#F2EAD2',
      ink_soft: '#C8BC9C',
      inkSoft: '#C8BC9C',
      inkMute: '#8A7E62',
      inkGhost: '#5A5142',
      accent: '#D9A554',
      accentSoft: '#3A2A14',
      accentInk: '#F2D998',
      mark: '#3F3318',
      termBg: '#0A0805',
      termFg: '#E9DCB0',
      termCozyBg: '#181410',
      termCozyFg: '#F2EAD2',
    },
  },
};

// Type stacks — used across all directions; the chrome/body voice changes
// per direction via `chromeFamily` and `editorFamily` selectors.
const DUO_FONTS = {
  // Apple's bundled "New York" serif looks great as the chrome accent on
  // mac. We pair it with SF for body sans and JetBrains/SF Mono for term.
  serif: 'ui-serif, "New York", "Iowan Old Style", Charter, Georgia, serif',
  serifDisplay: '"New York", ui-serif, "Iowan Old Style", Charter, Georgia, serif',
  sans: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", sans-serif',
  sansDisplay: '"SF Pro Display", -apple-system, BlinkMacSystemFont, "Inter", sans-serif',
  mono: '"JetBrains Mono", "SF Mono", "Menlo", "Cascadia Code", ui-monospace, monospace',
};

// Per-direction voice — what voice do labels, breadcrumbs, chrome use?
const DUO_VOICE = {
  stationery:    { chrome: DUO_FONTS.sans,  chromeAccent: DUO_FONTS.sans,         editor: DUO_FONTS.serif },
  atelier:       { chrome: DUO_FONTS.sans,  chromeAccent: DUO_FONTS.serifDisplay, editor: DUO_FONTS.serif },
  fieldnotebook: { chrome: DUO_FONTS.serif, chromeAccent: DUO_FONTS.serifDisplay, editor: DUO_FONTS.serif },
};

// Convenience: build a CSS-vars style block for a direction+mode.
function tokensToVars(t) {
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [`--duo-${k}`, v]));
}

Object.assign(window, { DUO_TOKENS, DUO_FONTS, DUO_VOICE, tokensToVars });
