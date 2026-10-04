import { z } from 'zod'
import { projectType, relativePath } from './schema.ts'

export const newProjectDefaultsSchema = z.object({
  defaultProjectType: projectType,
  language: z.enum(['zh', 'en']),
  maxModelCalls: z.number().int().min(1).max(40),
})
export const initInputSchema = z.object({ title: z.string().trim().min(1).max(300), type: projectType.optional(),
  language: z.enum(['zh-CN', 'en']).optional(), manuscriptDir: relativePath.optional(),
  maxModelCalls: z.number().int().min(1).max(40).optional() }).strict()

export function resolveInitDefaults(input: z.infer<typeof initInputSchema>, defaults: z.infer<typeof newProjectDefaultsSchema>) {
  const parsed = initInputSchema.parse(input), valid = newProjectDefaultsSchema.parse(defaults)
  return { ...parsed, type: parsed.type ?? valid.defaultProjectType,
    language: parsed.language ?? (valid.language === 'zh' ? 'zh-CN' as const : 'en' as const),
    maxModelCalls: parsed.maxModelCalls ?? valid.maxModelCalls }
}
