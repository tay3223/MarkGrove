/**
 * NodeContainer — the unified container for all mind map nodes (spec 002 §3).
 *
 * Fixed slot structure (spec 002 §3.1):
 *   NodeContainer
 *   ├── Surface
 *   │   ├── Accent
 *   │   ├── Leading
 *   │   ├── Body
 *   │   │   ├── Eyebrow
 *   │   │   ├── Title
 *   │   │   ├── Summary
 *   │   │   └── Preview
 *   │   ├── Trailing
 *   │   └── Actions
 *   ├── Ports
 *   ├── ChildrenToggle
 *   └── StateRing
 *
 * All node types (heading, paragraph, code, table, image, etc.) use this
 * same skeleton. Differences are expressed through semantic recipes
 * (data-driven style selection), not different DOM structures.
 *
 * Key rules:
 *   - Slot names and order are fixed (spec 002 §3.2)
 *   - Body is the only flexible area
 *   - Selection ring drawn outside container, doesn't change size
 *   - Theme tokens consumed via resolveNodeStyle (no hardcoded colors)
 *   - States overlay on top of semantic recipe (spec 002 §6)
 */

import { memo, useMemo, type ReactNode } from 'react';
import type {
  ViewNode,
  SemanticType,
  VisualFamily,
} from '../semantic/types';
import type {
  ResolvedNodeStyle,
  ThemeSnapshot,
  Density,
  AccessibilityPreferences,
  NodeStateSet,
} from '../theme/types';
import { resolveNodeStyle } from '../theme/resolver';
import { getVisualFamily } from '../semantic/identity';

// ─────────────────────────────────────────────────────────────────────────
// Slot components
// ─────────────────────────────────────────────────────────────────────────

interface SlotProps {
  children?: ReactNode;
  style?: React.CSSProperties;
}

/** Left/top semantic accent bar. */
function Accent({ children, style }: SlotProps) {
  return <div className="nc-accent" style={style}>{children}</div>;
}

/** Icon, checkbox, thumbnail area. */
function Leading({ children, style }: SlotProps) {
  return <div className="nc-leading" style={style}>{children}</div>;
}

/** Type/language/level short label. */
function Eyebrow({ children, style }: SlotProps) {
  if (!children) return null;
  return <div className="nc-eyebrow" style={style}>{children}</div>;
}

/** Primary text content. */
function Title({ children, style }: SlotProps) {
  return <div className="nc-title" style={style}>{children}</div>;
}

/** Secondary summary text. */
function Summary({ children, style }: SlotProps) {
  if (!children) return null;
  return <div className="nc-summary" style={style}>{children}</div>;
}

/** Code/table/image preview. */
function Preview({ children, style }: SlotProps) {
  if (!children) return null;
  return <div className="nc-preview" style={style}>{children}</div>;
}

/** Badges, counts, status, collapse button. */
function Trailing({ children, style }: SlotProps) {
  if (!children) return null;
  return <div className="nc-trailing" style={style}>{children}</div>;
}

/** Hover/selection action area. */
function Actions({ children, style }: SlotProps) {
  if (!children) return null;
  return <div className="nc-actions" style={style}>{children}</div>;
}

/** Connection anchor points. */
function Ports() {
  return <div className="nc-ports" aria-hidden="true" />;
}

/** Expand/collapse toggle. */
function ChildrenToggle({
  expanded,
  childCount,
  onClick,
}: {
  expanded: boolean;
  childCount: number;
  onClick?: () => void;
}) {
  if (childCount === 0) return null;
  return (
    <button
      className="nc-children-toggle"
      onClick={onClick}
      aria-label={expanded ? '折叠子节点' : '展开子节点'}
      aria-expanded={expanded}
    >
      {expanded ? '−' : '+'}
      <span className="nc-child-count">{childCount}</span>
    </button>
  );
}

