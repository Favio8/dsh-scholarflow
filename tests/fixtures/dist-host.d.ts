// The build output ships no declarations, so describe only the surface the contracts assert on.
// Keeping this here (rather than casting at the import site) keeps every assertion checked.
declare module '*/dist/host.js' {
  export const Config: { dict: Record<string, { meta: { volatile?: unknown; [key: string]: unknown }; [key: string]: unknown }> }
}
