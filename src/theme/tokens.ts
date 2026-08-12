/**
 * Public token registry (spec 002 §7.7).
 *
 * Every public token must be registered here with:
 *   name, type, default, fallback, themeable, permission, constraints,
 *   introducedIn, deprecatedIn, replacement, description
 *
 * Components only consume registered tokens; no ad-hoc CSS variables.
 */

import type { TokenDeclaration, TokenType, TokenPermission } from './types';

// ─────────────────────────────────────────────────────────────────────────
// Token registry
// ─────────────────────────────────────────────────────────────────────────

const registry = new Map<string, TokenDeclaration>();

/** Register a public token. */
function registerToken(
  name: string,
  type: TokenType,
  defaultValue: string | number,
  fallback: string | null,
  themeable: boolean,
  permission: TokenPermission,
  constraints: string,
  description: string,
  introducedIn = 1,
): void {
  registry.set(name, {
    name,
    type,
    default: defaultValue,
    fallback,
    themeable,
    permission,
    constraints,
    introducedIn,
    deprecatedIn: null,
    replacement: null,
    description,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Color: Canvas (spec 002 §7.2)
// ─────────────────────────────────────────────────────────────────────────

registerToken('color.canvas.background', 'color', '#1e1e2e', null, true, 'themeable', 'Any CSS color', 'Canvas background');
registerToken('color.canvas.grid', 'color', '#313244', null, true, 'themeable', 'Any CSS color', 'Canvas grid line color');
registerToken('color.canvas.gridOpacity', 'number', 0.3, null, true, 'themeable', '0–1', 'Canvas grid opacity');

// ─────────────────────────────────────────────────────────────────────────
// Color: Surface (spec 002 §7.2)
// ─────────────────────────────────────────────────────────────────────────

registerToken('color.surface.default', 'color', '#313244', 'color.canvas.background', true, 'themeable', 'Any CSS color', 'Default node surface');
registerToken('color.surface.root', 'color', '#45475a', 'color.surface.default', true, 'themeable', 'Any CSS color', 'Root node surface');
registerToken('color.surface.code', 'color', '#11111b', 'color.surface.default', true, 'themeable', 'Any CSS color', 'Code node surface');
registerToken('color.surface.quote', 'color', '#313244', 'color.surface.default', true, 'themeable', 'Any CSS color', 'Quote node surface');
registerToken('color.surface.table', 'color', '#313244', 'color.surface.default', true, 'themeable', 'Any CSS color', 'Table node surface');
registerToken('color.surface.image', 'color', '#313244', 'color.surface.default', true, 'themeable', 'Any CSS color', 'Image node surface');
registerToken('color.surface.html', 'color', '#11111b', 'color.surface.code', true, 'themeable', 'Any CSS color', 'HTML node surface');
registerToken('color.surface.metadata', 'color', '#181825', 'color.surface.default', true, 'themeable', 'Any CSS color', 'Metadata node surface');
registerToken('color.surface.technical', 'color', '#11111b', 'color.surface.default', true, 'themeable', 'Any CSS color', 'Technical family surface');
registerToken('color.surface.media', 'color', '#313244', 'color.surface.default', true, 'themeable', 'Any CSS color', 'Media family surface');
registerToken('color.surface.data', 'color', '#313244', 'color.surface.default', true, 'themeable', 'Any CSS color', 'Data family surface');
registerToken('color.surface.notice', 'color', '#313244', 'color.surface.default', true, 'themeable', 'Any CSS color', 'Notice family surface');
registerToken('color.surface.fallback', 'color', '#313244', 'color.surface.default', true, 'themeable', 'Any CSS color', 'Fallback/unknown surface');

// ─────────────────────────────────────────────────────────────────────────
// Color: Text (spec 002 §7.2)
// ─────────────────────────────────────────────────────────────────────────

registerToken('color.text.primary', 'color', '#cdd6f4', null, true, 'themeable', 'Any CSS color, must meet WCAG AA', 'Primary text');
registerToken('color.text.secondary', 'color', '#a6adc8', 'color.text.primary', true, 'themeable', 'Any CSS color', 'Secondary text');
registerToken('color.text.muted', 'color', '#6c7086', 'color.text.secondary', true, 'themeable', 'Any CSS color', 'Muted/placeholder text');
registerToken('color.text.inverse', 'color', '#1e1e2e', null, true, 'themeable', 'Any CSS color', 'Inverse text (on colored bg)');

// ─────────────────────────────────────────────────────────────────────────
// Color: Border (spec 002 §7.2)
// ─────────────────────────────────────────────────────────────────────────

registerToken('color.border.default', 'color', '#45475a', null, true, 'themeable', 'Any CSS color', 'Default border');
registerToken('color.border.strong', 'color', '#585b70', 'color.border.default', true, 'themeable', 'Any CSS color', 'Strong border');
registerToken('color.border.subtle', 'color', '#313244', 'color.border.default', true, 'themeable', 'Any CSS color', 'Subtle border');

// ─────────────────────────────────────────────────────────────────────────
// Color: Accent (spec 002 §7.2)
// ─────────────────────────────────────────────────────────────────────────

registerToken('color.accent.root', 'color', '#89b4fa', null, true, 'themeable', 'Any CSS color', 'Root accent');
registerToken('color.accent.heading.strong', 'color', '#89b4fa', 'color.accent.root', true, 'themeable', 'Any CSS color', 'H1/H2 accent');
registerToken('color.accent.heading.medium', 'color', '#cba6f7', 'color.accent.heading.strong', true, 'themeable', 'Any CSS color', 'H3/H4 accent');
registerToken('color.accent.heading.subtle', 'color', '#a6adc8', 'color.accent.heading.medium', true, 'themeable', 'Any CSS color', 'H5/H6 accent');
registerToken('color.accent.text', 'color', '#bac2de', 'color.text.primary', true, 'themeable', 'Any CSS color', 'Text content accent');
registerToken('color.accent.code', 'color', '#fab387', 'color.accent.root', true, 'themeable', 'Any CSS color', 'Code accent');
registerToken('color.accent.quote', 'color', '#bb9af7', 'color.accent.root', true, 'themeable', 'Any CSS color', 'Quote accent');
registerToken('color.accent.data', 'color', '#94e2d5', 'color.accent.root', true, 'themeable', 'Any CSS color', 'Data/table accent');
registerToken('color.accent.media', 'color', '#f9e2af', 'color.accent.root', true, 'themeable', 'Any CSS color', 'Image/media accent');
registerToken('color.accent.notice', 'color', '#f9e2af', 'color.accent.root', true, 'themeable', 'Any CSS color', 'Notice/callout accent');

// ─────────────────────────────────────────────────────────────────────────
// Color: State (spec 002 §7.2)
// ─────────────────────────────────────────────────────────────────────────

registerToken('color.state.selected', 'color', '#89b4fa', null, true, 'themeable', 'Any CSS color', 'Selection ring');
registerToken('color.state.focused', 'color', '#f5e0dc', 'color.state.selected', true, 'themeable', 'Any CSS color', 'Keyboard focus ring');
registerToken('color.state.success', 'color', '#a6e3a1', null, true, 'themeable', 'Any CSS color', 'Success state');
registerToken('color.state.warning', 'color', '#f9e2af', null, true, 'themeable', 'Any CSS color', 'Warning state');
registerToken('color.state.error', 'color', '#f38ba8', null, true, 'themeable', 'Any CSS color', 'Error state');
registerToken('color.state.disabled', 'color', '#6c7086', null, true, 'themeable', 'Any CSS color', 'Disabled state');
registerToken('color.state.searchMatch', 'color', '#f9e2af', 'color.state.warning', true, 'themeable', 'Any CSS color', 'Search match highlight');
registerToken('color.state.dropAllowed', 'color', '#a6e3a1', 'color.state.success', true, 'themeable', 'Any CSS color', 'Drop allowed indicator');
registerToken('color.state.dropForbidden', 'color', '#f38ba8', 'color.state.error', true, 'themeable', 'Any CSS color', 'Drop forbidden indicator');

// ─────────────────────────────────────────────────────────────────────────
// Color: Syntax highlighting (spec 002 §7.2)
// ─────────────────────────────────────────────────────────────────────────

registerToken('color.syntax.keyword', 'color', '#cba6f7', null, true, 'themeable', 'Any CSS color', 'Code keyword');
registerToken('color.syntax.string', 'color', '#a6e3a1', null, true, 'themeable', 'Any CSS color', 'Code string');
registerToken('color.syntax.comment', 'color', '#6c7086', null, true, 'themeable', 'Any CSS color', 'Code comment');
registerToken('color.syntax.number', 'color', '#fab387', null, true, 'themeable', 'Any CSS color', 'Code number');
registerToken('color.syntax.function', 'color', '#89b4fa', null, true, 'themeable', 'Any CSS color', 'Code function');
registerToken('color.syntax.variable', 'color', '#f38ba8', null, true, 'themeable', 'Any CSS color', 'Code variable');
registerToken('color.syntax.plain', 'color', '#cdd6f4', 'color.text.primary', true, 'themeable', 'Any CSS color', 'Code plain text (fallback)');

// ─────────────────────────────────────────────────────────────────────────
// Typography (spec 002 §7.2)
// ─────────────────────────────────────────────────────────────────────────

registerToken('typography.family.sans', 'font', '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', null, true, 'themeable', 'CSS font-family', 'Sans-serif font');
registerToken('typography.family.mono', 'font', '"SF Mono", "Fira Code", Menlo, monospace', null, true, 'themeable', 'CSS font-family', 'Monospace font');
registerToken('typography.family.serif', 'font', 'Georgia, "Times New Roman", serif', null, true, 'themeable', 'CSS font-family', 'Serif font');

registerToken('typography.size.root', 'length', '14px', null, false, 'preference', 'CSS length, 10–24px', 'Root font size');
registerToken('typography.size.heading1', 'length', '16px', null, true, 'themeable', 'CSS length', 'H1 font size');
registerToken('typography.size.heading2', 'length', '15px', null, true, 'themeable', 'CSS length', 'H2 font size');
registerToken('typography.size.heading3', 'length', '14px', null, true, 'themeable', 'CSS length', 'H3 font size');
registerToken('typography.size.heading4', 'length', '13px', null, true, 'themeable', 'CSS length', 'H4 font size');
registerToken('typography.size.heading5', 'length', '12px', null, true, 'themeable', 'CSS length', 'H5 font size');
registerToken('typography.size.heading6', 'length', '12px', null, true, 'themeable', 'CSS length', 'H6 font size');
registerToken('typography.size.body', 'length', '12px', null, true, 'themeable', 'CSS length', 'Body text font size');
registerToken('typography.size.code', 'length', '11px', null, true, 'themeable', 'CSS length', 'Code font size');
registerToken('typography.size.eyebrow', 'length', '10px', null, true, 'themeable', 'CSS length', 'Eyebrow label font size');
registerToken('typography.size.summary', 'length', '11px', null, true, 'themeable', 'CSS length', 'Summary text font size');

registerToken('typography.weight.heading', 'number', 600, null, true, 'themeable', '100–900', 'Heading font weight');
registerToken('typography.weight.body', 'number', 400, null, true, 'themeable', '100–900', 'Body font weight');
registerToken('typography.weight.eyebrow', 'number', 500, null, true, 'themeable', '100–900', 'Eyebrow font weight');

registerToken('typography.lineHeight.heading', 'number', 1.3, null, true, 'themeable', '1–2', 'Heading line height');
registerToken('typography.lineHeight.body', 'number', 1.5, null, true, 'themeable', '1–2', 'Body line height');
registerToken('typography.lineHeight.code', 'number', 1.4, null, true, 'themeable', '1–2', 'Code line height');

// ─────────────────────────────────────────────────────────────────────────
// Shape (spec 002 §7.2)
// ─────────────────────────────────────────────────────────────────────────

registerToken('shape.radius.node', 'length', '6px', null, true, 'themeable', 'CSS length, 0–32px', 'Node border radius');
registerToken('shape.radius.root', 'length', '8px', 'shape.radius.node', true, 'themeable', 'CSS length', 'Root node radius');
registerToken('shape.radius.preview', 'length', '4px', 'shape.radius.node', true, 'themeable', 'CSS length', 'Preview area radius');

registerToken('shape.borderWidth.default', 'length', '1px', null, true, 'themeable', 'CSS length', 'Default border width');
registerToken('shape.borderWidth.strong', 'length', '2px', 'shape.borderWidth.default', true, 'themeable', 'CSS length', 'Strong border width');
registerToken('shape.borderWidth.accent', 'length', '3px', 'shape.borderWidth.default', true, 'themeable', 'CSS length', 'Accent bar width');

// ─────────────────────────────────────────────────────────────────────────
// Space (spec 002 §7.2, §4.1)
// ─────────────────────────────────────────────────────────────────────────

registerToken('space.node.padding.compact.x', 'length', '10px', null, false, 'preference', 'CSS length, min 6px', 'Compact horizontal padding');
registerToken('space.node.padding.compact.y', 'length', '6px', null, false, 'preference', 'CSS length, min 4px', 'Compact vertical padding');
registerToken('space.node.padding.comfortable.x', 'length', '12px', null, false, 'preference', 'CSS length', 'Comfortable horizontal padding');
registerToken('space.node.padding.comfortable.y', 'length', '8px', null, false, 'preference', 'CSS length', 'Comfortable vertical padding');
registerToken('space.node.padding.spacious.x', 'length', '16px', null, false, 'preference', 'CSS length', 'Spacious horizontal padding');
registerToken('space.node.padding.spacious.y', 'length', '10px', null, false, 'preference', 'CSS length', 'Spacious vertical padding');

registerToken('space.node.gap.compact', 'length', '6px', null, false, 'preference', 'CSS length', 'Compact node gap');
registerToken('space.node.gap.comfortable', 'length', '8px', null, false, 'preference', 'CSS length', 'Comfortable node gap');
registerToken('space.node.gap.spacious', 'length', '12px', null, false, 'preference', 'CSS length', 'Spacious node gap');

registerToken('space.tree.gap.compact', 'length', '36px', null, false, 'preference', 'CSS length', 'Compact tree gap');
registerToken('space.tree.gap.comfortable', 'length', '48px', null, false, 'preference', 'CSS length', 'Comfortable tree gap');
registerToken('space.tree.gap.spacious', 'length', '64px', null, false, 'preference', 'CSS length', 'Spacious tree gap');

// ─────────────────────────────────────────────────────────────────────────
// Effect (spec 002 §7.2)
// ─────────────────────────────────────────────────────────────────────────

registerToken('effect.shadow.default', 'shadow', '0 1px 3px rgba(0,0,0,0.2)', null, true, 'themeable', 'CSS box-shadow', 'Default node shadow');
registerToken('effect.shadow.hovered', 'shadow', '0 2px 8px rgba(0,0,0,0.3)', 'effect.shadow.default', true, 'themeable', 'CSS box-shadow', 'Hovered node shadow');
registerToken('effect.shadow.selected', 'shadow', '0 0 0 2px var(--color-state-selected)', 'effect.shadow.default', true, 'themeable', 'CSS box-shadow', 'Selected node shadow');

registerToken('effect.opacity.disabled', 'number', 0.5, null, true, 'themeable', '0–1', 'Disabled opacity');
registerToken('effect.opacity.dragging', 'number', 0.7, null, true, 'themeable', '0–1', 'Dragging opacity');

registerToken('effect.motion.duration', 'number', 150, null, true, 'themeable', '0–1000ms', 'Animation duration (ms)');
registerToken('effect.motion.easing', 'enum', 'ease-out', null, true, 'themeable', 'CSS easing function', 'Animation easing');

// ─────────────────────────────────────────────────────────────────────────
// Texture (spec 002 §8)
// ─────────────────────────────────────────────────────────────────────────

registerToken('texture.canvas.enabled', 'enum', 'false', null, true, 'themeable', 'boolean', 'Enable canvas texture');
registerToken('texture.canvas.opacity', 'number', 0.05, null, true, 'themeable', '0–0.3', 'Canvas texture opacity');
registerToken('texture.surface.enabled', 'enum', 'false', null, true, 'themeable', 'boolean', 'Enable surface texture');
registerToken('texture.surface.opacity', 'number', 0.03, null, true, 'themeable', '0–0.2', 'Surface texture opacity');

// ─────────────────────────────────────────────────────────────────────────
// Connector / line (spec 002 §10.1)
// ─────────────────────────────────────────────────────────────────────────

registerToken('connector.color', 'color', '#585b70', null, true, 'themeable', 'Any CSS color', 'Connector line color');
registerToken('connector.width', 'length', '2px', null, true, 'themeable', 'CSS length, 1–4px', 'Connector line width');
registerToken('connector.opacity', 'number', 0.7, null, true, 'themeable', '0–1', 'Connector opacity');
registerToken('connector.selectedColor', 'color', '#89b4fa', 'connector.color', true, 'themeable', 'Any CSS color', 'Selected connector color');
registerToken('connector.style', 'enum', 'orthogonal', null, true, 'themeable', 'orthogonal|curve|straight', 'Connector routing style');

// ─────────────────────────────────────────────────────────────────────────
// Icon (spec 002 §9)
// ─────────────────────────────────────────────────────────────────────────

registerToken('icon.family', 'enum', 'lucide', null, true, 'themeable', 'lucide|feather|custom', 'Icon family');
registerToken('icon.size', 'length', '16px', null, true, 'themeable', 'CSS length, 12–24px', 'Icon size');
registerToken('icon.strokeWidth', 'number', 2, null, true, 'themeable', '1–3', 'Icon stroke width');

// ─────────────────────────────────────────────────────────────────────────
// Node width (spec 002 §4.2)
// ─────────────────────────────────────────────────────────────────────────

registerToken('layout.node.minWidth', 'length', '96px', null, false, 'preference', 'CSS length, min 80px', 'Node minimum width');
registerToken('layout.node.maxWidth', 'length', '280px', null, false, 'preference', 'CSS length', 'Node maximum width');
registerToken('layout.node.wideMinWidth', 'length', '160px', null, false, 'preference', 'CSS length', 'Wide node min width');
registerToken('layout.node.wideMaxWidth', 'length', '420px', null, false, 'preference', 'CSS length', 'Wide node max width');
registerToken('layout.node.rootMinWidth', 'length', '140px', null, false, 'preference', 'CSS length', 'Root node min width');
registerToken('layout.node.rootMaxWidth', 'length', '360px', null, false, 'preference', 'CSS length', 'Root node max width');

// ─────────────────────────────────────────────────────────────────────────
// Registry access
// ─────────────────────────────────────────────────────────────────────────

/** Get a token declaration by name. */
export function getTokenDeclaration(name: string): TokenDeclaration | undefined {
  return registry.get(name);
}

/** Get all registered tokens. */
export function getAllTokens(): TokenDeclaration[] {
  return Array.from(registry.values());
}

/** Get all themeable tokens. */
export function getThemeableTokens(): TokenDeclaration[] {
  return getAllTokens().filter(t => t.themeable);
}

/** Get all protected tokens. */
export function getProtectedTokens(): TokenDeclaration[] {
  return getAllTokens().filter(t => t.permission === 'protected');
}

/** Get all preference tokens. */
export function getPreferenceTokens(): TokenDeclaration[] {
  return getAllTokens().filter(t => t.permission === 'preference');
}

/**
 * Resolve a token value through its fallback chain (spec 002 §7.4).
 *
 * Chain: node-specific → visual family → generic node → safe default
 */
export function resolveToken(
  name: string,
  snapshot: { tokens: ReadonlyMap<string, string | number> },
): string | number {
  // Try direct lookup
  const direct = snapshot.tokens.get(name);
  if (direct !== undefined) return direct;

  // Follow fallback chain
  const decl = registry.get(name);
  if (decl) {
    if (decl.fallback) {
      return resolveToken(decl.fallback, snapshot);
    }
    return decl.default;
  }

  // Unknown token: return empty string
  return '';
}

/** Get all default token values as a map (for the base theme). */
export function getDefaultTokenMap(): Map<string, string | number> {
  const map = new Map<string, string | number>();
  for (const decl of registry.values()) {
    map.set(decl.name, decl.default);
  }
  return map;
}
