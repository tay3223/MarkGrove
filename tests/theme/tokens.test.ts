/**
 * Token registry tests (spec 002 §7, §13.3).
 *
 * Verifies:
 *   - All registered tokens have required fields
 *   - Permission system (protected / preference / themeable)
 *   - Fallback chain resolution
 *   - Override validation (unknown tokens, injection, format, remote URLs)
 */

import { describe, it, expect } from 'vitest';
import {
  getTokenDeclaration,
  getAllTokens,
  getThemeableTokens,
  getProtectedTokens,
  getPreferenceTokens,
  resolveToken,
  getDefaultTokenMap,
} from '../../src/theme/tokens';
import { validateUserOverrides } from '../../src/theme/loader';
import type { TokenType, TokenPermission } from '../../src/theme/types';

const VALID_TOKEN_TYPES: TokenType[] = [
  'color',
  'length',
  'number',
  'font',
  'shadow',
  'enum',
  'asset',
];

const VALID_PERMISSIONS: TokenPermission[] = ['protected', 'preference', 'themeable'];

// ─────────────────────────────────────────────────────────────────────────
// Required fields (spec 002 §7.7)
// ─────────────────────────────────────────────────────────────────────────

describe('token registry — required fields', () => {
  it('all registered tokens have name, type, default, fallback, themeable, permission', () => {
    const tokens = getAllTokens();
    expect(tokens.length).toBeGreaterThan(0);

    for (const token of tokens) {
      expect(typeof token.name).toBe('string');
      expect(token.name.length).toBeGreaterThan(0);
      expect(VALID_TOKEN_TYPES).toContain(token.type);
      expect(token.default).toBeDefined();
      expect(token).toHaveProperty('fallback');
      expect(typeof token.themeable).toBe('boolean');
      expect(VALID_PERMISSIONS).toContain(token.permission);
    }
  });

  it('getTokenDeclaration returns the declaration for a known token', () => {
    const decl = getTokenDeclaration('color.canvas.background');
    expect(decl).toBeDefined();
    expect(decl!.name).toBe('color.canvas.background');
    expect(decl!.type).toBe('color');
    expect(decl!.default).toBe('#1e1e2e');
    expect(decl!.themeable).toBe(true);
    expect(decl!.permission).toBe('themeable');
  });

  it('getTokenDeclaration returns undefined for an unknown token', () => {
    expect(getTokenDeclaration('color.does.not.exist')).toBeUndefined();
  });

  it('getDefaultTokenMap contains every registered token with its default value', () => {
    const map = getDefaultTokenMap();
    const allTokens = getAllTokens();
    expect(map.size).toBe(allTokens.length);

    for (const token of allTokens) {
      expect(map.get(token.name)).toBe(token.default);
    }
  });

  it('every token has a non-empty description and constraints string', () => {
    for (const token of getAllTokens()) {
      expect(typeof token.description).toBe('string');
      expect(token.description.length).toBeGreaterThan(0);
      expect(typeof token.constraints).toBe('string');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Permission filtering (spec 002 §7.5)
// ─────────────────────────────────────────────────────────────────────────

describe('token registry — permission filtering', () => {
  it('getThemeableTokens returns only tokens with themeable=true', () => {
    const themeable = getThemeableTokens();
    expect(themeable.length).toBeGreaterThan(0);
    for (const token of themeable) {
      expect(token.themeable).toBe(true);
    }
  });

  it('getProtectedTokens returns only tokens with permission=protected', () => {
    const protectedTokens = getProtectedTokens();
    for (const token of protectedTokens) {
      expect(token.permission).toBe('protected');
    }
  });

  it('getPreferenceTokens returns only tokens with permission=preference', () => {
    const preference = getPreferenceTokens();
    expect(preference.length).toBeGreaterThan(0);
    for (const token of preference) {
      expect(token.permission).toBe('preference');
      expect(token.themeable).toBe(false);
    }
  });

  it('every token is in exactly one permission bucket', () => {
    const all = getAllTokens();
    const themeable = new Set(getThemeableTokens().map(t => t.name));
    const protectedSet = new Set(getProtectedTokens().map(t => t.name));
    const preference = new Set(getPreferenceTokens().map(t => t.name));

    for (const token of all) {
      const count =
        (themeable.has(token.name) ? 1 : 0) +
        (protectedSet.has(token.name) ? 1 : 0) +
        (preference.has(token.name) ? 1 : 0);
      expect(count).toBe(1);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Override validation — protected tokens (spec 002 §7.5, §13.3)
// ─────────────────────────────────────────────────────────────────────────

describe('override validation — protected tokens', () => {
  it('protected tokens cannot be overridden by user themes', () => {
    const protectedTokens = getProtectedTokens();
    // The registry may currently have zero protected tokens (layout/skeleton
    // tokens are preference-level). Regardless, every protected token — if
    // any — must be rejected by validateUserOverrides.
    for (const token of protectedTokens) {
      const result = validateUserOverrides({ [token.name]: 'override-value' });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'PROTECTED_TOKEN')).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Override validation — preference tokens (spec 002 §7.5, §13.3)
// ─────────────────────────────────────────────────────────────────────────

describe('override validation — preference tokens', () => {
  it('preference tokens cannot be overridden by user themes', () => {
    const preferenceTokens = getPreferenceTokens();
    expect(preferenceTokens.length).toBeGreaterThan(0);

    const token = preferenceTokens[0];
    const result = validateUserOverrides({ [token.name]: '999px' });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'PREFERENCE_TOKEN')).toBe(true);
    expect(result.errors.some(e => e.tokenName === token.name)).toBe(true);
  });

  it('preference token rejection includes a descriptive message', () => {
    const result = validateUserOverrides({ 'space.node.padding.compact.x': '999px' });
    expect(result.valid).toBe(false);
    const error = result.errors.find(e => e.code === 'PREFERENCE_TOKEN');
    expect(error).toBeDefined();
    expect(error!.message).toContain('space.node.padding.compact.x');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Override validation — themeable tokens (spec 002 §7.5, §13.3)
// ─────────────────────────────────────────────────────────────────────────

describe('override validation — themeable tokens', () => {
  it('themeable tokens can be overridden with valid values', () => {
    const result = validateUserOverrides({
      'color.canvas.background': '#ff0000',
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('multiple themeable tokens can be overridden at once', () => {
    const result = validateUserOverrides({
      'color.canvas.background': '#abcdef',
      'color.text.primary': 'rgb(10, 20, 30)',
      'shape.radius.node': '8px',
      'typography.family.sans': 'Helvetica, sans-serif',
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('empty overrides are valid', () => {
    const result = validateUserOverrides({});
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Fallback chain (spec 002 §7.4)
// ─────────────────────────────────────────────────────────────────────────

describe('fallback chain', () => {
  it('missing token resolves to fallback value when fallback is present in snapshot', () => {
    // color.surface.default has fallback 'color.canvas.background'
    const snapshot = {
      tokens: new Map<string, string | number>([
        ['color.canvas.background', '#abcdef'],
      ]),
    };
    // color.surface.default is missing -> falls back to color.canvas.background
    const result = resolveToken('color.surface.default', snapshot);
    expect(result).toBe('#abcdef');
  });

  it('missing token and missing fallback resolves to the fallback token default', () => {
    // Both color.surface.default and its fallback color.canvas.background are missing.
    // color.surface.default -> fallback color.canvas.background -> default '#1e1e2e'
    const snapshot = {
      tokens: new Map<string, string | number>(),
    };
    const result = resolveToken('color.surface.default', snapshot);
    expect(result).toBe('#1e1e2e');
  });

  it('direct token value takes priority over fallback', () => {
    const snapshot = {
      tokens: new Map<string, string | number>([
        ['color.surface.default', '#direct'],
        ['color.canvas.background', '#fallback'],
      ]),
    };
    const result = resolveToken('color.surface.default', snapshot);
    expect(result).toBe('#direct');
  });

  it('token with no fallback resolves to its own default when missing', () => {
    // color.canvas.background has fallback: null, default: '#1e1e2e'
    const snapshot = {
      tokens: new Map<string, string | number>(),
    };
    const result = resolveToken('color.canvas.background', snapshot);
    expect(result).toBe('#1e1e2e');
  });

  it('multi-level fallback chain traverses correctly', () => {
    // color.accent.heading.subtle -> fallback color.accent.heading.medium
    //   -> fallback color.accent.heading.strong -> fallback color.accent.root
    //   -> default '#89b4fa'
    const snapshot = {
      tokens: new Map<string, string | number>(),
    };
    const result = resolveToken('color.accent.heading.subtle', snapshot);
    expect(result).toBe('#89b4fa');
  });

  it('unknown token resolves to empty string', () => {
    const snapshot = {
      tokens: new Map<string, string | number>(),
    };
    const result = resolveToken('nonexistent.token', snapshot);
    expect(result).toBe('');
  });

  it('number-typed token resolves to its default when missing', () => {
    // effect.opacity.dragging has no fallback, default 0.7
    const snapshot = {
      tokens: new Map<string, string | number>(),
    };
    const result = resolveToken('effect.opacity.dragging', snapshot);
    expect(result).toBe(0.7);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Override validation — unknown tokens (spec 002 §13.3)
// ─────────────────────────────────────────────────────────────────────────

describe('override validation — unknown tokens', () => {
  it('unknown tokens are rejected by validateUserOverrides', () => {
    const result = validateUserOverrides({
      'color.does.not.exist': '#ff0000',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'UNKNOWN_TOKEN')).toBe(true);
  });

  it('unknown token error includes the token name', () => {
    const result = validateUserOverrides({
      'totally.fake.token': 'value',
    });
    const error = result.errors.find(e => e.code === 'UNKNOWN_TOKEN');
    expect(error).toBeDefined();
    expect(error!.tokenName).toBe('totally.fake.token');
  });

  it('mix of unknown and valid tokens reports only the unknown error', () => {
    const result = validateUserOverrides({
      'color.canvas.background': '#ff0000',
      'unknown.token': '#00ff00',
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe('UNKNOWN_TOKEN');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Override validation — JavaScript injection (spec 002 §13.3)
// ─────────────────────────────────────────────────────────────────────────

describe('override validation — JavaScript injection', () => {
  const injectionVectors: Array<{ name: string; value: string }> = [
    { name: 'javascript: protocol', value: 'javascript:alert(1)' },
    { name: 'expression() call', value: 'expression(alert(1))' },
    { name: '<script> tag', value: '<script>alert(1)</script>' },
  ];

  for (const { name, value } of injectionVectors) {
    it(`rejects ${name}`, () => {
      // Use a font token (free-form, no value validation) to isolate the injection check
      const result = validateUserOverrides({
        'typography.family.sans': value,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'INJECTION_ATTEMPT')).toBe(true);
    });
  }

  it('injection error includes the token name', () => {
    const result = validateUserOverrides({
      'typography.family.mono': 'javascript:evil()',
    });
    const error = result.errors.find(e => e.code === 'INJECTION_ATTEMPT');
    expect(error).toBeDefined();
    expect(error!.tokenName).toBe('typography.family.mono');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Override validation — remote URLs (spec 002 §13.3, §8.3)
// ─────────────────────────────────────────────────────────────────────────

describe('override validation — remote URLs', () => {
  it('rejects remote URLs (http://) in token values', () => {
    // Asset-type tokens have explicit http:// rejection in validateTokenValue.
    // Color tokens reject http:// values as invalid color format.
    // Either way, remote URLs must not pass validation.
    const result = validateUserOverrides({
      'color.canvas.background': 'http://evil.com/steal.png',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects remote URLs (https://) in token values', () => {
    const result = validateUserOverrides({
      'color.canvas.background': 'https://evil.com/steal.png',
    });
    expect(result.valid).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Override validation — format validation (spec 002 §13.3)
// ─────────────────────────────────────────────────────────────────────────

describe('override validation — format validation', () => {
  it('rejects invalid color format', () => {
    const result = validateUserOverrides({
      'color.canvas.background': 'not-a-color',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'INVALID_VALUE')).toBe(true);
  });

  it('rejects invalid length format', () => {
    const result = validateUserOverrides({
      'shape.radius.node': 'not-a-length',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'INVALID_VALUE')).toBe(true);
  });

  it('accepts valid 3-digit hex color', () => {
    const result = validateUserOverrides({ 'color.canvas.background': '#fff' });
    expect(result.valid).toBe(true);
  });

  it('accepts valid 6-digit hex color', () => {
    const result = validateUserOverrides({ 'color.canvas.background': '#aabbcc' });
    expect(result.valid).toBe(true);
  });

  it('accepts valid 8-digit hex color (with alpha)', () => {
    const result = validateUserOverrides({ 'color.canvas.background': '#aabbccff' });
    expect(result.valid).toBe(true);
  });

  it('accepts valid rgb() color', () => {
    const result = validateUserOverrides({ 'color.canvas.background': 'rgb(255, 0, 0)' });
    expect(result.valid).toBe(true);
  });

  it('accepts valid rgba() color', () => {
    const result = validateUserOverrides({ 'color.canvas.background': 'rgba(255, 0, 0, 0.5)' });
    expect(result.valid).toBe(true);
  });

  it('accepts valid hsl() color', () => {
    const result = validateUserOverrides({ 'color.canvas.background': 'hsl(120, 100%, 50%)' });
    expect(result.valid).toBe(true);
  });

  it('accepts named color', () => {
    const result = validateUserOverrides({ 'color.canvas.background': 'red' });
    expect(result.valid).toBe(true);
  });

  it('accepts valid length in px', () => {
    const result = validateUserOverrides({ 'shape.radius.node': '8px' });
    expect(result.valid).toBe(true);
  });

  it('accepts valid length in em', () => {
    const result = validateUserOverrides({ 'shape.radius.node': '1.5em' });
    expect(result.valid).toBe(true);
  });

  it('accepts valid length in rem', () => {
    const result = validateUserOverrides({ 'shape.radius.node': '2rem' });
    expect(result.valid).toBe(true);
  });

  it('accepts valid length in percent', () => {
    const result = validateUserOverrides({ 'shape.radius.node': '100%' });
    expect(result.valid).toBe(true);
  });

  it('rejects color with invalid hex characters', () => {
    const result = validateUserOverrides({ 'color.canvas.background': '#zzzzzz' });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'INVALID_VALUE')).toBe(true);
  });

  it('rejects length with non-numeric prefix', () => {
    const result = validateUserOverrides({ 'shape.radius.node': 'abc10px' });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'INVALID_VALUE')).toBe(true);
  });
});
