import { z } from 'zod'

const range = { start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }
export const characterFormat = z.object({ ...range, fontZh: z.string().min(1).max(80).optional(),
  fontEn: z.string().min(1).max(80).optional(), sizePt: z.number().min(6).max(72).optional() }).strict()
export const paragraphFormat = z.object({ ...range, alignment: z.enum(['left', 'center', 'right', 'justify']).optional(),
  firstLineIndentChars: z.number().min(0).max(6).optional(), beforePt: z.number().min(0).max(72).optional(),
  afterPt: z.number().min(0).max(72).optional(), lineSpacing: z.number().min(1).max(3).optional() }).strict()
export const documentFormatting = z.object({ characters: z.array(characterFormat).max(1000).default([]),
  paragraphs: z.array(paragraphFormat).max(1000).default([]) }).strict()
export type DocumentFormatting = z.infer<typeof documentFormatting>
export type CharacterFormat = z.infer<typeof characterFormat>
export type ParagraphFormat = z.infer<typeof paragraphFormat>
