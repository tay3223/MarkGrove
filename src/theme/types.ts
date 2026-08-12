/**
 * Theme system types (spec 002).
 *
 * Three-layer token hierarchy:
 *   Primitive Tokens → Semantic Tokens → Component Tokens → Semantic Recipes
 *
 * Token permissions (spec 002 §7.5):
 *   - protected:  skeleton layout, hit areas, hierarchy (only app upgrades)
 *   - preference: density, font scale, motion reduction (user settings)
 *   - themeable:  colors, fonts, radius, shadows, textures, icons (themes)
 */

import type { SemanticType, VisualFamily, NodeRole } from '../semantic/types';

// ─────────────────────────────────────────────────────────────────────────
// Token types
// ─────────────────────────────────────────────────────────────────────────

export type TokenType =
  | 'color'
  | 'length'
  | 'number'
  | 'font'
  | 'shadow'
  | 'enum'
  | 'asset';

export type TokenPermission = 'protected' | 'preference' | 'themeable';

/** A registered public token (spec 002 §7.7). */
export interface TokenDeclaration {
  /** Stable dot-separated name, e.g. "color.surface.default". */
  name: string;
  type: TokenType;
  /** Safe default value. */
  default: string | number;
  /** Fallback token name when this token is missing. */
  fallback: string | null;
  /** Whether themes can override this token. */
  themeable: boolean;
  /** Permission level. */
  permission: TokenPermission;
  /** Range, format, and safety constraints. */
  constraints: string;
  /** First schemaVersion this token appeared in. */
  introducedIn: number;
  /** Deprecated version, if any. */
  deprecatedIn: number | null;
  /** Replacement token name, if deprecated. */
  replacement: string | null;
  /** Visual semantic description (not a specific theme's appearance). */
  description: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Theme package
// ─────────────────────────────────────────────────────────────────────────

export type ThemeMode = 'light' | 'dark' | 'high-contrast';

export interface ThemeManifest {
  schemaVersion: number;
  id: string;
  name: string;
  version: string;
  author: string;
  /** Parent theme ID for inheritance. */
  inherits: string | null;
  modes: ThemeMode[];
  skeletonVersion: number;
  license: string;
}

/** A theme package = manifest + token values for each mode. */
export interface ThemePackage {
  manifest: ThemeManifest;
  /** Token values for each mode. */
  tokens: Partial<Record<ThemeMode, Record<string, string | number>>>;
  /** Recommended density (preference, not forced). */
  recommendedDensity?: 'compact' | 'comfortable' | 'spacious';
}

/** A flattened, immutable theme snapshot ready for consumption. */
export interface ThemeSnapshot {
  themeId: string;
  mode: ThemeMode;
  /** Flattened token name → resolved value. */
  tokens: ReadonlyMap<string, string | number>;
}

// ─────────────────────────────────────────────────────────────────────────
// Node style resolution (spec 002 §7.6)
// ─────────────────────────────────────────────────────────────────────────

export type Density = 'compact' | 'comfortable' | 'spacious';

export interface AccessibilityPreferences {
  reducedMotion: boolean;
  highContrast: boolean;
  reducedTransparency: boolean;
  fontScale: number; // 1.0 = 100%
}

export interface NodeStateSet {
  default: boolean;
  hovered: boolean;
  selected: boolean;
  focused: boolean;
  editing: boolean;
  dragging: boolean;
  dropAllowed: boolean;
  dropForbidden: boolean;
  collapsed: boolean;
  loading: boolean;
  dirty: boolean;
  warning: boolean;
  error: boolean;
  readonly: boolean;
  searchMatch: boolean;
}

/** Input to the style resolver (spec 002 §7.6). */
export interface ResolveStyleInput {
  semanticType: SemanticType;
  visualFamily: VisualFamily;
  headingLevel?: number;
  role: NodeRole;
  states: Partial<NodeStateSet>;
  themeSnapshot: ThemeSnapshot;
  densityPreference: Density;
  accessibilityPreferences: AccessibilityPreferences;
}

/** Resolved style for a node container. */
export interface ResolvedNodeStyle {
  // Surface
  surfaceBackground: string;
  surfaceBorder: string;
  surfaceBorderWidth: string;
  surfaceRadius: string;
  // Accent
  accentColor: string;
  accentWidth: string;
  // Typography
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  textColor: string;
  // Spacing
  paddingX: string;
  paddingY: string;
  // Effects
  shadow: string;
  opacity: number;
  // State
  stateRingColor: string | null;
  stateRingWidth: string | null;
  // Texture
  textureEnabled: boolean;
  // Layout
  minWidth: string;
  maxWidth: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Texture contract (spec 002 §8)
// ─────────────────────────────────────────────────────────────────────────

export interface TextureDeclaration {
  id: string;
  source: string;
  type: 'solid' | 'gradient' | 'pattern' | 'image';
  repeatMode: 'no-repeat' | 'repeat' | 'repeat-x' | 'repeat-y' | 'space' | 'round';
  size: string;
  position: string;
  opacity: number;
  blendMode: string;
  fallbackColor: string;
  recommendedFor: string[];
}

// ─────────────────────────────────────────────────────────────────────────
// Icon contract (spec 002 §9)
// ─────────────────────────────────────────────────────────────────────────

export type SemanticIconName =
  | 'node.root'
  | 'node.heading'
  | 'node.paragraph'
  | 'node.list.ordered'
  | 'node.list.unordered'
  | 'node.task.checked'
  | 'node.task.unchecked'
  | 'node.quote'
  | 'node.code'
  | 'node.table'
  | 'node.image'
  | 'node.metadata'
  | 'node.extension'
  | 'node.footnote'
  | 'node.html'
  | 'node.math'
  | 'node.diagram'
  | 'node.callout'
  | 'node.unknown'
  | 'action.expand'
  | 'action.collapse'
  | 'action.edit'
  | 'action.open'
  | 'action.delete'
  | 'action.move'
  | 'state.warning'
  | 'state.error'
  | 'state.readonly'
  | 'state.loading'
  | 'state.dirty';

// ─────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────

export interface ThemeValidationResult {
  valid: boolean;
  errors: ThemeValidationError[];
  /** Performance grade: 'A' (best) to 'F' (worst). */
  performanceGrade: 'A' | 'B' | 'C' | 'D' | 'F';
}

export interface ThemeValidationError {
  code: string;
  message: string;
  tokenName?: string;
}
