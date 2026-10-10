// Executable rendering contracts for the approved visual-language PRD, not a new PRD version.
export const SERIF_SELECTORS = [
  '.sf-paper-page',
  '.sf-wizard .sf-outline-edit-row>.sf-outline-title',
  'body .sf-wizard .sf-outline-title',
  'body :is(.sf-wizard h2,.sf-wizard h3,.sf-paper-title,.sf-paper-project h2,.sf-paper-project h3,.sf-paper-project h4,.sf-preset-preview h3,.sf-preset-draft h3,.sf-preset-dialog>header strong,.sf-preset-row strong,.sf-preset-sections strong,.sf-preset-subsections li>span,.sf-boundary h3,.sf-chat-empty h3,.sf-settings h2,.sf-settings h3)',
]
export const FONT_TOKENS = ['--sf-font-xs', '--sf-font-sm', '--sf-font-md', '--sf-font-prose', '--sf-font-title', '--sf-font-display-2', '--sf-font-display-1']

export function typographyInPage(selector) {
  const root = document.querySelector(selector)
  if (!root) return { error: 'missing surface' }
  const sizes = new Set(), smallSerif = []
  for (const el of [root, ...root.querySelectorAll('*')]) {
    const rect = el.getBoundingClientRect()
    if (!el.checkVisibility() || !rect.width || !rect.height) continue
    const style = getComputedStyle(el), size = parseFloat(style.fontSize)
    sizes.add(size)
    const firstFamily = style.fontFamily.split(',')[0].replaceAll('"', '').replaceAll("'", '').trim()
    if (/serif|georgia|times new roman|simsun|宋/i.test(firstFamily) && size < 15)
      smallSerif.push({ tag: el.tagName, className: el.className, firstFamily, size })
  }
  const page = root.querySelector('.sf-paper-page .sf-prose')
  const p = page?.querySelector('p')
  const bodySize = p && parseFloat(getComputedStyle(p).fontSize)
  const headings = bodySize ? [1, 2, 3].map(level => {
    const el = page.querySelector(`h${level}`)
    return el ? { level, ratio: parseFloat(getComputedStyle(el).fontSize) / bodySize } : null
  }).filter(Boolean) : []
  return { sizes: [...sizes], smallSerif, headings,
    exportRatios: window.sfVisualContracts?.headingRatios ?? [] }
}

export function systemSerifInPage() {
  const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 80
  const ctx = canvas.getContext('2d')
  const render = family => { ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.font = `48px "${family}"`; ctx.fillText('学术论文书写', 4, 54); return ctx.getImageData(0, 0, canvas.width, canvas.height).data }
  const serif = render('SimSun'), sans = render('Microsoft YaHei')
  let differingPixels = 0
  for (let index = 0; index < serif.length; index += 4)
    if (serif[index + 3] !== sans[index + 3]) differingPixels++
  return { serif: 'SimSun', sans: 'Microsoft YaHei', differingPixels, status: differingPixels > 0 ? 'passed' : 'pending' }
}
