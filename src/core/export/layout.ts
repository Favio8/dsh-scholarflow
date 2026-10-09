import type { TypographySpec } from '../../shared/writing-task.ts'

// The layout decisions the exporter makes when the assignment does not state them. They
// follow the conventions Chinese coursework is normally submitted under; every one of them
// is a field on TypographySpec, so a requirement that says otherwise wins over all of this.
//
// Reference: Gostyan/docx-skill-4-cn-paper (MIT) for the page, font and numbering values, and
// Doryoku1223/lunwen-skill for the front-matter pagination and the keyword paragraph.

export interface LayoutSpec {
  headingNumbering: 'none' | 'decimal' | 'chinese'
  headingFontZh: string
  firstLineIndentChars: number
  captionSizePt: number
  tableStyle: 'three-line' | 'grid'
  referenceStyle: 'gbt7714' | 'plain'
  tableOfContents: 'none' | 'field' | 'auto'
}

export const DEFAULT_LAYOUT: LayoutSpec = { headingNumbering: 'decimal', headingFontZh: '黑体', firstLineIndentChars: 2,
  captionSizePt: 10.5, tableStyle: 'three-line', referenceStyle: 'gbt7714', tableOfContents: 'auto' }

/** Word measures font size in half-points and lengths in twentieths of a point. */
export const HALF_POINT = 2, TWIP = 20

/** 一级标题三号、二级四号、三级小四 — each one step down from the body size. */
export function headingSizes(bodySizePt: number) {
  return { 1: Math.round(bodySizePt * 4 / 3 * HALF_POINT) / HALF_POINT, 2: Math.round(bodySizePt * 7 / 6 * HALF_POINT) / HALF_POINT,
    3: bodySizePt }
}

/** Two characters of the body font, which is what 首行缩进 2 字符 means regardless of size. */
export function firstLineIndentTwips(bodySizePt: number, chars: number): number {
  return Math.round(chars * bodySizePt * TWIP)
}

/** A4 with 25 mm margins, the value the shipped default already carries. */
export const A4 = { width: 11906, height: 16838, margin: Math.round(25 * 56.6929) }

/** 1.5 pt top and bottom rules, 0.75 pt under the header row: a three-line table. */
export const THREE_LINE = { top: 12, bottom: 12, header: 6 }

/**
 * The layout decisions for this delivery. The spec wins over the defaults; the language only
 * fills in what the spec cannot express, because a Chinese heading font name means nothing in
 * an English document and GB/T 7714 is a Chinese national standard.
 */
export function layoutOf(typography: TypographySpec, language: 'zh-CN' | 'en'): LayoutSpec {
  const base: LayoutSpec = {
    headingNumbering: typography.headingNumbering ?? DEFAULT_LAYOUT.headingNumbering,
    headingFontZh: typography.headingFontZh ?? DEFAULT_LAYOUT.headingFontZh,
    firstLineIndentChars: typography.firstLineIndentChars ?? DEFAULT_LAYOUT.firstLineIndentChars,
    captionSizePt: typography.captionSizePt ?? DEFAULT_LAYOUT.captionSizePt,
    tableStyle: typography.tableStyle ?? DEFAULT_LAYOUT.tableStyle,
    referenceStyle: typography.referenceStyle ?? DEFAULT_LAYOUT.referenceStyle,
    tableOfContents: typography.tableOfContents ?? DEFAULT_LAYOUT.tableOfContents,
  }
  if (language !== 'zh-CN') return { ...base, headingFontZh: typography.bodyFontEn, referenceStyle: 'plain' }
  return base
}
