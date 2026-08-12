/**
 * Node style resolver tests (spec 002 §7.6).
 *
 * Verifies:
 *   - Pure function behavior
 *   - Heading level -> accent token mapping
 *   - Code node -> mono font family
 *   - State priority ordering
 *   - State ring production
 *   - Accessibility corrections (high contrast, reduced transparency, font scale)
 *   - Density -> padding
 *   - Fallback to safe defaults
 *   - Input immutability
 */

import { describe, it, expect } from 'vitest';
import { resolveNodeStyle } from '../../src/theme/resolver';
import { loadThemeSnapshot } from '../../src/theme/loader';
import '../../src/theme/themes/official'; // side-effect: registers all themes
import type {
  ResolveStyleInput,
  ThemeSnapshot,
  Density,
  AccessibilityPreferences,
} from '../../src/theme/types';
import type { SemanticType, VisualFamily, NodeRole } from '../../src/semantic/types';

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function makeSnapshot(
  themeId: string = 'official.base',
  mode: 'light' | 'dark' | 'high-contrast' = 'dark',
  overrides: Record<string, string | number> = {},
): ThemeSnapshot {
  const { snapshot, error } = loadThemeSnapshot(themeId, mode, overrides);
  if (!snapshot || error) {
    throw new Error(`Failed to load snapshot: ${error ?? 'null snapshot'}`);
  }
  return snapshot;
}

const DEFAULT_A11Y: AccessibilityPreferences = {
  reducedMotion: false,
  highContrast: false,
  reducedTransparency: false,
  fontScale: 1,
};

