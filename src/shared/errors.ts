import { z } from 'zod'

export class ScholarError extends Error {
  readonly code: string
  readonly details: Record<string, unknown>
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message); this.name = 'ScholarError'; this.code = code; this.details = details
  }
}
export function invariant(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new ScholarError(code, message)
}

/** Identify the boundary, without copying private values into diagnostic details. */
export function parseStored<T>(schema: z.ZodType<T>, text: string, code: string, operation: string): T {
  try { return schema.parse(JSON.parse(text)) }
  catch (error) {
    if (!(error instanceof z.ZodError) && !(error instanceof SyntaxError)) throw error
    throw new ScholarError(code, '历史记录暂不可用，原文件已保留。', { category: 'stored-data', operation,
      fields: error instanceof z.ZodError ? error.issues.map(issue => issue.path.join('.')) : [] })
  }
}

export function parseModel<T>(schema: z.ZodType<T>, text: string, operation: string): T {
  try { return schema.parse(JSON.parse(text)) }
  catch (error) {
    if (!(error instanceof z.ZodError) && !(error instanceof SyntaxError)) throw error
    throw new ScholarError('INVALID_MODEL_OUTPUT', '模型未返回可用结果，请重试。', { category: 'model-response', operation,
      fields: error instanceof z.ZodError ? error.issues.map(issue => issue.path.join('.')) : [] })
  }
}
