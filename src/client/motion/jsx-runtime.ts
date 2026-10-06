import React from 'react'

/**
 * The automatic JSX runtime, implemented on the host's React.
 *
 * A dependency built with `jsx-runtime` asks for `react/jsx-runtime`, which esbuild externalises
 * together with `react` — and the host supplies one React pair and nothing else. Bundling React's
 * own file instead made the plugin pick the development runtime while the host serves production
 * React, whose shared internals do not carry the fields the development build reads; that surfaced
 * as `Cannot read properties of undefined (reading 'recentlyCreatedOwnerStacks')` and took the whole
 * surface down.
 *
 * Going through `React.createElement` keeps exactly one React, needs no internals, and does not
 * depend on `process.env.NODE_ENV` being defined in the browser.
 */
export const Fragment = React.Fragment

function create(type: unknown, props: Record<string, unknown> | null, key: unknown) {
  return key === undefined
    ? React.createElement(type as never, props as never)
    : React.createElement(type as never, { ...(props ?? {}), key } as never)
}

export const jsx = create
export const jsxs = create
export const jsxDEV = create
