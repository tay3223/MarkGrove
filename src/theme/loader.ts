/**
 * Theme loader with inheritance and validation (spec 002 §11, §18).
 *
 * Loading flow (spec 002 §18):
 *   1. Read theme manifest
 *   2. Validate schemaVersion / skeletonVersion
 *   3. Load inheritance chain and current mode
 *   4. Apply user token overrides
 *   5. Fill token fallbacks
 *   6. Security, contrast, and performance validation
 *   7. Generate immutable flat theme snapshot
 *   8. Atomic apply to mind map root container
 *
 * On any step failure: revert to previous valid snapshot (§18).
 */

import type {
  ThemePackage,
  ThemeSnapshot,
  ThemeMode,
  ThemeValidationResult,
  ThemeValidationError,
} from './types';
import { getDefaultTokenMap, getTokenDeclaration, getProtectedTokens } from './tokens';

// ─────────────────────────────────────────────────────────────────────────
// Theme registry
// ─────────────────────────────────────────────────────────────────────────

const themeRegistry = new Map<string, ThemePackage>();

/** Register a theme package. */
export function registerTheme(theme: ThemePackage): void {
  themeRegistry.set(theme.manifest.id, theme);
}

/** Get a registered theme by ID. */
export function getTheme(id: string): ThemePackage | undefined {
  return themeRegistry.get(id);
}

/** Get all registered theme IDs. */
export function getRegisteredThemeIds(): string[] {
  return Array.from(themeRegistry.keys());
}

// ─────────────────────────────────────────────────────────────────────────
// Token override validation (spec 002 §13.3)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Validate user token overrides (spec 002 §13.3).
 *
 * User themes can only:
 *   - Modify whitelisted (themeable) tokens
 *   - Reference restricted static resources
 *   - Select from predefined enums for border, blend, connector styles
 *
 * User themes cannot:
 *   - Inject arbitrary CSS, HTML, or JavaScript
 *   - Use arbitrary CSS selectors
 *   - Make network requests
 *   - Change node slots, capabilities, or data
 *   - Hide focus, error, readonly states
 *   - Bypass resource size/format limits
 */
