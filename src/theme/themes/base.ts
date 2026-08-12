/**
 * Official base theme (spec 002 §12).
 *
 * All official themes should inherit from this.
 * Provides safe defaults for all registered tokens.
 */

import type { ThemePackage } from '../types';

export const baseTheme: ThemePackage = {
  manifest: {
    schemaVersion: 1,
    id: 'official.base',
    name: '基础',
    version: '1.0.0',
    author: 'MarkGrove',
    inherits: null,
    modes: ['light', 'dark'],
    skeletonVersion: 1,
    license: 'MIT',
  },
  tokens: {
    dark: {
      'color.canvas.background': '#1e1e2e',
      'color.canvas.grid': '#313244',
      'color.canvas.gridOpacity': 0.3,

      'color.surface.default': '#313244',
      'color.surface.root': '#45475a',
      'color.surface.code': '#11111b',
      'color.surface.quote': '#313244',
      'color.surface.table': '#313244',
      'color.surface.image': '#313244',
      'color.surface.html': '#11111b',
      'color.surface.metadata': '#181825',
      'color.surface.technical': '#11111b',
      'color.surface.media': '#313244',
      'color.surface.data': '#313244',
      'color.surface.notice': '#313244',
      'color.surface.fallback': '#313244',

      'color.text.primary': '#cdd6f4',
      'color.text.secondary': '#a6adc8',
      'color.text.muted': '#6c7086',
      'color.text.inverse': '#1e1e2e',

      'color.border.default': '#45475a',
      'color.border.strong': '#585b70',
      'color.border.subtle': '#313244',

      'color.accent.root': '#89b4fa',
      'color.accent.heading.strong': '#89b4fa',
      'color.accent.heading.medium': '#cba6f7',
      'color.accent.heading.subtle': '#a6adc8',
      'color.accent.text': '#bac2de',
      'color.accent.code': '#fab387',
      'color.accent.quote': '#bb9af7',
      'color.accent.data': '#94e2d5',
      'color.accent.media': '#f9e2af',
      'color.accent.notice': '#f9e2af',

      'color.state.selected': '#89b4fa',
      'color.state.focused': '#f5e0dc',
      'color.state.success': '#a6e3a1',
      'color.state.warning': '#f9e2af',
      'color.state.error': '#f38ba8',
      'color.state.disabled': '#6c7086',
      'color.state.searchMatch': '#f9e2af',
      'color.state.dropAllowed': '#a6e3a1',
      'color.state.dropForbidden': '#f38ba8',

      'color.syntax.keyword': '#cba6f7',
      'color.syntax.string': '#a6e3a1',
      'color.syntax.comment': '#6c7086',
      'color.syntax.number': '#fab387',
      'color.syntax.function': '#89b4fa',
      'color.syntax.variable': '#f38ba8',
      'color.syntax.plain': '#cdd6f4',

      'connector.color': '#585b70',
      'connector.width': '2px',
      'connector.opacity': 0.7,
      'connector.selectedColor': '#89b4fa',
      'connector.style': 'orthogonal',

      'effect.shadow.default': '0 1px 3px rgba(0,0,0,0.2)',
      'effect.shadow.hovered': '0 2px 8px rgba(0,0,0,0.3)',
    },
    light: {
      'color.canvas.background': '#fafafa',
      'color.canvas.grid': '#e0e0e0',
      'color.canvas.gridOpacity': 0.5,

      'color.surface.default': '#ffffff',
      'color.surface.root': '#f0f0f0',
      'color.surface.code': '#f5f5f5',
      'color.surface.quote': '#fafafa',
      'color.surface.table': '#ffffff',
      'color.surface.image': '#ffffff',
      'color.surface.html': '#f5f5f5',
      'color.surface.metadata': '#f0f0f0',
      'color.surface.technical': '#f5f5f5',
      'color.surface.media': '#ffffff',
      'color.surface.data': '#ffffff',
      'color.surface.notice': '#fafafa',
      'color.surface.fallback': '#ffffff',

      'color.text.primary': '#1e1e2e',
      'color.text.secondary': '#585b70',
      'color.text.muted': '#9ca3af',
      'color.text.inverse': '#ffffff',

      'color.border.default': '#d1d5db',
      'color.border.strong': '#9ca3af',
      'color.border.subtle': '#e5e7eb',

      'color.accent.root': '#3b82f6',
      'color.accent.heading.strong': '#3b82f6',
      'color.accent.heading.medium': '#8b5cf6',
      'color.accent.heading.subtle': '#6b7280',
      'color.accent.text': '#4b5563',
      'color.accent.code': '#f97316',
      'color.accent.quote': '#8b5cf6',
      'color.accent.data': '#14b8a6',
      'color.accent.media': '#eab308',
      'color.accent.notice': '#eab308',

      'color.state.selected': '#3b82f6',
      'color.state.focused': '#ef4444',
      'color.state.success': '#22c55e',
      'color.state.warning': '#eab308',
      'color.state.error': '#ef4444',
      'color.state.disabled': '#9ca3af',
      'color.state.searchMatch': '#eab308',
      'color.state.dropAllowed': '#22c55e',
      'color.state.dropForbidden': '#ef4444',

      'color.syntax.keyword': '#8b5cf6',
      'color.syntax.string': '#22c55e',
      'color.syntax.comment': '#9ca3af',
      'color.syntax.number': '#f97316',
      'color.syntax.function': '#3b82f6',
      'color.syntax.variable': '#ef4444',
      'color.syntax.plain': '#1e1e2e',

      'connector.color': '#9ca3af',
      'connector.width': '2px',
      'connector.opacity': 0.7,
      'connector.selectedColor': '#3b82f6',
      'connector.style': 'orthogonal',

      'effect.shadow.default': '0 1px 3px rgba(0,0,0,0.1)',
      'effect.shadow.hovered': '0 2px 8px rgba(0,0,0,0.15)',
    },
  },
  recommendedDensity: 'comfortable',
};
