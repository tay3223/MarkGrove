/**
 * Official themes (spec 002 §12).
 *
 * Each theme validates a different architectural aspect:
 *   - Ink Grove (墨林): texture and Chinese reading
 *   - Minimal: high information density
 *   - Midnight: dark contrast and code nodes
 *   - Paper: light texture and print export
 *   - Neon: effect token performance boundary
 *   - Contrast: accessibility and state visibility
 */

import type { ThemePackage } from '../types';
import { baseTheme } from './base';

// ─────────────────────────────────────────────────────────────────────────
// 墨林 Ink Grove — watermark paper, restrained texture
// ─────────────────────────────────────────────────────────────────────────

export const inkGroveTheme: ThemePackage = {
  manifest: {
    schemaVersion: 1,
    id: 'official.ink-grove',
    name: '墨林',
    version: '1.0.0',
    author: 'MarkGrove',
    inherits: 'official.base',
    modes: ['dark'],
    skeletonVersion: 1,
    license: 'MIT',
  },
  tokens: {
    dark: {
      'color.canvas.background': '#1a1b26',
      'color.surface.default': '#24283b',
      'color.surface.root': '#414868',
      'color.surface.code': '#16161e',
      'color.accent.root': '#7aa2f7',
      'color.accent.heading.strong': '#7aa2f7',
      'color.accent.heading.medium': '#bb9af7',
      'color.accent.code': '#7dcfff',
      'color.accent.quote': '#bb9af7',
      'color.accent.data': '#9ece6a',
      'color.text.primary': '#c0caf5',
      'color.text.secondary': '#a9b1d6',
      'color.border.default': '#3b4261',
      'color.border.strong': '#565f89',
      'color.state.selected': '#7aa2f7',
      'connector.color': '#565f89',
      'texture.canvas.enabled': 'true',
      'texture.canvas.opacity': 0.03,
    },
  },
  recommendedDensity: 'comfortable',
};

// ─────────────────────────────────────────────────────────────────────────
// Minimal — pure colors, thin borders, no shadows
// ─────────────────────────────────────────────────────────────────────────

export const minimalTheme: ThemePackage = {
  manifest: {
    schemaVersion: 1,
    id: 'official.minimal',
    name: '极简',
    version: '1.0.0',
    author: 'MarkGrove',
    inherits: 'official.base',
    modes: ['light', 'dark'],
    skeletonVersion: 1,
    license: 'MIT',
  },
  tokens: {
    light: {
      'color.surface.default': '#ffffff',
      'color.border.default': '#e5e7eb',
      'color.border.subtle': '#f3f4f6',
      'effect.shadow.default': 'none',
      'effect.shadow.hovered': 'none',
      'shape.radius.node': '4px',
      'shape.borderWidth.default': '1px',
      'texture.canvas.enabled': 'false',
      'texture.surface.enabled': 'false',
    },
    dark: {
      'color.surface.default': '#1a1a1a',
      'color.border.default': '#333333',
      'color.border.subtle': '#222222',
      'effect.shadow.default': 'none',
      'effect.shadow.hovered': 'none',
      'shape.radius.node': '4px',
      'texture.canvas.enabled': 'false',
      'texture.surface.enabled': 'false',
    },
  },
  recommendedDensity: 'compact',
};

// ─────────────────────────────────────────────────────────────────────────
// Midnight — dark, soft highlights
// ─────────────────────────────────────────────────────────────────────────

export const midnightTheme: ThemePackage = {
  manifest: {
    schemaVersion: 1,
    id: 'official.midnight',
    name: '深夜',
    version: '1.0.0',
    author: 'MarkGrove',
    inherits: 'official.base',
    modes: ['dark'],
    skeletonVersion: 1,
    license: 'MIT',
  },
  tokens: {
    dark: {
      'color.canvas.background': '#0d1117',
      'color.surface.default': '#161b22',
      'color.surface.root': '#21262d',
      'color.surface.code': '#0d1117',
      'color.accent.root': '#58a6ff',
      'color.accent.heading.strong': '#58a6ff',
      'color.accent.heading.medium': '#bc8cff',
      'color.accent.code': '#7ee787',
      'color.accent.quote': '#d2a8ff',
      'color.text.primary': '#e6edf3',
      'color.text.secondary': '#8b949e',
      'color.border.default': '#30363d',
      'color.border.strong': '#484f58',
      'color.state.selected': '#58a6ff',
      'connector.color': '#484f58',
      'effect.shadow.default': '0 0 0 1px rgba(255,255,255,0.04)',
      'effect.shadow.hovered': '0 0 0 1px rgba(255,255,255,0.08)',
    },
  },
  recommendedDensity: 'comfortable',
};

// ─────────────────────────────────────────────────────────────────────────
// Paper — warm paper, light grain
// ─────────────────────────────────────────────────────────────────────────

export const paperTheme: ThemePackage = {
  manifest: {
    schemaVersion: 1,
    id: 'official.paper',
    name: '纸笺',
    version: '1.0.0',
    author: 'MarkGrove',
    inherits: 'official.base',
    modes: ['light'],
    skeletonVersion: 1,
    license: 'MIT',
  },
  tokens: {
    light: {
      'color.canvas.background': '#fdf6e3',
      'color.surface.default': '#fdf6e3',
      'color.surface.root': '#eee8d5',
      'color.surface.code': '#eee8d5',
      'color.accent.root': '#268bd2',
      'color.accent.heading.strong': '#268bd2',
      'color.accent.heading.medium': '#6c71c4',
      'color.accent.code': '#cb4b16',
      'color.accent.quote': '#6c71c4',
      'color.text.primary': '#586e75',
      'color.text.secondary': '#93a1a1',
      'color.border.default': '#eee8d5',
      'color.border.strong': '#93a1a1',
      'texture.canvas.enabled': 'true',
      'texture.canvas.opacity': 0.04,
      'texture.surface.enabled': 'true',
      'texture.surface.opacity': 0.02,
      'effect.shadow.default': '0 1px 2px rgba(0,0,0,0.05)',
    },
  },
  recommendedDensity: 'spacious',
};