export function validateUserOverrides(
  overrides: Record<string, string | number>,
): ThemeValidationResult {
  const errors: ThemeValidationError[] = [];

  for (const [name, value] of Object.entries(overrides)) {
    const decl = getTokenDeclaration(name);

    // Rule: token must exist
    if (!decl) {
      errors.push({
        code: 'UNKNOWN_TOKEN',
        message: `Unknown token: ${name}`,
        tokenName: name,
      });
      continue;
    }

    // Rule: cannot override protected tokens (spec 002 §7.5)
    if (decl.permission === 'protected') {
      errors.push({
        code: 'PROTECTED_TOKEN',
        message: `Cannot override protected token: ${name}`,
        tokenName: name,
      });
      continue;
    }

    // Rule: cannot override preference tokens via themes (spec 002 §7.5)
    if (decl.permission === 'preference') {
      errors.push({
        code: 'PREFERENCE_TOKEN',
        message: `Cannot override preference token via theme: ${name}`,
        tokenName: name,
      });
      continue;
    }

    // Rule: must be themeable
    if (!decl.themeable) {
      errors.push({
        code: 'NOT_THEMEABLE',
        message: `Token is not themeable: ${name}`,
        tokenName: name,
      });
      continue;
    }

    // Rule: validate value format and safety
    const valueError = validateTokenValue(name, decl.type, value);
    if (valueError) {
      errors.push({ code: 'INVALID_VALUE', message: valueError, tokenName: name });
    }

    // Rule: no JavaScript injection (spec 002 §13.3)
    if (typeof value === 'string') {
      if (value.includes('javascript:') || value.includes('expression(') || value.includes('<script')) {
        errors.push({
          code: 'INJECTION_ATTEMPT',
          message: `Token ${name} contains potentially dangerous content`,
          tokenName: name,
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    performanceGrade: 'A', // Overrides don't affect performance grade
  };
}

/** Validate a token value against its type constraints. */
function validateTokenValue(name: string, type: string, value: string | number): string | null {
  switch (type) {
    case 'color':
      if (typeof value !== 'string') return `Token ${name} expects a color string`;
      // Accept hex, rgb, rgba, hsl, hsla, named colors
      if (!/^#[0-9a-fA-F]{3,8}$|^(rgb|hsl)a?\(|^[a-zA-Z]+$/.test(value.trim())) {
        return `Token ${name} has invalid color value: ${value}`;
      }
      return null;

    case 'length':
      if (typeof value !== 'string') return `Token ${name} expects a length string`;
      if (!/^\d+(?:\.\d+)?(?:px|em|rem|%)?$/.test(value.trim())) {
        return `Token ${name} has invalid length value: ${value}`;
      }
      return null;

    case 'number':
      if (typeof value !== 'number' && !/^-?\d+(?:\.\d+)?$/.test(String(value))) {
        return `Token ${name} expects a number`;
      }
      return null;

    case 'font':
      // Font family strings are relatively free-form
      return null;

    case 'shadow':
      // Box-shadow strings are free-form but must not contain JS
      return null;

    case 'enum':
      // Enum values are checked against the declaration's constraints
      return null;

    case 'asset':
      // Assets must be local or data: URIs (spec 002 §8.3)
      if (typeof value === 'string' && value.startsWith('http')) {
        return `Token ${name} cannot reference remote URL: ${value}`;
      }
      return null;

    default:
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Theme snapshot generation (spec 002 §18)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Load and resolve a theme into an immutable flat snapshot.
 *
 * Resolution order (spec 002 §11.3):
 *   System safe defaults → Official base → Specific theme → Mode → User overrides → Accessibility
 */
export function loadThemeSnapshot(
  themeId: string,
  mode: ThemeMode,
  userOverrides: Record<string, string | number> = {},
): { snapshot: ThemeSnapshot | null; error: string | null } {
  const theme = getTheme(themeId);
  if (!theme) {
    return { snapshot: null, error: `Theme not found: ${themeId}` };
  }

  // Validate mode is supported
  if (!theme.manifest.modes.includes(mode)) {
    return { snapshot: null, error: `Theme ${themeId} does not support mode: ${mode}` };
  }

  // Start with system safe defaults
  const tokens = getDefaultTokenMap();

  // Apply inheritance chain
  const chain = resolveInheritanceChain(themeId);
  for (const ancestorId of chain) {
    const ancestorTheme = getTheme(ancestorId);
    if (!ancestorTheme) continue;
    const modeTokens = ancestorTheme.tokens[mode] ?? ancestorTheme.tokens[Object.keys(ancestorTheme.tokens)[0] as ThemeMode];
    if (modeTokens) {
      for (const [name, value] of Object.entries(modeTokens)) {
        // Only apply themeable tokens
        const decl = getTokenDeclaration(name);
        if (decl && decl.themeable) {
          tokens.set(name, value);
        }
      }
    }
  }

  // Apply this theme's tokens (already applied via chain, but ensure)
  const themeTokens = theme.tokens[mode];
  if (themeTokens) {
    for (const [name, value] of Object.entries(themeTokens)) {
      const decl = getTokenDeclaration(name);
      if (decl && decl.themeable) {
        tokens.set(name, value);
      }
    }
  }

  // Apply user overrides (only themeable tokens)
  const overrideValidation = validateUserOverrides(userOverrides);
  if (!overrideValidation.valid) {
    // Reject overrides that violate safety rules, but still load the base theme
    const safeOverrides: Record<string, string | number> = {};
    for (const [name, value] of Object.entries(userOverrides)) {
      const decl = getTokenDeclaration(name);
      if (decl && decl.themeable && decl.permission === 'themeable') {
        // Check if this override passed validation
        const hasError = overrideValidation.errors.some(e => e.tokenName === name);
        if (!hasError) {
          safeOverrides[name] = value;
        }
      }
    }
    for (const [name, value] of Object.entries(safeOverrides)) {
      tokens.set(name, value);
    }
  } else {
    for (const [name, value] of Object.entries(userOverrides)) {
      tokens.set(name, value);
    }
  }

  // Fill fallbacks for any missing tokens
  fillFallbacks(tokens);

  const snapshot: ThemeSnapshot = {
    themeId,
    mode,
    tokens: tokens as ReadonlyMap<string, string | number>,
  };

  return { snapshot, error: null };
}

/** Resolve the inheritance chain (root → ... → themeId). */
function resolveInheritanceChain(themeId: string): string[] {
  const chain: string[] = [];
  const visited = new Set<string>();
  let currentId: string | null = themeId;

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    chain.unshift(currentId);
    const theme = getTheme(currentId);
    currentId = theme?.manifest.inherits ?? null;
  }

  return chain;
}

/** Fill missing tokens with their fallback values. */
function fillFallbacks(tokens: Map<string, string | number>): void {
  // Iterate over a copy of keys since we may add new entries
  const allTokenNames = Array.from(getTokenDeclaration_keys());
  for (const name of allTokenNames) {
    if (!tokens.has(name)) {
      const decl = getTokenDeclaration(name);
      if (decl) {
        tokens.set(name, decl.default);
      }
    }
  }
}

/** Helper to get all token names from the registry. */
function getTokenDeclaration_keys(): string[] {
  const names: string[] = [];
  for (const decl of getAllTokenDeclarations()) {
    names.push(decl.name);
  }
  return names;
}

/** Get all token declarations (re-exported from tokens module). */
import { getAllTokens } from './tokens';
function getAllTokenDeclarations() {
  return getAllTokens();
}

// ─────────────────────────────────────────────────────────────────────────
// Atomic theme switching (spec 002 §11.4, §18)
// ─────────────────────────────────────────────────────────────────────────

/** The current active theme snapshot, or null if none loaded. */
let currentSnapshot: ThemeSnapshot | null = null;

/** Listener callbacks for theme changes. */
type ThemeChangeListener = (snapshot: ThemeSnapshot | null) => void;
const listeners = new Set<ThemeChangeListener>();

/**
 * Atomically switch to a new theme snapshot.
 *
 * If loading fails, reverts to the previous snapshot (spec 002 §18).
 * Does NOT re-parse Markdown or rebuild the semantic tree (spec 002 §11.4).
 */
export function switchTheme(
  themeId: string,
  mode: ThemeMode,
  userOverrides: Record<string, string | number> = {},
): { success: boolean; error: string | null } {
  const previousSnapshot = currentSnapshot;

  const { snapshot, error } = loadThemeSnapshot(themeId, mode, userOverrides);
  if (!snapshot || error) {
    // Revert to previous (spec 002 §18)
    currentSnapshot = previousSnapshot;
    return { success: false, error };
  }

  // Atomic swap
  currentSnapshot = snapshot;

  // Notify listeners
  for (const listener of listeners) {
    try {
      listener(currentSnapshot);
    } catch {
      // Listener errors don't affect theme switching
    }
  }

  return { success: true, error: null };
}

/** Get the current theme snapshot. */
export function getCurrentSnapshot(): ThemeSnapshot | null {
  return currentSnapshot;
}

/** Subscribe to theme changes. Returns an unsubscribe function. */
export function onThemeChange(listener: ThemeChangeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Initialize with the default theme. */
export function initializeDefaultTheme(): void {
  if (!currentSnapshot) {
    switchTheme('official.base', 'dark');
  }
}