/** Selection/focus/error outer ring. */
function StateRing({ color, width }: { color: string | null; width: string | null }) {
  if (!color || !width) return null;
  return (
    <div
      className="nc-state-ring"
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: `-${width}`,
        borderRadius: 'inherit',
        border: `${width} solid ${color}`,
        pointerEvents: 'none',
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Semantic recipe: content per node type (spec 002 §5)
// ─────────────────────────────────────────────────────────────────────────

interface RecipeContent {
  leading: ReactNode;
  eyebrow: ReactNode;
  title: ReactNode;
  summary: ReactNode;
  preview: ReactNode;
  trailing: ReactNode;
  actions: ReactNode;
}

/** Build the semantic recipe content for a view node. */
function buildRecipe(viewNode: ViewNode): RecipeContent {
  const base: RecipeContent = {
    leading: null,
    eyebrow: viewNode.eyebrow,
    title: viewNode.displayText,
    summary: viewNode.summary,
    preview: null,
    trailing: null,
    actions: null,
  };

  switch (viewNode.semanticType) {
    case 'root':
      return {
        ...base,
        leading: <span className="nc-icon nc-icon-root">📄</span>,
        trailing: <ChildrenToggle
          expanded={viewNode.expanded}
          childCount={viewNode.children.length}
        />,
      };

    case 'heading':
      return {
        ...base,
        trailing: <ChildrenToggle
          expanded={viewNode.expanded}
          childCount={viewNode.children.length}
        />,
      };

    case 'list-item': {
      // Leading: bullet, number, or checkbox
      if (viewNode.eyebrow === '✓') {
        base.leading = <span className="nc-checkbox nc-checked">☑</span>;
      } else if (viewNode.eyebrow === '○') {
        base.leading = <span className="nc-checkbox nc-unchecked">☐</span>;
      } else if (viewNode.eyebrow === '有序') {
        base.leading = <span className="nc-bullet nc-ordered">•</span>;
      } else {
        base.leading = <span className="nc-bullet nc-unordered">•</span>;
      }
      base.eyebrow = null; // eyebrow was used for type detection
      return {
        ...base,
        trailing: <ChildrenToggle
          expanded={viewNode.expanded}
          childCount={viewNode.children.length}
        />,
      };
    }

    case 'quote':
      return {
        ...base,
        leading: <span className="nc-icon nc-icon-quote">❝</span>,
        trailing: <ChildrenToggle
          expanded={viewNode.expanded}
          childCount={viewNode.children.length}
        />,
      };

    case 'code':
      return {
        ...base,
        eyebrow: viewNode.eyebrow || 'text',
        preview: viewNode.preview?.kind === 'code' ? (
          <pre className="nc-code-preview">
            <code>{viewNode.preview.lines.join('\n')}</code>
          </pre>
        ) : null,
        trailing: <span className="nc-line-count">
          {viewNode.preview?.kind === 'code' ? `${viewNode.preview.lines.length}+ 行` : ''}
        </span>,
      };

    case 'table':
      return {
        ...base,
        leading: <span className="nc-icon nc-icon-table">▦</span>,
        preview: viewNode.preview?.kind === 'table' ? (
          <div className="nc-table-preview">
            <div className="nc-table-headers">
              {viewNode.preview.headers.map((h, i) => (
                <span key={i} className="nc-table-cell">{h}</span>
              ))}
            </div>
            {viewNode.preview.previewRows.map((row, i) => (
              <div key={i} className="nc-table-row">
                {row.map((cell, j) => (
                  <span key={j} className="nc-table-cell">{cell}</span>
                ))}
              </div>
            ))}
          </div>
        ) : null,
      };

    case 'image':
      return {
        ...base,
        preview: viewNode.preview?.kind === 'image' ? (
          <img
            className="nc-image-preview"
            src={viewNode.preview.src}
            alt={viewNode.preview.alt}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : null,
      };

    case 'html':
      return {
        ...base,
        leading: <span className="nc-icon nc-icon-html">{'</>'}</span>,
      };

    case 'metadata':
      return {
        ...base,
        leading: <span className="nc-icon nc-icon-metadata">⚙</span>,
      };

    case 'footnote':
      return {
        ...base,
        leading: <span className="nc-icon nc-icon-footnote">†</span>,
      };

    case 'math':
      return {
        ...base,
        leading: <span className="nc-icon nc-icon-math">∑</span>,
      };

    case 'diagram':
      return {
        ...base,
        leading: <span className="nc-icon nc-icon-diagram">📊</span>,
      };

    case 'callout':
      return {
        ...base,
        trailing: <ChildrenToggle
          expanded={viewNode.expanded}
          childCount={viewNode.children.length}
        />,
      };

    case 'extension':
    case 'unknown':
      return {
        ...base,
        leading: <span className="nc-icon nc-icon-unknown">?</span>,
        trailing: <span className="nc-badge nc-badge-unknown">未识别</span>,
      };

    default:
      return base;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// NodeContainer component
// ─────────────────────────────────────────────────────────────────────────

export interface NodeContainerProps {
  viewNode: ViewNode;
  themeSnapshot: ThemeSnapshot;
  density: Density;
  accessibility: AccessibilityPreferences;
  /** Override states (e.g. from parent selection management). */
  states?: Partial<NodeStateSet>;
  /** Click handler. */
  onClick?: (nodeId: string | null) => void;
  /** Double-click handler (typically navigate to source). */
  onDoubleClick?: (nodeId: string | null) => void;
  /** Children toggle handler. */
  onToggleChildren?: (nodeId: string | null) => void;
  /** Whether to render children inline. */
  renderChildren?: boolean;
  /** Child nodes to render. */
  children?: ReactNode;
}

/** The unified NodeContainer component. */
function NodeContainerImpl({
  viewNode,
  themeSnapshot,
  density,
  accessibility,
  states,
  onClick,
  onDoubleClick,
  onToggleChildren,
  renderChildren = true,
  children,
}: NodeContainerProps) {
  // Resolve style (pure function)
  const style: ResolvedNodeStyle = useMemo(
    () => resolveNodeStyle({
      semanticType: viewNode.semanticType,
      visualFamily: viewNode.visualFamily,
      headingLevel: viewNode.semanticType === 'heading'
        ? parseInt(viewNode.eyebrow?.replace('H', '') || '1', 10)
        : undefined,
      role: getRoleForType(viewNode.semanticType),
      states: { ...states, selected: viewNode.selected },
      themeSnapshot,
      densityPreference: density,
      accessibilityPreferences: accessibility,
    }),
    [viewNode, themeSnapshot, density, accessibility, states],
  );

  // Build semantic recipe content
  const recipe = useMemo(() => buildRecipe(viewNode), [viewNode]);

  // Container style
  const containerStyle: React.CSSProperties = {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    minWidth: style.minWidth,
    maxWidth: style.maxWidth,
    padding: `${style.paddingY} ${style.paddingX}`,
    backgroundColor: style.surfaceBackground,
    border: `${style.surfaceBorderWidth} solid ${style.surfaceBorder}`,
    borderRadius: style.surfaceRadius,
    boxShadow: style.shadow,
    opacity: style.opacity,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: Number(style.fontWeight),
    lineHeight: style.lineHeight,
    color: style.textColor,
    cursor: onClick ? 'pointer' : 'default',
    transition: accessibility.reducedMotion ? 'none' : `box-shadow ${150}ms ease-out`,
  };

  const surfaceStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
  };

  const bodyStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  };

  return (
    <div
      className="node-container"
      data-semantic-type={viewNode.semanticType}
      data-visual-family={viewNode.visualFamily}
      data-generated={viewNode.generated || undefined}
      data-node-id={viewNode.semanticNodeId || undefined}
      style={containerStyle}
      onClick={() => onClick?.(viewNode.semanticNodeId)}
      onDoubleClick={() => onDoubleClick?.(viewNode.semanticNodeId)}
      role="treeitem"
      aria-selected={viewNode.selected}
      aria-expanded={viewNode.children.length > 0 ? viewNode.expanded : undefined}
    >
      <StateRing color={style.stateRingColor} width={style.stateRingWidth} />

      {/* Accent bar */}
      <div
        className="nc-accent-bar"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: style.accentWidth,
          backgroundColor: style.accentColor,
          borderRadius: `${style.surfaceRadius} 0 0 ${style.surfaceRadius}`,
        }}
      />

      <div className="nc-surface" style={surfaceStyle}>
        {recipe.leading && <Leading>{recipe.leading}</Leading>}

        <div className="nc-body" style={bodyStyle}>
          {recipe.eyebrow && (
            <Eyebrow style={{ fontSize: '10px', color: style.textColor, opacity: 0.6 }}>
              {recipe.eyebrow}
            </Eyebrow>
          )}
          <Title>{recipe.title}</Title>
          {recipe.summary && <Summary>{recipe.summary}</Summary>}
          {recipe.preview && <Preview>{recipe.preview}</Preview>}
        </div>

        {recipe.trailing && <Trailing>{recipe.trailing}</Trailing>}
        {recipe.actions && <Actions>{recipe.actions}</Actions>}
      </div>

      <Ports />

      {renderChildren && viewNode.children.length > 0 && viewNode.expanded && (
        <div className="nc-children" style={{ marginTop: '4px' }}>
          {children}
        </div>
      )}
    </div>
  );
}

/** Get the structural role for a semantic type. */
function getRoleForType(type: SemanticType): import('../semantic/types').NodeRole {
  switch (type) {
    case 'root':
      return 'document-root';
    case 'heading':
      return 'section-container';
    case 'list-item':
    case 'quote':
    case 'callout':
    case 'definition-item':
      return 'block-container';
    default:
      return 'block-leaf';
  }
}

/** Memoized NodeContainer to prevent unnecessary re-renders. */
export const NodeContainer = memo(NodeContainerImpl);