// ─────────────────────────────────────────────────────────────────────────
// Neon — dark base, vivid accents and glow
// ─────────────────────────────────────────────────────────────────────────

export const neonTheme: ThemePackage = {
  manifest: {
    schemaVersion: 1,
    id: 'official.neon',
    name: '霓虹',
    version: '1.0.0',
    author: 'MarkGrove',
    inherits: 'official.base',
    modes: ['dark'],
    skeletonVersion: 1,
    license: 'MIT',
  },
  tokens: {
    dark: {
      'color.canvas.background': '#0a0a0f',
      'color.surface.default': '#12121a',
      'color.surface.root': '#1a1a2e',
      'color.surface.code': '#0d0d14',
      'color.accent.root': '#00f5ff',
      'color.accent.heading.strong': '#00f5ff',
      'color.accent.heading.medium': '#ff00ff',
      'color.accent.code': '#39ff14',
      'color.accent.quote': '#ff00ff',
      'color.accent.data': '#ffff00',
      'color.text.primary': '#e0e0ff',
      'color.text.secondary': '#8080a0',
      'color.border.default': '#2a2a3e',
      'color.border.strong': '#00f5ff',
      'color.state.selected': '#00f5ff',
      'connector.color': '#3a3a5e',
      'connector.selectedColor': '#00f5ff',
      'effect.shadow.default': '0 0 8px rgba(0,245,255,0.15)',
      'effect.shadow.hovered': '0 0 16px rgba(0,245,255,0.3)',
      'effect.shadow.selected': '0 0 12px rgba(0,245,255,0.4)',
    },
  },
  recommendedDensity: 'comfortable',
};

// ─────────────────────────────────────────────────────────────────────────
// Contrast — strong borders, low decoration, accessibility
// ─────────────────────────────────────────────────────────────────────────

export const contrastTheme: ThemePackage = {
  manifest: {
    schemaVersion: 1,
    id: 'official.contrast',
    name: '高对比',
    version: '1.0.0',
    author: 'MarkGrove',
    inherits: 'official.base',
    modes: ['light', 'dark', 'high-contrast'],
    skeletonVersion: 1,
    license: 'MIT',
  },
  tokens: {
    light: {
      'color.canvas.background': '#ffffff',
      'color.surface.default': '#ffffff',
      'color.surface.root': '#ffffff',
      'color.text.primary': '#000000',
      'color.text.secondary': '#333333',
      'color.border.default': '#000000',
      'color.border.strong': '#000000',
      'color.border.subtle': '#666666',
      'color.accent.root': '#0000ff',
      'color.accent.heading.strong': '#0000ff',
      'color.state.selected': '#ff0000',
      'color.state.error': '#ff0000',
      'color.state.warning': '#ff8800',
      'shape.borderWidth.default': '2px',
      'shape.borderWidth.strong': '3px',
      'effect.shadow.default': 'none',
      'effect.shadow.hovered': 'none',
      'texture.canvas.enabled': 'false',
      'texture.surface.enabled': 'false',
    },
    dark: {
      'color.canvas.background': '#000000',
      'color.surface.default': '#000000',
      'color.surface.root': '#000000',
      'color.text.primary': '#ffffff',
      'color.text.secondary': '#cccccc',
      'color.border.default': '#ffffff',
      'color.border.strong': '#ffffff',
      'color.border.subtle': '#999999',
      'color.accent.root': '#00ffff',
      'color.accent.heading.strong': '#00ffff',
      'color.state.selected': '#ffff00',
      'color.state.error': '#ff4444',
      'color.state.warning': '#ffaa00',
      'shape.borderWidth.default': '2px',
      'shape.borderWidth.strong': '3px',
      'effect.shadow.default': 'none',
      'effect.shadow.hovered': 'none',
      'texture.canvas.enabled': 'false',
      'texture.surface.enabled': 'false',
    },
    'high-contrast': {
      'color.canvas.background': '#000000',
      'color.surface.default': '#000000',
      'color.surface.root': '#000000',
      'color.text.primary': '#ffffff',
      'color.text.secondary': '#ffffff',
      'color.border.default': '#ffffff',
      'color.border.strong': '#ffffff',
      'shape.borderWidth.default': '3px',
      'shape.borderWidth.strong': '4px',
      'effect.shadow.default': 'none',
      'texture.canvas.enabled': 'false',
      'texture.surface.enabled': 'false',
    },
  },
  recommendedDensity: 'comfortable',
};

// ─────────────────────────────────────────────────────────────────────────
// Register all official themes
// ─────────────────────────────────────────────────────────────────────────

import { registerTheme } from '../loader';

registerTheme(baseTheme);
registerTheme(inkGroveTheme);
registerTheme(minimalTheme);
registerTheme(midnightTheme);
registerTheme(paperTheme);
registerTheme(neonTheme);
registerTheme(contrastTheme);
