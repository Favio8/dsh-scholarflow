# Crossref metadata adapter

Verified against the public documentation on **2026-10-05** and the installed
DSH 0.2.0-rc.2 public `ctx.web.fetch` seam. The adapter calls fixed HTTPS Crossref
endpoints. Host transport owns destination checks, proxy routing, redirects,
response caps and cancellation; no alternative fetch path is used.

- Search: `/works`, `query.bibliographic`, bounded `rows`, selected bibliographic
  fields and optional inclusive publication-year filters. The research purpose
  remains local and is not a request parameter. [API documentation](https://api.crossref.org/),
  [filters](https://www.crossref.org/documentation/retrieve-metadata/rest-api/rest-api-filters/).
- Lookup: `/works/{encoded DOI}`. DOI normalization and exact returned-identifier
  matching precede comparison with registered title, authors and year. Source
  metadata, citation keys and evidence are preserved.
- Public access requires no key. Provider pool limits can change; the adapter
  does not promise a fixed free allowance or use a paid token. It allows one
  in-flight request and stops on 401/403/429, other failure statuses, truncation
  or invalid responses. There is no automatic retry. The Host sets a 25-second
  request timeout. [Access and limits](https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/).
- Most bibliographic metadata is factual/public-domain material. Abstracts
  can retain publisher or author rights. This adapter requests no abstract and
  downloads no full text. A returned landing-page DOI is not text access.
  [Metadata and licensing](https://www.crossref.org/documentation/retrieve-metadata/),
  [full-text distinction](https://www.crossref.org/documentation/retrieve-metadata/text-and-data-mining/).

Tests use explicitly marked `TEST_ONLY` metadata stubs for errors and concurrency.
`node tests/e2e/installed-host-smoke.mjs --live-research` separately sends a real
query and DOI lookup through the installed Host in an isolated DSH_HOME. Source
identity may become `matched`, while `textAccess` stays `metadata` and no evidence
is created. This manual, operator-confirmed retrieval does not implement the
remaining multi-query Research Pipeline or its shared stage budget.
