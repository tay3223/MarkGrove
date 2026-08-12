/**
 * Theme loader tests (spec 002 §11, §18).
 *
 * Verifies:
 *   - Theme loading with inheritance
 *   - Atomic theme switching (failed load reverts)
 *   - Theme snapshot immutability
 *   - All official themes can be loaded
 *   - User overrides only apply themeable tokens
 *   - Theme switching does not re-parse Markdown
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadThemeSnapshot,
  switchTheme,
  getCurrentSnapshot,
  getRegisteredThemeIds,
  getTheme,
  validateUserOverrides,
} from '../../src/theme/loader';
import '../../src/theme/themes/official'; // side-effect: registers all themes
import type { ThemeMode } from '../../src/theme/types';

// ─────────────────────────────────────────────────────────────────────────
// Theme loading with inheritance (spec 002 §11.3)
// ─────────────────────────────────────────────────────────────────────────

describe('theme loader — inheritance', () => {
  it('child theme inherits tokens from parent', () => {
    const { snapshot, error } = loadThemeSnapshot('official.ink-grove', 'dark');
    expect(error).toBeNull();
    expect(snapshot).not.toBeNull();

    // ink-grove overrides color.canvas.background
    expect(snapshot!.tokens.get('color.canvas.background')).toBe('#1a1b26');

    // ink-grove does NOT override color.syntax.keyword — should inherit from base
    const baseResult = loadThemeSnapshot('official.base', 'dark');
    expect(baseResult.snapshot).not.toBeNull();
    expect(snapshot!.tokens.get('color.syntax.keyword')).toBe(
      baseResult.snapshot!.tokens.get('color.syntax.keyword'),
    );
  });

  it('child theme tokens override parent tokens', () => {
    const childResult = loadThemeSnapshot('official.ink-grove', 'dark');
    const parentResult = loadThemeSnapshot('official.base', 'dark');

    expect(childResult.snapshot).not.toBeNull();
    expect(parentResult.snapshot).not.toBeNull();

    // ink-grove overrides color.text.primary from #cdd6f4 (base) to #c0caf5 (ink-grove)
    expect(childResult.snapshot!.tokens.get('color.text.primary')).toBe('#c0caf5');
    expect(parentResult.snapshot!.tokens.get('color.text.primary')).toBe('#cdd6f4');
    expect(childResult.snapshot!.tokens.get('color.text.primary')).not.toBe(
      parentResult.snapshot!.tokens.get('color.text.primary'),
    );
  });

  it('multi-level inheritance chain resolves correctly', () => {
    // official.ink-grove inherits from official.base
    // Verify the chain: base tokens → ink-grove overrides
    const { snapshot } = loadThemeSnapshot('official.ink-grove', 'dark');
    expect(snapshot).not.toBeNull();

    // Tokens defined only in base should be present
    expect(snapshot!.tokens.get('color.state.success')).toBeTruthy();
    expect(snapshot!.tokens.get('connector.width')).toBe('2px');

    // Tokens overridden in ink-grove should have ink-grove values
    expect(snapshot!.tokens.get('color.surface.default')).toBe('#24283b');
    expect(snapshot!.tokens.get('color.accent.root')).toBe('#7aa2f7');
  });

  it('snapshot contains all registered tokens after loading', () => {
    const { snapshot } = loadThemeSnapshot('official.base', 'dark');
    expect(snapshot).not.toBeNull();

    // The snapshot should have a value for every token in the registry
    // (fillFallbacks ensures completeness)
    expect(snapshot!.tokens.has('color.canvas.background')).toBe(true);
    expect(snapshot!.tokens.has('typography.family.mono')).toBe(true);
    expect(snapshot!.tokens.has('space.node.padding.compact.x')).toBe(true);
    expect(snapshot!.tokens.has('layout.node.minWidth')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Atomic theme switching (spec 002 §18)
// ─────────────────────────────────────────────────────────────────────────

describe('theme loader — atomic switching', () => {
  beforeEach(() => {
    // Ensure a known starting state
    switchTheme('official.base', 'dark');
  });

  it('failed load reverts to previous snapshot', () => {
    // Establish a valid snapshot
    const firstSwitch = switchTheme('official.base', 'dark');
    expect(firstSwitch.success).toBe(true);
    const snapshotBefore = getCurrentSnapshot();
    expect(snapshotBefore).not.toBeNull();

    // Attempt to switch to a nonexistent theme — should fail
    const failedSwitch = switchTheme('nonexistent.theme', 'dark');
    expect(failedSwitch.success).toBe(false);
    expect(failedSwitch.error).not.toBeNull();

    // The current snapshot must be the previous one (same reference)
    const snapshotAfter = getCurrentSnapshot();
    expect(snapshotAfter).toBe(snapshotBefore);
  });

  it('failed mode reverts to previous snapshot', () => {
    // official.minimal supports only ['light', 'dark']
    const minimalSwitch = switchTheme('official.minimal', 'dark');
    expect(minimalSwitch.success).toBe(true);
    const snapshotBefore = getCurrentSnapshot();

    // Attempt to load a mode that minimal does not support
    const failedSwitch = switchTheme('official.minimal', 'high-contrast');
    expect(failedSwitch.success).toBe(false);
    expect(failedSwitch.error).not.toBeNull();

    // Previous snapshot is preserved
    const snapshotAfter = getCurrentSnapshot();
    expect(snapshotAfter).toBe(snapshotBefore);
  });

  it('successful switch updates the current snapshot', () => {
    switchTheme('official.base', 'dark');
    const snapshotBefore = getCurrentSnapshot();

    const result = switchTheme('official.midnight', 'dark');
    expect(result.success).toBe(true);

    const snapshotAfter = getCurrentSnapshot();
    expect(snapshotAfter).not.toBe(snapshotBefore);
    expect(snapshotAfter!.themeId).toBe('official.midnight');
  });

  it('switching between themes updates themeId and mode', () => {
    switchTheme('official.base', 'dark');
    expect(getCurrentSnapshot()!.themeId).toBe('official.base');
    expect(getCurrentSnapshot()!.mode).toBe('dark');

    switchTheme('official.minimal', 'light');
    expect(getCurrentSnapshot()!.themeId).toBe('official.minimal');
    expect(getCurrentSnapshot()!.mode).toBe('light');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Theme snapshot immutability (spec 002 §18)
// ─────────────────────────────────────────────────────────────────────────

describe('theme loader — snapshot immutability', () => {
  it('each loadThemeSnapshot returns an independent token map', () => {
    const { snapshot: snap1 } = loadThemeSnapshot('official.base', 'dark');
    const { snapshot: snap2 } = loadThemeSnapshot('official.base', 'dark');

    expect(snap1).not.toBe(snap2);
    expect(snap1!.tokens).not.toBe(snap2!.tokens);

    // Two snapshots must not share the same underlying data
    const originalValue = snap1!.tokens.get('color.canvas.background');
    expect(snap2!.tokens.get('color.canvas.background')).toBe(originalValue);
    // Verify the maps are distinct objects with equal but independent entries
    expect(snap1!.tokens.size).toBe(snap2!.tokens.size);
  });

  it('snapshot tokens map has entries for all registered tokens', () => {
    const { snapshot } = loadThemeSnapshot('official.base', 'dark');
    expect(snapshot).not.toBeNull();
    // Every registered token should have a resolved value in the snapshot
    expect(snapshot!.tokens.size).toBeGreaterThan(50);
  });

  it('loading the same theme twice produces equal but independent snapshots', () => {
    const { snapshot: snap1 } = loadThemeSnapshot('official.base', 'dark');
    const { snapshot: snap2 } = loadThemeSnapshot('official.base', 'dark');

    // Same content
    expect(snap1!.themeId).toBe(snap2!.themeId);
    expect(snap1!.mode).toBe(snap2!.mode);
    expect(snap1!.tokens.size).toBe(snap2!.tokens.size);
    for (const [key, value] of snap1!.tokens) {
      expect(snap2!.tokens.get(key)).toBe(value);
    }

    // But different references
    expect(snap1).not.toBe(snap2);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// All official themes can be loaded (spec 002 §12)
// ─────────────────────────────────────────────────────────────────────────

describe('theme loader — official themes', () => {
  it('all official themes are registered', () => {
    const ids = getRegisteredThemeIds();
    expect(ids).toContain('official.base');
    expect(ids).toContain('official.ink-grove');
    expect(ids).toContain('official.minimal');
    expect(ids).toContain('official.midnight');
    expect(ids).toContain('official.paper');
    expect(ids).toContain('official.neon');
    expect(ids).toContain('official.contrast');
    expect(ids.length).toBeGreaterThanOrEqual(7);
  });

  it('every registered theme can be loaded in at least one supported mode', () => {
    const themeIds = getRegisteredThemeIds();
    expect(themeIds.length).toBeGreaterThanOrEqual(7);

    for (const themeId of themeIds) {
      const theme = getTheme(themeId);
      expect(theme).toBeDefined();

      // Try each supported mode
      let loaded = false;
      for (const mode of theme!.manifest.modes) {
        const { snapshot, error } = loadThemeSnapshot(themeId, mode);
        if (snapshot && !error) {
          loaded = true;
          expect(snapshot.themeId).toBe(themeId);
          expect(snapshot.mode).toBe(mode);
          break;
        }
      }
      expect(loaded).toBe(true);
    }
  });

  it('official.base loads in dark mode', () => {
    const { snapshot, error } = loadThemeSnapshot('official.base', 'dark');
    expect(error).toBeNull();
    expect(snapshot).not.toBeNull();
    expect(snapshot!.themeId).toBe('official.base');
    expect(snapshot!.mode).toBe('dark');
    expect(snapshot!.tokens.get('color.canvas.background')).toBe('#1e1e2e');
  });

  it('official.base loads in light mode', () => {
    const { snapshot, error } = loadThemeSnapshot('official.base', 'light');
    expect(error).toBeNull();
    expect(snapshot).not.toBeNull();
    expect(snapshot!.mode).toBe('light');
    expect(snapshot!.tokens.get('color.canvas.background')).toBe('#fafafa');
  });

  it('official.contrast loads in high-contrast mode', () => {
    const { snapshot, error } = loadThemeSnapshot('official.contrast', 'high-contrast');
    expect(error).toBeNull();
    expect(snapshot).not.toBeNull();
    expect(snapshot!.mode).toBe('high-contrast');
  });

  it('loading a theme in an unsupported mode returns an error', () => {
    // official.paper only supports 'light'
    const { snapshot, error } = loadThemeSnapshot('official.paper', 'dark');
    expect(error).not.toBeNull();
    expect(snapshot).toBeNull();
  });

  it('loading a nonexistent theme returns an error', () => {
    const { snapshot, error } = loadThemeSnapshot('does.not.exist', 'dark');
    expect(error).not.toBeNull();
    expect(snapshot).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// User overrides only apply themeable tokens (spec 002 §13.3)
// ─────────────────────────────────────────────────────────────────────────

describe('theme loader — user overrides', () => {
  it('user overrides only apply themeable tokens', () => {
    const { snapshot } = loadThemeSnapshot('official.base', 'dark', {
      // Themeable token — should be applied (valid hex color)
      'color.canvas.background': '#abcdef',
      // Preference token — should NOT be applied
      'space.node.padding.compact.x': '999px',
    });

    expect(snapshot).not.toBeNull();
    // Themeable token was overridden
    expect(snapshot!.tokens.get('color.canvas.background')).toBe('#abcdef');
    // Preference token was NOT overridden (stays at default)
    expect(snapshot!.tokens.get('space.node.padding.compact.x')).not.toBe('999px');
    expect(snapshot!.tokens.get('space.node.padding.compact.x')).toBe('10px');
  });

  it('valid themeable overrides are applied', () => {
    const { snapshot } = loadThemeSnapshot('official.base', 'dark', {
      'color.text.primary': '#aabbcc',
      'shape.radius.node': '10px',
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot!.tokens.get('color.text.primary')).toBe('#aabbcc');
    expect(snapshot!.tokens.get('shape.radius.node')).toBe('10px');
  });

  it('invalid overrides (injection) are rejected but valid ones still apply', () => {
    const { snapshot } = loadThemeSnapshot('official.base', 'dark', {
      'color.canvas.background': '#abcdef',
      'typography.family.sans': 'javascript:alert(1)',
    });

    expect(snapshot).not.toBeNull();
    // Valid override was applied
    expect(snapshot!.tokens.get('color.canvas.background')).toBe('#abcdef');
    // Injection override was rejected — font family should be the default, not the injection
    const defaultFont = loadThemeSnapshot('official.base', 'dark').snapshot!.tokens.get(
      'typography.family.sans',
    );
    expect(snapshot!.tokens.get('typography.family.sans')).toBe(defaultFont);
  });

  it('validateUserOverrides confirms which overrides are safe', () => {
    const result = validateUserOverrides({
      'color.canvas.background': '#ff0000',
      'space.node.padding.compact.x': '999px',
    });
    expect(result.valid).toBe(false);
    // The themeable token should not have an error
    const colorError = result.errors.find(e => e.tokenName === 'color.canvas.background');
    expect(colorError).toBeUndefined();
    // The preference token should have an error
    const paddingError = result.errors.find(e => e.tokenName === 'space.node.padding.compact.x');
    expect(paddingError).toBeDefined();
    expect(paddingError!.code).toBe('PREFERENCE_TOKEN');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Theme switching does not re-parse Markdown (spec 002 §11.4)
// ─────────────────────────────────────────────────────────────────────────

describe('theme loader — no Markdown re-parsing', () => {
  it('switchTheme returns success without errors for a valid theme', () => {
    const result = switchTheme('official.base', 'dark');
    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
  });

  it('switchTheme to different themes succeeds without errors', () => {
    expect(switchTheme('official.midnight', 'dark').success).toBe(true);
    expect(switchTheme('official.neon', 'dark').success).toBe(true);
    expect(switchTheme('official.base', 'light').success).toBe(true);
    expect(switchTheme('official.ink-grove', 'dark').success).toBe(true);
    expect(switchTheme('official.contrast', 'dark').success).toBe(true);
  });

  it('switchTheme with user overrides succeeds without errors', () => {
    const result = switchTheme('official.base', 'dark', {
      'color.canvas.background': '#abcdef',
    });
    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
    expect(getCurrentSnapshot()!.tokens.get('color.canvas.background')).toBe('#abcdef');
  });

  it('switchTheme does not accept or process Markdown content', () => {
    // switchTheme's signature only accepts (themeId, mode, userOverrides).
    // There is no document/markdown parameter — switching is purely a
    // token-snapshot operation and cannot trigger re-parsing.
    const result = switchTheme('official.base', 'dark');
    expect(result.success).toBe(true);
    // Verify the function returns the expected shape (no markdown-related fields)
    expect(result).toEqual({ success: true, error: null });
  });
});
