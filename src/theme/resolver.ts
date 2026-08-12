/**
 * Node style resolver (spec 002 §7.6).
 *
 * Pure function: same inputs → same outputs.
 *
 * Resolution order (spec 002 §7.6):
 *   1. Read base container safe defaults
 *   2. Apply density and font scale preferences
 *   3. Select node visual family and semantic recipe
 *   4. Resolve themeable tokens from current theme snapshot
 *   5. Overlay node states
 *   6. Apply accessibility corrections (contrast, reduced motion, etc.)
 */

import type {
  ResolvedNodeStyle,
  ResolveStyleInput,
  NodeStateSet,
  ThemeSnapshot,
} from './types';
import type { SemanticType, VisualFamily } from '../semantic/types';
import { resolveToken } from './tokens';

// ─────────────────────────────────────────────────────────────────────────
// State priority (spec 002 §6.2)
// ─────────────────────────────────────────────────────────────────────────

const STATE_PRIORITY: Array<keyof NodeStateSet> = [
  'error',
  'dropForbidden',
  'editing',
  'focused',
  'selected',
  'searchMatch',
  'hovered',
  'default',
];

/** Get the highest-priority active state. */
function getActiveState(states: Partial<NodeStateSet>): keyof NodeStateSet | null {
  for (const state of STATE_PRIORITY) {
    if (states[state]) return state;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Semantic recipe: surface color by type (spec 002 §5)
// ─────────────────────────────────────────────────────────────────────────

function getSurfaceToken(type: SemanticType, family: VisualFamily): string {
  // Node-specific tokens → visual family → default (spec 002 §7.4)
  switch (type) {
    case 'root':
      return 'color.surface.root';
    case 'code':
      return 'color.surface.code';
    case 'quote':
      return 'color.surface.quote';
    case 'table':
      return 'color.surface.table';
    case 'image':
      return 'color.surface.image';
    case 'html':
      return 'color.surface.html';
    case 'metadata':
      return 'color.surface.metadata';
    default:
      break;
  }

  // Fall back to visual family
  switch (family) {
    case 'technical':
      return 'color.surface.technical';
    case 'media':
      return 'color.surface.media';
    case 'data':
      return 'color.surface.data';
    case 'notice':
      return 'color.surface.notice';
    case 'fallback':
      return 'color.surface.fallback';
    default:
      return 'color.surface.default';
  }
}

function getAccentToken(type: SemanticType, headingLevel?: number): string {
  switch (type) {
    case 'root':
      return 'color.accent.root';
    case 'heading':
      // H1/H2 → strong, H3/H4 → medium, H5/H6 → subtle (spec 002 §5.2)
      if (headingLevel && headingLevel <= 2) return 'color.accent.heading.strong';
      if (headingLevel && headingLevel <= 4) return 'color.accent.heading.medium';
      return 'color.accent.heading.subtle';
    case 'code':
      return 'color.accent.code';
    case 'quote':
      return 'color.accent.quote';
    case 'table':
      return 'color.accent.data';
    case 'image':
      return 'color.accent.media';
    case 'callout':
      return 'color.accent.notice';
    case 'paragraph':
    case 'list-item':
    case 'definition-item':
      return 'color.accent.text';
    default:
      return 'color.accent.root';
  }
}

function getFontSizeToken(type: SemanticType, headingLevel?: number): string {
  if (type === 'heading' && headingLevel) {
    return `typography.size.heading${headingLevel}`;
  }
  switch (type) {
    case 'root':
      return 'typography.size.heading1';
    case 'code':
      return 'typography.size.code';
    case 'paragraph':
    case 'list-item':
    case 'quote':
    case 'callout':
    case 'definition-item':
      return 'typography.size.body';
    default:
      return 'typography.size.body';
  }
}

function getFontWeightToken(type: SemanticType): string {
  switch (type) {
    case 'heading':
    case 'root':
      return 'typography.weight.heading';
    default:
      return 'typography.weight.body';
  }
}

function getFontFamilyToken(type: SemanticType, family: VisualFamily): string {
  if (type === 'code' || type === 'html' || family === 'technical') {
    return 'typography.family.mono';
  }
  return 'typography.family.sans';
}

function getMinWidthToken(type: SemanticType): string {
  switch (type) {
    case 'root':
      return 'layout.node.rootMinWidth';
    case 'code':
    case 'table':
    case 'image':
      return 'layout.node.wideMinWidth';
    default:
      return 'layout.node.minWidth';
  }
}

function getMaxWidthToken(type: SemanticType): string {
  switch (type) {
    case 'root':
      return 'layout.node.rootMaxWidth';
    case 'code':
    case 'table':
    case 'image':
      return 'layout.node.wideMaxWidth';
    default:
      return 'layout.node.maxWidth';
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Density resolution (spec 002 §4.1)
// ─────────────────────────────────────────────────────────────────────────

function getPaddingTokens(density: 'compact' | 'comfortable' | 'spacious'): { x: string; y: string } {
  return {
    x: `space.node.padding.${density}.x`,
    y: `space.node.padding.${density}.y`,
  };
}

function applyFontScale(value: string, scale: number): string {
  // Apply font scale to px values
  const match = /^(\d+(?:\.\d+)?)px$/.exec(value);
  if (match) {
    const px = parseFloat(match[1]) * scale;
    return `${px.toFixed(1)}px`;
  }
  return value;
}

// ─────────────────────────────────────────────────────────────────────────
// Main resolver (spec 002 §7.6)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Resolve the final style for a node container.
 *
 * This is a pure function: same inputs always produce same outputs.
 */
export function resolveNodeStyle(input: ResolveStyleInput): ResolvedNodeStyle {
  const { semanticType, visualFamily, headingLevel, role, states, themeSnapshot, densityPreference, accessibilityPreferences } = input;

  // Step 1: Read safe defaults
  const surfaceToken = getSurfaceToken(semanticType, visualFamily);
  const accentToken = getAccentToken(semanticType, headingLevel);
  const fontSizeToken = getFontSizeToken(semanticType, headingLevel);
  const fontWeightToken = getFontWeightToken(semanticType);
  const fontFamilyToken = getFontFamilyToken(semanticType, visualFamily);
  const minWidthToken = getMinWidthToken(semanticType);
  const maxWidthToken = getMaxWidthToken(semanticType);

  // Step 2: Apply density
  const paddingTokens = getPaddingTokens(densityPreference);

  // Step 3-4: Resolve tokens from theme snapshot
  let surfaceBackground = String(resolveToken(surfaceToken, themeSnapshot));
  let surfaceBorder = String(resolveToken('color.border.default', themeSnapshot));
  let surfaceBorderWidth = String(resolveToken('shape.borderWidth.default', themeSnapshot));
  let surfaceRadius = String(resolveToken(
    semanticType === 'root' ? 'shape.radius.root' : 'shape.radius.node',
    themeSnapshot,
  ));
  let accentColor = String(resolveToken(accentToken, themeSnapshot));
  let accentWidth = String(resolveToken('shape.borderWidth.accent', themeSnapshot));

  let fontFamily = String(resolveToken(fontFamilyToken, themeSnapshot));
  let fontSize = String(resolveToken(fontSizeToken, themeSnapshot));
  let fontWeight = String(resolveToken(fontWeightToken, themeSnapshot));
  let lineHeight = String(resolveToken(
    semanticType === 'code' ? 'typography.lineHeight.code' : 'typography.lineHeight.body',
    themeSnapshot,
  ));
  let textColor = String(resolveToken('color.text.primary', themeSnapshot));

  let paddingX = String(resolveToken(paddingTokens.x, themeSnapshot));
  let paddingY = String(resolveToken(paddingTokens.y, themeSnapshot));

  let shadow = String(resolveToken('effect.shadow.default', themeSnapshot));
  let opacity = 1;

  let minWidth = String(resolveToken(minWidthToken, themeSnapshot));
  let maxWidth = String(resolveToken(maxWidthToken, themeSnapshot));

  let textureEnabled = String(resolveToken('texture.surface.enabled', themeSnapshot)) === 'true';

  // Step 5: Overlay states
  const activeState = getActiveState(states);
  let stateRingColor: string | null = null;
  let stateRingWidth: string | null = null;

  if (states.error) {
    stateRingColor = String(resolveToken('color.state.error', themeSnapshot));
    stateRingWidth = String(resolveToken('shape.borderWidth.strong', themeSnapshot));
    surfaceBorder = String(resolveToken('color.state.error', themeSnapshot));
  } else if (states.dropForbidden) {
    stateRingColor = String(resolveToken('color.state.dropForbidden', themeSnapshot));
    stateRingWidth = String(resolveToken('shape.borderWidth.strong', themeSnapshot));
  } else if (states.editing) {
    surfaceBorder = String(resolveToken('color.border.strong', themeSnapshot));
    surfaceBorderWidth = String(resolveToken('shape.borderWidth.strong', themeSnapshot));
  } else if (states.focused) {
    stateRingColor = String(resolveToken('color.state.focused', themeSnapshot));
    stateRingWidth = String(resolveToken('shape.borderWidth.default', themeSnapshot));
  } else if (states.selected) {
    stateRingColor = String(resolveToken('color.state.selected', themeSnapshot));
    stateRingWidth = String(resolveToken('shape.borderWidth.strong', themeSnapshot));
  } else if (states.searchMatch) {
    stateRingColor = String(resolveToken('color.state.searchMatch', themeSnapshot));
    stateRingWidth = String(resolveToken('shape.borderWidth.default', themeSnapshot));
  }

  if (states.hovered && !states.selected && !states.error) {
    shadow = String(resolveToken('effect.shadow.hovered', themeSnapshot));
    surfaceBorder = String(resolveToken('color.border.strong', themeSnapshot));
  }

  if (states.dragging) {
    opacity = Number(resolveToken('effect.opacity.dragging', themeSnapshot));
  }

  if (states.readonly) {
    opacity = Math.min(opacity, 0.8);
  }

  // Collapsed: show indicator but keep readable
  // (no style change needed beyond what the container shows)

  // Step 6: Accessibility corrections
  if (accessibilityPreferences.highContrast) {
    // Force visible borders and disable textures
    surfaceBorder = String(resolveToken('color.border.strong', themeSnapshot));
    surfaceBorderWidth = '2px';
    textureEnabled = false;
    // Ensure state rings are always visible
    if (states.selected || states.focused || states.error) {
      stateRingWidth = '3px';
    }
  }

  if (accessibilityPreferences.reducedTransparency) {
    textureEnabled = false;
    opacity = 1;
  }

  if (accessibilityPreferences.reducedMotion) {
    // Motion tokens would be consumed by animation components, not here
    // But we ensure no motion-dependent opacity changes
  }

  // Font scale
  if (accessibilityPreferences.fontScale !== 1) {
    fontSize = applyFontScale(fontSize, accessibilityPreferences.fontScale);
  }

  return {
    surfaceBackground,
    surfaceBorder,
    surfaceBorderWidth,
    surfaceRadius,
    accentColor,
    accentWidth,
    fontFamily,
    fontSize,
    fontWeight: String(fontWeight),
    lineHeight: String(lineHeight),
    textColor,
    paddingX,
    paddingY,
    shadow,
    opacity,
    stateRingColor,
    stateRingWidth,
    textureEnabled,
    minWidth,
    maxWidth,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// CSS variable generation (spec 002 §15: root-level variables, not per-node)
// ─────────────────────────────────────────────────────────────────────────

/** Generate CSS custom properties from a theme snapshot for root-level application. */
export function generateCssVariables(snapshot: ThemeSnapshot): string {
  const entries: string[] = [];
  for (const [name, value] of snapshot.tokens) {
    // Convert dot notation to CSS variable name
    const cssName = `--${name.replace(/\./g, '-')}`;
    entries.push(`  ${cssName}: ${value};`);
  }
  return `:root {\n${entries.join('\n')}\n}`;
}
