import { z } from 'zod'
import { ScholarError } from '../../shared/errors.ts'

/** Accept one complete JSON response, optionally wrapped in a Markdown code block.
 * Never search prose for an arbitrary object or evaluate JavaScript. */
export function parseOutlineJson(raw: string): unknown {
  const text = raw.replace(/^\uFEFF/, '').trim()
  const fenced = /^```(?:json)?[\t ]*\r?\n([\s\S]*?)\r?\n```$/i.exec(text)
  return JSON.parse(fenced ? fenced[1] : text)
}

function formatIssues(error: z.ZodError | SyntaxError | ScholarError) {
  if (error instanceof ScholarError) return (error.details.fields as string[] ?? ['coverage']).map(path => ({ path, code: error.code }))
  return error instanceof z.ZodError ? error.issues.map(issue => ({ path: issue.path.join('.'), code: issue.code })) : [{ path: 'JSON', code: 'invalid_json' }]
}

/** One JSON/contract retry per stage; negative semantic judgments and source invariants remain intact. */
export async function readOutlineResponse<T>(raw: string, validate: (value: unknown) => T,
  repair: (previous: string, issues: { path: string; code: string }[]) => Promise<string>, stage: 'generation' | 'review'): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return validate(parseOutlineJson(raw)) }
    catch (error) {
      const reviewContract = stage === 'review' && error instanceof ScholarError && error.code === 'OUTLINE_REVIEW_INVALID' && error.details.repairable === true
      if (!(error instanceof z.ZodError) && !(error instanceof SyntaxError) && !reviewContract) throw error
      const issues = formatIssues(error)
      if (!attempt) { raw = await repair(raw, issues); continue }
      const label = stage === 'generation' ? '大纲' : '大纲覆盖检查'
      throw new ScholarError(stage === 'generation' ? 'OUTLINE_INVALID' : 'OUTLINE_REVIEW_INVALID',
        `${label}返回格式仍不符合要求，已尝试修复一次；请重试，原结构未改变。`,
        { ...(error instanceof ScholarError ? error.details : {}), operation: `outline.${stage}`, repairable: false, fields: issues.map(issue => issue.path), formatIssues: issues })
    }
  }
  throw new Error('Unreachable outline response state')
}
