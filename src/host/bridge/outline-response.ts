import { z } from 'zod'
import { ScholarError } from '../../shared/errors.ts'

/** Accept one complete JSON response, optionally wrapped in a Markdown code block.
 * Never search prose for an arbitrary object or evaluate JavaScript. */
export function parseOutlineJson(raw: string): unknown {
  const text = raw.replace(/^\uFEFF/, '').trim()
  const fenced = /^```(?:json)?[\t ]*\r?\n([\s\S]*?)\r?\n```$/i.exec(text)
  return JSON.parse(fenced ? fenced[1] : text)
}

function formatIssues(error: z.ZodError | SyntaxError) {
  return error instanceof z.ZodError ? error.issues.map(issue => ({ path: issue.path.join('.'), code: issue.code })) : [{ path: 'JSON', code: 'invalid_json' }]
}

/** One format-only retry per stage; semantic/source invariants are never relaxed. */
export async function readOutlineResponse<T>(raw: string, validate: (value: unknown) => T,
  repair: (previous: string, issues: { path: string; code: string }[]) => Promise<string>, stage: 'generation' | 'review'): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return validate(parseOutlineJson(raw)) }
    catch (error) {
      if (!(error instanceof z.ZodError) && !(error instanceof SyntaxError)) throw error
      const issues = formatIssues(error)
      if (!attempt) { raw = await repair(raw, issues); continue }
      const label = stage === 'generation' ? '大纲' : '大纲覆盖检查'
      throw new ScholarError(stage === 'generation' ? 'OUTLINE_INVALID' : 'OUTLINE_REVIEW_INVALID',
        `${label}返回格式仍不符合要求，已尝试修复一次；请重试，原结构未改变。`, { operation: `outline.${stage}`, fields: issues.map(issue => issue.path), formatIssues: issues })
    }
  }
  throw new Error('Unreachable outline response state')
}
