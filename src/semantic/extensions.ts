/**
 * Extension registry (spec 001 §18.4).
 *
 * Extensions register new node types without modifying the core tree algorithm.
 * Each extension declares its type, visual family, role, capabilities,
 * and default visibility in each projection mode.
 */

import type { ExtensionDeclaration, SemanticType } from './types';

const registry = new Map<SemanticType, ExtensionDeclaration>();

/** Register an extension declaration. */
export function registerExtension(decl: ExtensionDeclaration): void {
  registry.set(decl.type, decl);
}

/** Look up an extension declaration by type. */
export function getExtension(type: SemanticType): ExtensionDeclaration | undefined {
  return registry.get(type);
}

/** Check if a type is a registered extension. */
export function isExtension(type: SemanticType): boolean {
  return registry.has(type);
}

/** Get all registered extensions. */
export function getAllExtensions(): ExtensionDeclaration[] {
  return Array.from(registry.values());
}

// ─────────────────────────────────────────────────────────────────────────
// Built-in extension declarations
// ─────────────────────────────────────────────────────────────────────────

registerExtension({
  type: 'math',
  visualFamily: 'technical',
  role: 'block-leaf',
  capabilities: {
    inlineEditable: false,
    hasSpecialEditor: true,
    canHaveChildren: false,
    movable: true,
    convertible: false,
    convertibleTo: [],
  },
  defaultVisibility: {
    structure: 'indicator',
    balanced: 'visible',
    complete: 'visible',
  },
});

registerExtension({
  type: 'diagram',
  visualFamily: 'technical',
  role: 'block-leaf',
  capabilities: {
    inlineEditable: false,
    hasSpecialEditor: true,
    canHaveChildren: false,
    movable: true,
    convertible: false,
    convertibleTo: [],
  },
  defaultVisibility: {
    structure: 'indicator',
    balanced: 'visible',
    complete: 'visible',
  },
});

registerExtension({
  type: 'callout',
  visualFamily: 'notice',
  role: 'block-container',
  capabilities: {
    inlineEditable: true,
    hasSpecialEditor: true,
    canHaveChildren: true,
    movable: true,
    convertible: true,
    convertibleTo: ['quote', 'paragraph'],
  },
  defaultVisibility: {
    structure: 'visible',
    balanced: 'visible',
    complete: 'visible',
  },
});

registerExtension({
  type: 'definition-item',
  visualFamily: 'textual',
  role: 'block-container',
  capabilities: {
    inlineEditable: true,
    hasSpecialEditor: false,
    canHaveChildren: true,
    movable: true,
    convertible: true,
    convertibleTo: ['paragraph'],
  },
  defaultVisibility: {
    structure: 'indicator',
    balanced: 'visible',
    complete: 'visible',
  },
});
