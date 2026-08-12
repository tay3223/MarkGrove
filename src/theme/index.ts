/**
 * Theme module public API.
 *
 * Architecture (spec 002):
 *   Skeleton (fixed) + Density + Semantic Recipe + Theme Tokens + State Overlay
 */

// Types
export type {
  TokenType,
  TokenPermission,
  TokenDeclaration,
  ThemeMode,
  ThemeManifest,
  ThemePackage,
  ThemeSnapshot,
  Density,
  AccessibilityPreferences,
  NodeStateSet,
  ResolveStyleInput,
  ResolvedNodeStyle,
  TextureDeclaration,
  SemanticIconName,
  ThemeValidationResult,
  ThemeValidationError,
} from './types';

// Token registry
export {
  getTokenDeclaration,
  getAllTokens,
  getThemeableTokens,
  getProtectedTokens,
  getPreferenceTokens,
  resolveToken,
  getDefaultTokenMap,
} from './tokens';

// Resolver
export { resolveNodeStyle, generateCssVariables } from './resolver';

// Loader
export {
  registerTheme,
  getTheme,
  getRegisteredThemeIds,
  validateUserOverrides,
  loadThemeSnapshot,
  switchTheme,
  getCurrentSnapshot,
  onThemeChange,
  initializeDefaultTheme,
} from './loader';

// Official themes (side-effect: registers all themes)
export { baseTheme } from './themes/base';
export {
  inkGroveTheme,
  minimalTheme,
  midnightTheme,
  paperTheme,
  neonTheme,
  contrastTheme,
} from './themes/official';