function makeBaseInput(overrides: Partial<ResolveStyleInput> = {}): ResolveStyleInput {
  return {
    semanticType: 'paragraph',
    visualFamily: 'textual',
    role: 'block-leaf',
    states: {},
    themeSnapshot: makeSnapshot(),
    densityPreference: 'comfortable',
    accessibilityPreferences: { ...DEFAULT_A11Y },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Purity
// ─────────────────────────────────────────────────────────────────────────

describe('resolver — purity', () => {
  it('resolveNodeStyle is a pure function (same inputs produce same outputs)', () => {
    const input = makeBaseInput({ states: { selected: true } });
    const result1 = resolveNodeStyle(input);
    const result2 = resolveNodeStyle(input);
    expect(result1).toEqual(result2);
  });

  it('produces deterministic output across repeated calls', () => {
    const input = makeBaseInput({
      semanticType: 'heading',
      visualFamily: 'structural',
      headingLevel: 2,
      states: { hovered: true },
    });
    const results = Array.from({ length: 5 }, () => resolveNodeStyle(input));
    for (let i = 1; i < results.length; i++) {
      expect(results[i]).toEqual(results[0]);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Heading levels -> accent tokens (spec 002 §5.2)
// ─────────────────────────────────────────────────────────────────────────

describe('resolver — heading levels', () => {
  it('H1/H2 map to accent.heading.strong', () => {
    const snapshot = makeSnapshot();
    const strong = snapshot.tokens.get('color.accent.heading.strong');

    const base = {
      visualFamily: 'structural' as VisualFamily,
      role: 'section-container' as NodeRole,
      states: {},
      themeSnapshot: snapshot,
      densityPreference: 'comfortable' as Density,
      accessibilityPreferences: { ...DEFAULT_A11Y },
    };

    const h1 = resolveNodeStyle({ ...base, semanticType: 'heading', headingLevel: 1 });
    const h2 = resolveNodeStyle({ ...base, semanticType: 'heading', headingLevel: 2 });
    expect(h1.accentColor).toBe(strong);
    expect(h2.accentColor).toBe(strong);
  });

  it('H3/H4 map to accent.heading.medium', () => {
    const snapshot = makeSnapshot();
    const medium = snapshot.tokens.get('color.accent.heading.medium');

    const base = {
      visualFamily: 'structural' as VisualFamily,
      role: 'section-container' as NodeRole,
      states: {},
      themeSnapshot: snapshot,
      densityPreference: 'comfortable' as Density,
      accessibilityPreferences: { ...DEFAULT_A11Y },
    };

    const h3 = resolveNodeStyle({ ...base, semanticType: 'heading', headingLevel: 3 });
    const h4 = resolveNodeStyle({ ...base, semanticType: 'heading', headingLevel: 4 });
    expect(h3.accentColor).toBe(medium);
    expect(h4.accentColor).toBe(medium);
  });

  it('H5/H6 map to accent.heading.subtle', () => {
    const snapshot = makeSnapshot();
    const subtle = snapshot.tokens.get('color.accent.heading.subtle');

    const base = {
      visualFamily: 'structural' as VisualFamily,
      role: 'section-container' as NodeRole,
      states: {},
      themeSnapshot: snapshot,
      densityPreference: 'comfortable' as Density,
      accessibilityPreferences: { ...DEFAULT_A11Y },
    };

    const h5 = resolveNodeStyle({ ...base, semanticType: 'heading', headingLevel: 5 });
    const h6 = resolveNodeStyle({ ...base, semanticType: 'heading', headingLevel: 6 });
    expect(h5.accentColor).toBe(subtle);
    expect(h6.accentColor).toBe(subtle);
  });

  it('strong, medium, and subtle accent colors differ', () => {
    const snapshot = makeSnapshot();
    const strong = snapshot.tokens.get('color.accent.heading.strong');
    const medium = snapshot.tokens.get('color.accent.heading.medium');
    const subtle = snapshot.tokens.get('color.accent.heading.subtle');

    expect(strong).not.toBe(medium);
    expect(medium).not.toBe(subtle);
    expect(strong).not.toBe(subtle);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Code nodes -> mono font (spec 002 §5)
// ─────────────────────────────────────────────────────────────────────────

describe('resolver — code nodes', () => {
  it('code nodes use mono font family', () => {
    const snapshot = makeSnapshot();
    const monoFont = snapshot.tokens.get('typography.family.mono');
    const sansFont = snapshot.tokens.get('typography.family.sans');

    const base = {
      visualFamily: 'structural' as VisualFamily,
      role: 'block-leaf' as NodeRole,
      states: {},
      themeSnapshot: snapshot,
      densityPreference: 'comfortable' as Density,
      accessibilityPreferences: { ...DEFAULT_A11Y },
    };

    const codeStyle = resolveNodeStyle({ ...base, semanticType: 'code' });
    expect(codeStyle.fontFamily).toBe(monoFont);
    expect(codeStyle.fontFamily).not.toBe(sansFont);
  });

  it('paragraph nodes use sans font family', () => {
    const snapshot = makeSnapshot();
    const sansFont = snapshot.tokens.get('typography.family.sans');

    const style = resolveNodeStyle({
      semanticType: 'paragraph',
      visualFamily: 'textual',
      role: 'block-leaf',
      states: {},
      themeSnapshot: snapshot,
      densityPreference: 'comfortable',
      accessibilityPreferences: { ...DEFAULT_A11Y },
    });
    expect(style.fontFamily).toBe(sansFont);
  });

  it('html nodes use mono font family', () => {
    const snapshot = makeSnapshot();
    const monoFont = snapshot.tokens.get('typography.family.mono');

    const style = resolveNodeStyle({
      semanticType: 'html',
      visualFamily: 'structural',
      role: 'block-leaf',
      states: {},
      themeSnapshot: snapshot,
      densityPreference: 'comfortable',
      accessibilityPreferences: { ...DEFAULT_A11Y },
    });
    expect(style.fontFamily).toBe(monoFont);
  });

  it('technical visual family uses mono font family', () => {
    const snapshot = makeSnapshot();
    const monoFont = snapshot.tokens.get('typography.family.mono');

    const style = resolveNodeStyle({
      semanticType: 'paragraph',
      visualFamily: 'technical',
      role: 'block-leaf',
      states: {},
      themeSnapshot: snapshot,
      densityPreference: 'comfortable',
      accessibilityPreferences: { ...DEFAULT_A11Y },
    });
    expect(style.fontFamily).toBe(monoFont);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// State priority (spec 002 §6.2)
// ─────────────────────────────────────────────────────────────────────────

describe('resolver — state priority', () => {
  const baseOverrides = {
    semanticType: 'paragraph' as SemanticType,
    visualFamily: 'textual' as VisualFamily,
    role: 'block-leaf' as NodeRole,
    densityPreference: 'comfortable' as Density,
    accessibilityPreferences: { ...DEFAULT_A11Y },
  };

  it('error takes priority over selected', () => {
    const snapshot = makeSnapshot();
    const errorColor = snapshot.tokens.get('color.state.error');
    const selectedColor = snapshot.tokens.get('color.state.selected');

    const result = resolveNodeStyle({
      ...baseOverrides,
      states: { error: true, selected: true },
      themeSnapshot: snapshot,
    });
    expect(result.stateRingColor).toBe(errorColor);
    expect(result.stateRingColor).not.toBe(selectedColor);
    expect(result.surfaceBorder).toBe(errorColor);
  });

  it('error takes priority over dropForbidden', () => {
    const snapshot = makeSnapshot();
    const errorColor = snapshot.tokens.get('color.state.error');
    const defaultBorder = snapshot.tokens.get('color.border.default');

    // When both error and dropForbidden are active, error wins.
    // Error state forces surfaceBorder to the error color; dropForbidden alone does not.
    const bothActive = resolveNodeStyle({
      ...baseOverrides,
      states: { error: true, dropForbidden: true },
      themeSnapshot: snapshot,
    });
    expect(bothActive.stateRingColor).toBe(errorColor);
    // Error forces surfaceBorder to error color (dropForbidden would not)
    expect(bothActive.surfaceBorder).toBe(errorColor);

    // For comparison: dropForbidden alone does NOT change surfaceBorder
    const dropOnly = resolveNodeStyle({
      ...baseOverrides,
      states: { dropForbidden: true },
      themeSnapshot: snapshot,
    });
    expect(dropOnly.surfaceBorder).toBe(defaultBorder);
    expect(dropOnly.surfaceBorder).not.toBe(errorColor);
  });

  it('dropForbidden takes priority over editing', () => {
    const snapshot = makeSnapshot();
    const dropForbiddenColor = snapshot.tokens.get('color.state.dropForbidden');

    const result = resolveNodeStyle({
      ...baseOverrides,
      states: { dropForbidden: true, editing: true },
      themeSnapshot: snapshot,
    });
    expect(result.stateRingColor).toBe(dropForbiddenColor);
  });

  it('editing takes priority over focused', () => {
    const snapshot = makeSnapshot();
    const focusedColor = snapshot.tokens.get('color.state.focused');
    const strongBorder = snapshot.tokens.get('color.border.strong');

    const result = resolveNodeStyle({
      ...baseOverrides,
      states: { editing: true, focused: true },
      themeSnapshot: snapshot,
    });
    // Editing does not produce a state ring
    expect(result.stateRingColor).toBeNull();
    // Editing produces strong border
    expect(result.surfaceBorder).toBe(strongBorder);
    // Focused would have produced a ring, but editing takes priority
    expect(result.stateRingColor).not.toBe(focusedColor);
  });

  it('focused takes priority over selected', () => {
    const snapshot = makeSnapshot();
    const focusedColor = snapshot.tokens.get('color.state.focused');
    const selectedColor = snapshot.tokens.get('color.state.selected');

    const result = resolveNodeStyle({
      ...baseOverrides,
      states: { focused: true, selected: true },
      themeSnapshot: snapshot,
    });
    expect(result.stateRingColor).toBe(focusedColor);
    expect(result.stateRingColor).not.toBe(selectedColor);
  });

  it('selected takes priority over searchMatch', () => {
    const snapshot = makeSnapshot();
    const selectedColor = snapshot.tokens.get('color.state.selected');
    const searchMatchColor = snapshot.tokens.get('color.state.searchMatch');

    const result = resolveNodeStyle({
      ...baseOverrides,
      states: { selected: true, searchMatch: true },
      themeSnapshot: snapshot,
    });
    expect(result.stateRingColor).toBe(selectedColor);
    expect(result.stateRingColor).not.toBe(searchMatchColor);
  });

  it('selected takes priority over hovered (hovered shadow not applied)', () => {
    const snapshot = makeSnapshot();
    const selectedColor = snapshot.tokens.get('color.state.selected');
    const hoveredShadow = snapshot.tokens.get('effect.shadow.hovered');
    const defaultShadow = snapshot.tokens.get('effect.shadow.default');

    const result = resolveNodeStyle({
      ...baseOverrides,
      states: { selected: true, hovered: true },
      themeSnapshot: snapshot,
    });
    expect(result.stateRingColor).toBe(selectedColor);
    // Hovered shadow should NOT be applied because selected takes priority
    expect(result.shadow).not.toBe(hoveredShadow);
    expect(result.shadow).toBe(defaultShadow);
  });

  it('no active state produces no state ring', () => {
    const snapshot = makeSnapshot();
    const result = resolveNodeStyle({
      ...baseOverrides,
      states: {},
      themeSnapshot: snapshot,
    });
    expect(result.stateRingColor).toBeNull();
    expect(result.stateRingWidth).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// State ring production
// ─────────────────────────────────────────────────────────────────────────

describe('resolver — state rings', () => {
  const baseOverrides = {
    semanticType: 'paragraph' as SemanticType,
    visualFamily: 'textual' as VisualFamily,
    role: 'block-leaf' as NodeRole,
    densityPreference: 'comfortable' as Density,
    accessibilityPreferences: { ...DEFAULT_A11Y },
  };

  it('selected state produces state ring', () => {
    const snapshot = makeSnapshot();
    const selectedColor = snapshot.tokens.get('color.state.selected');

    const result = resolveNodeStyle({
      ...baseOverrides,
      states: { selected: true },
      themeSnapshot: snapshot,
    });
    expect(result.stateRingColor).not.toBeNull();
    expect(result.stateRingColor).toBe(selectedColor);
    expect(result.stateRingWidth).not.toBeNull();
  });

  it('error state produces red border', () => {
    const snapshot = makeSnapshot();
    const errorColor = snapshot.tokens.get('color.state.error');

    const result = resolveNodeStyle({
      ...baseOverrides,
      states: { error: true },
      themeSnapshot: snapshot,
    });
    expect(result.surfaceBorder).toBe(errorColor);
    expect(result.stateRingColor).toBe(errorColor);
  });

  it('focused state produces state ring', () => {
    const snapshot = makeSnapshot();
    const focusedColor = snapshot.tokens.get('color.state.focused');

    const result = resolveNodeStyle({
      ...baseOverrides,
      states: { focused: true },
      themeSnapshot: snapshot,
    });
    expect(result.stateRingColor).toBe(focusedColor);
    expect(result.stateRingWidth).not.toBeNull();
  });

  it('searchMatch state produces state ring', () => {
    const snapshot = makeSnapshot();
    const searchMatchColor = snapshot.tokens.get('color.state.searchMatch');

    const result = resolveNodeStyle({
      ...baseOverrides,
      states: { searchMatch: true },
      themeSnapshot: snapshot,
    });
    expect(result.stateRingColor).toBe(searchMatchColor);
    expect(result.stateRingWidth).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Accessibility — high contrast (spec 002 §7.6)
// ─────────────────────────────────────────────────────────────────────────

describe('resolver — high contrast mode', () => {
  const baseOverrides = {
    semanticType: 'paragraph' as SemanticType,
    visualFamily: 'textual' as VisualFamily,
    role: 'block-leaf' as NodeRole,
    states: {},
    densityPreference: 'comfortable' as Density,
  };

  it('high contrast mode disables textures', () => {
    // Enable textures via user override so we can verify they get disabled
    const snapshot = makeSnapshot('official.base', 'dark', {
      'texture.surface.enabled': 'true',
    });

    const normal = resolveNodeStyle({
      ...baseOverrides,
      themeSnapshot: snapshot,
      accessibilityPreferences: { ...DEFAULT_A11Y },
    });
    expect(normal.textureEnabled).toBe(true);

    const highContrast = resolveNodeStyle({
      ...baseOverrides,
      themeSnapshot: snapshot,
      accessibilityPreferences: { ...DEFAULT_A11Y, highContrast: true },
    });
    expect(highContrast.textureEnabled).toBe(false);
  });

  it('high contrast mode strengthens borders', () => {
    const snapshot = makeSnapshot();
    const strongBorder = snapshot.tokens.get('color.border.strong');

    const normal = resolveNodeStyle({
      ...baseOverrides,
      themeSnapshot: snapshot,
      accessibilityPreferences: { ...DEFAULT_A11Y },
    });

    const highContrast = resolveNodeStyle({
      ...baseOverrides,
      themeSnapshot: snapshot,
      accessibilityPreferences: { ...DEFAULT_A11Y, highContrast: true },
    });

    // High contrast forces border width to 2px
    expect(highContrast.surfaceBorderWidth).toBe('2px');
    // Normal border width is the default (1px)
    const defaultBorderWidth = snapshot.tokens.get('shape.borderWidth.default');
    expect(normal.surfaceBorderWidth).toBe(defaultBorderWidth);

    // High contrast uses the strong border color
    expect(highContrast.surfaceBorder).toBe(strongBorder);
  });

  it('high contrast strengthens state ring width to 3px for active states', () => {
    const snapshot = makeSnapshot();

    const highContrastSelected = resolveNodeStyle({
      ...baseOverrides,
      states: { selected: true },
      themeSnapshot: snapshot,
      accessibilityPreferences: { ...DEFAULT_A11Y, highContrast: true },
    });
    expect(highContrastSelected.stateRingWidth).toBe('3px');

    const highContrastFocused = resolveNodeStyle({
      ...baseOverrides,
      states: { focused: true },
      themeSnapshot: snapshot,
      accessibilityPreferences: { ...DEFAULT_A11Y, highContrast: true },
    });
    expect(highContrastFocused.stateRingWidth).toBe('3px');

    const highContrastError = resolveNodeStyle({
      ...baseOverrides,
      states: { error: true },
      themeSnapshot: snapshot,
      accessibilityPreferences: { ...DEFAULT_A11Y, highContrast: true },
    });
    expect(highContrastError.stateRingWidth).toBe('3px');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Accessibility — reduced transparency (spec 002 §7.6)
// ─────────────────────────────────────────────────────────────────────────

describe('resolver — reduced transparency', () => {
  const baseOverrides = {
    semanticType: 'paragraph' as SemanticType,
    visualFamily: 'textual' as VisualFamily,
    role: 'block-leaf' as NodeRole,
    states: {},
    densityPreference: 'comfortable' as Density,
  };

  it('reduced transparency disables textures', () => {
    const snapshot = makeSnapshot('official.base', 'dark', {
      'texture.surface.enabled': 'true',
    });

    const normal = resolveNodeStyle({
      ...baseOverrides,
      themeSnapshot: snapshot,
      accessibilityPreferences: { ...DEFAULT_A11Y },
    });
    expect(normal.textureEnabled).toBe(true);

    const reduced = resolveNodeStyle({
      ...baseOverrides,
      themeSnapshot: snapshot,
      accessibilityPreferences: { ...DEFAULT_A11Y, reducedTransparency: true },
    });
    expect(reduced.textureEnabled).toBe(false);
  });

  it('reduced transparency forces opacity to 1', () => {
    const snapshot = makeSnapshot();

    // With dragging state, opacity would normally be reduced
    const dragging = resolveNodeStyle({
      ...baseOverrides,
      states: { dragging: true },
      themeSnapshot: snapshot,
      accessibilityPreferences: { ...DEFAULT_A11Y },
    });
    expect(dragging.opacity).toBeLessThan(1);

    const draggingReduced = resolveNodeStyle({
      ...baseOverrides,
      states: { dragging: true },
      themeSnapshot: snapshot,
      accessibilityPreferences: { ...DEFAULT_A11Y, reducedTransparency: true },
    });
    expect(draggingReduced.opacity).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Font scaling (spec 002 §7.6)
// ─────────────────────────────────────────────────────────────────────────

describe('resolver — font scaling', () => {
  const baseOverrides = {
    semanticType: 'paragraph' as SemanticType,
    visualFamily: 'textual' as VisualFamily,
    role: 'block-leaf' as NodeRole,
    states: {},
    themeSnapshot: makeSnapshot(),
    densityPreference: 'comfortable' as Density,
  };

  it('font scaling applies to font sizes', () => {
    const normal = resolveNodeStyle({
      ...baseOverrides,
      accessibilityPreferences: { ...DEFAULT_A11Y, fontScale: 1 },
    });

    const scaled = resolveNodeStyle({
      ...baseOverrides,
      accessibilityPreferences: { ...DEFAULT_A11Y, fontScale: 1.5 },
    });

    const normalSize = parseFloat(normal.fontSize);
    const scaledSize = parseFloat(scaled.fontSize);
    expect(scaledSize).toBeCloseTo(normalSize * 1.5, 1);
  });

  it('font scale of 2 doubles the font size', () => {
    const normal = resolveNodeStyle({
      ...baseOverrides,
      accessibilityPreferences: { ...DEFAULT_A11Y, fontScale: 1 },
    });

    const doubled = resolveNodeStyle({
      ...baseOverrides,
      accessibilityPreferences: { ...DEFAULT_A11Y, fontScale: 2 },
    });

    const normalSize = parseFloat(normal.fontSize);
    const doubledSize = parseFloat(doubled.fontSize);
    expect(doubledSize).toBeCloseTo(normalSize * 2, 1);
  });

  it('font scale of 1 leaves font size unchanged', () => {
    const result = resolveNodeStyle({
      ...baseOverrides,
      accessibilityPreferences: { ...DEFAULT_A11Y, fontScale: 1 },
    });
    const bodySize = baseOverrides.themeSnapshot.tokens.get('typography.size.body');
    expect(result.fontSize).toBe(bodySize);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Density (spec 002 §4.1)
// ─────────────────────────────────────────────────────────────────────────

describe('resolver — density', () => {
  const baseOverrides = {
    semanticType: 'paragraph' as SemanticType,
    visualFamily: 'textual' as VisualFamily,
    role: 'block-leaf' as NodeRole,
    states: {},
    themeSnapshot: makeSnapshot(),
    accessibilityPreferences: { ...DEFAULT_A11Y },
  };

  it('density affects padding values (compact < comfortable < spacious)', () => {
    const compact = resolveNodeStyle({ ...baseOverrides, densityPreference: 'compact' });
    const comfortable = resolveNodeStyle({ ...baseOverrides, densityPreference: 'comfortable' });
    const spacious = resolveNodeStyle({ ...baseOverrides, densityPreference: 'spacious' });

    // Horizontal padding
    const compactX = parseFloat(compact.paddingX);
    const comfortableX = parseFloat(comfortable.paddingX);
    const spaciousX = parseFloat(spacious.paddingX);
    expect(compactX).toBeLessThan(comfortableX);
    expect(comfortableX).toBeLessThan(spaciousX);

    // Vertical padding
    const compactY = parseFloat(compact.paddingY);
    const comfortableY = parseFloat(comfortable.paddingY);
    const spaciousY = parseFloat(spacious.paddingY);
    expect(compactY).toBeLessThan(comfortableY);
    expect(comfortableY).toBeLessThan(spaciousY);
  });

  it('compact density uses compact padding tokens', () => {
    const snapshot = makeSnapshot();
    const result = resolveNodeStyle({
      ...baseOverrides,
      themeSnapshot: snapshot,
      densityPreference: 'compact',
    });
    expect(result.paddingX).toBe(snapshot.tokens.get('space.node.padding.compact.x'));
    expect(result.paddingY).toBe(snapshot.tokens.get('space.node.padding.compact.y'));
  });

  it('spacious density uses spacious padding tokens', () => {
    const snapshot = makeSnapshot();
    const result = resolveNodeStyle({
      ...baseOverrides,
      themeSnapshot: snapshot,
      densityPreference: 'spacious',
    });
    expect(result.paddingX).toBe(snapshot.tokens.get('space.node.padding.spacious.x'));
    expect(result.paddingY).toBe(snapshot.tokens.get('space.node.padding.spacious.y'));
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Fallback to safe defaults
// ─────────────────────────────────────────────────────────────────────────

describe('resolver — fallback to safe defaults', () => {
  it('missing theme tokens fall back to safe defaults', () => {
    // Create a snapshot with no tokens at all — resolver must use the
    // fallback chain and ultimately the registry defaults.
    const emptySnapshot: ThemeSnapshot = {
      themeId: 'test-empty',
      mode: 'dark',
      tokens: new Map<string, string | number>(),
    };

    const result = resolveNodeStyle({
      semanticType: 'paragraph',
      visualFamily: 'textual',
      role: 'block-leaf',
      states: {},
      themeSnapshot: emptySnapshot,
      densityPreference: 'comfortable',
      accessibilityPreferences: { ...DEFAULT_A11Y },
    });

    // Every field should still have a valid (non-empty) value
    expect(result.surfaceBackground).toBeTruthy();
    expect(result.surfaceBorder).toBeTruthy();
    expect(result.surfaceBorderWidth).toBeTruthy();
    expect(result.surfaceRadius).toBeTruthy();
    expect(result.accentColor).toBeTruthy();
    expect(result.fontFamily).toBeTruthy();
    expect(result.fontSize).toBeTruthy();
    expect(result.fontWeight).toBeTruthy();
    expect(result.textColor).toBeTruthy();
    expect(result.paddingX).toBeTruthy();
    expect(result.paddingY).toBeTruthy();
    expect(result.shadow).toBeTruthy();
    expect(result.minWidth).toBeTruthy();
    expect(result.maxWidth).toBeTruthy();
  });

  it('missing surface token falls back through the chain to canvas background default', () => {
    const emptySnapshot: ThemeSnapshot = {
      themeId: 'test-empty',
      mode: 'dark',
      tokens: new Map<string, string | number>(),
    };

    const result = resolveNodeStyle({
      semanticType: 'paragraph',
      visualFamily: 'textual',
      role: 'block-leaf',
      states: {},
      themeSnapshot: emptySnapshot,
      densityPreference: 'comfortable',
      accessibilityPreferences: { ...DEFAULT_A11Y },
    });

    // color.surface.default -> fallback color.canvas.background -> default '#1e1e2e'
    expect(result.surfaceBackground).toBe('#1e1e2e');
  });

  it('resolver produces valid output for every semantic type with empty snapshot', () => {
    const emptySnapshot: ThemeSnapshot = {
      themeId: 'test-empty',
      mode: 'dark',
      tokens: new Map<string, string | number>(),
    };

    const types: SemanticType[] = [
      'root',
      'heading',
      'paragraph',
      'code',
      'quote',
      'table',
      'image',
      'html',
      'metadata',
      'callout',
      'list-item',
    ];

    for (const type of types) {
      const result = resolveNodeStyle({
        semanticType: type,
        visualFamily: 'structural',
        role: 'block-leaf',
        states: {},
        themeSnapshot: emptySnapshot,
        densityPreference: 'comfortable',
        accessibilityPreferences: { ...DEFAULT_A11Y },
      });
      expect(result.surfaceBackground).toBeTruthy();
      expect(result.fontSize).toBeTruthy();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Input immutability — resolver does not modify inputs
// (theme switching does not change the semantic tree)
// ─────────────────────────────────────────────────────────────────────────

describe('resolver — input immutability', () => {
  it('resolver does not modify the theme snapshot', () => {
    const snapshot = makeSnapshot();
    const tokensBefore = new Map(snapshot.tokens);

    resolveNodeStyle({
      semanticType: 'paragraph',
      visualFamily: 'textual',
      role: 'block-leaf',
      states: { selected: true, error: true },
      themeSnapshot: snapshot,
      densityPreference: 'comfortable',
      accessibilityPreferences: { ...DEFAULT_A11Y, fontScale: 1.5, highContrast: true },
    });

    expect(snapshot.tokens.size).toBe(tokensBefore.size);
    for (const [key, value] of tokensBefore) {
      expect(snapshot.tokens.get(key)).toBe(value);
    }
  });

  it('resolver does not modify the states object', () => {
    const snapshot = makeSnapshot();
    const states = { selected: true, hovered: false };
    const statesBefore = { ...states };

    resolveNodeStyle({
      semanticType: 'paragraph',
      visualFamily: 'textual',
      role: 'block-leaf',
      states,
      themeSnapshot: snapshot,
      densityPreference: 'comfortable',
      accessibilityPreferences: { ...DEFAULT_A11Y },
    });

    expect(states).toEqual(statesBefore);
  });

  it('resolver does not modify the accessibility preferences', () => {
    const snapshot = makeSnapshot();
    const a11y: AccessibilityPreferences = {
      reducedMotion: false,
      highContrast: true,
      reducedTransparency: false,
      fontScale: 1.5,
    };
    const a11yBefore = { ...a11y };

    resolveNodeStyle({
      semanticType: 'paragraph',
      visualFamily: 'textual',
      role: 'block-leaf',
      states: {},
      themeSnapshot: snapshot,
      densityPreference: 'comfortable',
      accessibilityPreferences: a11y,
    });

    expect(a11y).toEqual(a11yBefore);
  });

  it('theme switching does not change semantic tree (resolver is side-effect free)', () => {
    const snapshot = makeSnapshot();

    const semanticInput = {
      semanticType: 'heading' as SemanticType,
      visualFamily: 'structural' as VisualFamily,
      headingLevel: 1,
      role: 'section-container' as NodeRole,
      states: { selected: true },
    };
    const semanticInputBefore = JSON.parse(JSON.stringify(semanticInput));

    resolveNodeStyle({
      ...semanticInput,
      themeSnapshot: snapshot,
      densityPreference: 'comfortable',
      accessibilityPreferences: { ...DEFAULT_A11Y },
    });

    expect(semanticInput).toEqual(semanticInputBefore);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Texture / font / icon load failure resilience (spec 002 §8, §9)
// ─────────────────────────────────────────────────────────────────────────

describe('resolver — resource failure resilience', () => {
  const baseOverrides = {
    semanticType: 'paragraph' as SemanticType,
    visualFamily: 'textual' as VisualFamily,
    role: 'block-leaf' as NodeRole,
    states: {},
    densityPreference: 'comfortable' as Density,
  };

  it('surface background is available even when texture is enabled (texture failure fallback)', () => {
    // Enable textures — if the texture image fails to load at runtime,
    // the surface background color must still be present.
    const snapshot = makeSnapshot('official.base', 'dark', {
      'texture.surface.enabled': 'true',
    });

    const result = resolveNodeStyle({
      ...baseOverrides,
      themeSnapshot: snapshot,
      accessibilityPreferences: { ...DEFAULT_A11Y },
    });

    // Texture is enabled
    expect(result.textureEnabled).toBe(true);
    // But surface background is still a valid color (fallback for texture failure)
    expect(result.surfaceBackground).toBeTruthy();
    expect(result.surfaceBackground).toMatch(/^#/);
  });

  it('font family falls back to default when token is missing', () => {
    // Create a snapshot with no font tokens — resolver must use fallback
    const emptySnapshot: ThemeSnapshot = {
      themeId: 'test-empty',
      mode: 'dark',
      tokens: new Map<string, string | number>(),
    };

    const result = resolveNodeStyle({
      ...baseOverrides,
      themeSnapshot: emptySnapshot,
      accessibilityPreferences: { ...DEFAULT_A11Y },
    });

    // Font family should fall back to a default, not be empty
    expect(result.fontFamily).toBeTruthy();
    expect(result.fontFamily.length).toBeGreaterThan(0);
  });

  it('code node font family falls back to monospace default when missing', () => {
    const emptySnapshot: ThemeSnapshot = {
      themeId: 'test-empty',
      mode: 'dark',
      tokens: new Map<string, string | number>(),
    };

    const result = resolveNodeStyle({
      ...baseOverrides,
      semanticType: 'code' as SemanticType,
      visualFamily: 'technical' as VisualFamily,
      themeSnapshot: emptySnapshot,
      accessibilityPreferences: { ...DEFAULT_A11Y },
    });

    // Code should still get a monospace font family
    expect(result.fontFamily).toBeTruthy();
    expect(result.fontFamily.length).toBeGreaterThan(0);
  });

  it('all visual families produce valid surface background with empty snapshot', () => {
    const emptySnapshot: ThemeSnapshot = {
      themeId: 'test-empty',
      mode: 'dark',
      tokens: new Map<string, string | number>(),
    };

    const families: VisualFamily[] = ['structural', 'textual', 'technical', 'data', 'media', 'notice', 'fallback'];

    for (const family of families) {
      const result = resolveNodeStyle({
        ...baseOverrides,
        visualFamily: family,
        themeSnapshot: emptySnapshot,
        accessibilityPreferences: { ...DEFAULT_A11Y },
      });
      expect(result.surfaceBackground).toBeTruthy();
      expect(result.surfaceBackground).toMatch(/^#/);
    }
  });

  it('disabled texture still provides full surface color', () => {
    // When texture is disabled (or fails), the surface color must be complete
    const snapshot = makeSnapshot('official.base', 'dark', {
      'texture.surface.enabled': 'false',
    });

    const result = resolveNodeStyle({
      ...baseOverrides,
      themeSnapshot: snapshot,
      accessibilityPreferences: { ...DEFAULT_A11Y },
    });

    expect(result.textureEnabled).toBe(false);
    expect(result.surfaceBackground).toBeTruthy();
    expect(result.surfaceBackground).toMatch(/^#/);
  });
});
