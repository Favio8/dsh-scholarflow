import { z } from 'zod'
import { invariant } from '../../shared/errors.ts'
import type { HostWeb } from './crossref.ts'

const location = z.object({ is_oa: z.boolean(), pdf_url: z.string().nullable().optional(), landing_page_url: z.string().nullable().optional(),
  version: z.string().nullable().optional(), license: z.string().nullable().optional() })
const work = z.object({ id: z.string(), doi: z.string().nullable().optional(), title: z.string().nullable(), publication_year: z.number().nullable().optional(),
  authorships: z.array(z.object({ author: z.object({ display_name: z.string() }) })).default([]),
  best_oa_location: location.nullable().optional(), locations: z.array(location).default([]) })
export type OpenWork = z.infer<typeof work>
export async function openAlexSearch(web: HostWeb, query: string, signal: AbortSignal): Promise<OpenWork[]> {
  const url = new URL('https://api.openalex.org/works')
  url.searchParams.set('search', query); url.searchParams.set('filter', 'is_oa:true'); url.searchParams.set('per_page', '8')
  url.searchParams.set('select', 'id,doi,title,publication_year,authorships,best_oa_location,locations')
  const result = await web.fetch({ url: url.href }, signal)
  invariant(result.statusCode === 200 && !result.truncated && result.body.kind === 'text', 'RESEARCH_PROVIDER_FAILED', '公开文献检索暂不可用。')
  return z.object({ results: z.array(work) }).parse(JSON.parse(result.body.content)).results
}
export function fulltextLocations(work: OpenWork) {
  const locations = [work.best_oa_location, ...work.locations].filter(location => location?.is_oa)
  const seen = new Set<string>()
  return locations.flatMap(location => [location!.pdf_url, location!.landing_page_url].filter((url): url is string => !!url)
    .map(url => ({ url, version: location!.version ?? 'unknown', license: location!.license ?? null })))
    .filter(location => { if (seen.has(location.url)) return false; seen.add(location.url); return true }).slice(0, 6)
}
