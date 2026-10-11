// Executable rendering contracts for the approved visual-language PRD, not a new PRD version.
export const SERIF_SELECTORS = [
  '.sf-paper-page',
  'body :is(.sf-app,.sf-wizard,.sf-preset-dialog,.sf-text-prompt,.sf-boundary) .sf-change-diff',
  '.sf-wizard .sf-outline-edit-row>.sf-outline-title',
  'body .sf-wizard .sf-outline-title',
  'body .sf-state.sf-state h3',
  'body :is(.sf-wizard h2,.sf-wizard h3,.sf-paper-title,.sf-paper-project h2,.sf-paper-project h3,.sf-paper-project h4,.sf-preset-preview h3,.sf-preset-draft h3,.sf-preset-dialog>header strong,.sf-preset-row strong,.sf-preset-sections strong,.sf-preset-subsections li>span,.sf-boundary h3,.sf-chat-empty h3,.sf-settings h2,.sf-settings h3)',
]
export const FONT_TOKENS = ['--sf-font-xs', '--sf-font-sm', '--sf-font-md', '--sf-font-prose', '--sf-font-title', '--sf-font-display-2', '--sf-font-display-1']

export function geometryInPage(selector) {
  const root = document.querySelector(selector)
  const isControl = el => el.matches('button,input,select,textarea,option,summary,[role=button]')
  const visible = el => { const box = el.getBoundingClientRect(); return box.width > 0 && box.height > 0 && el.checkVisibility() }
  const opaque = color => !/rgba\([^)]*,\s*0\s*\)|transparent/.test(color)
  const painted = el => {
    if (isControl(el) || el.closest('.sf-source-marks')) return false
    const style = getComputedStyle(el)
    return opaque(style.backgroundColor) || ['Top','Right','Bottom','Left'].some(side =>
      parseFloat(style[`border${side}Width`]) > 0 && style[`border${side}Style`] !== 'none' && opaque(style[`border${side}Color`]))
  }
  const depths = [], radiusFailures = [], selects = []
  for (const el of root.querySelectorAll('*')) {
    if (!visible(el)) continue
    if (el.closest('.sf-native-tools,[data-conversation-content]')) continue
    const style = getComputedStyle(el), box = el.getBoundingClientRect()
    const radius = style.borderRadius
    const mark = el.closest('.sf-source-paper,.sf-mark-inline')
    const circular = radius === '50%' && Math.abs(box.width - box.height) <= 1
    const micro = Math.min(box.width, box.height) <= 10 || el.matches('code')
    if (!mark && !circular && !micro && !['0px','6px','10px','999px'].includes(radius)) radiusFailures.push({ className: el.className, radius })
    const ancestors = []
    for (let node = el.parentElement; node; node = node.parentElement) {
      if (painted(node)) ancestors.push(node.className || node.tagName)
      if (node === root) break
    }
    if (ancestors.length > 2) depths.push({ className: el.className, ancestors })
    if (el.matches('select')) selects.push({ appearance: style.appearance })
  }
  const pages = [...root.querySelectorAll('.sf-paper-page')].map(el => {
    const style = getComputedStyle(el), parent = getComputedStyle(el.parentElement)
    const font = parseFloat(style.fontSize), width = el.getBoundingClientRect().width
    const available = el.parentElement.clientWidth - parseFloat(parent.paddingLeft) - parseFloat(parent.paddingRight)
    return { width, font, characters: width / font, availableCharacters: available / font,
      constrainedByPane: available / font < 34, background: style.backgroundColor, border: style.borderColor, shadow: style.boxShadow }
  })
  const materialPanel = root.querySelector('.sf-materials-panel')
  const materialGrid = materialPanel?.querySelector('.sf-materials-grid')
  const materialCards = [...(materialGrid?.querySelectorAll('.sf-material-row') ?? [])].map(card => {
    const box = card.getBoundingClientRect(), style = getComputedStyle(card)
    const title = card.querySelector('strong'), status = card.querySelector('small')
    const fragments = [title, status].flatMap(el => {
      const range = document.createRange(); range.selectNodeContents(el)
      return [...range.getClientRects()]
    })
    return { title: title.textContent, status: status.textContent, height: box.height,
      top: box.top, bottom: box.bottom, disabled: card.disabled, textAlign: style.textAlign,
      contentContained: fragments.every(rect => rect.left >= box.left + parseFloat(style.paddingLeft) - 1
        && rect.right <= box.right - parseFloat(style.paddingRight) + 1
        && rect.top >= box.top + parseFloat(style.paddingTop) - 1
        && rect.bottom <= box.bottom - parseFloat(style.paddingBottom) + 1),
      separateStatus: title.getBoundingClientRect().bottom <= status.getBoundingClientRect().top + 1 }
  })
  const materialHeading = materialPanel?.querySelector(':scope > h3')
  const materials = materialCards.length ? { cards: materialCards,
    overflow: materialPanel.scrollWidth - materialPanel.clientWidth,
    referenceGap: materialHeading.getBoundingClientRect().top - materialGrid.getBoundingClientRect().bottom,
  } : null
  return { depths, radiusFailures, selects, pages, materials }
}

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

export function paletteInPage() {
  const root = getComputedStyle(document.body), probe = document.createElement('span')
  probe.hidden = true; document.body.append(probe)
  const rgb = token => {
    probe.style.color = `var(${token})`
    return getComputedStyle(probe).color.match(/[\d.]+/g)?.slice(0, 3).map(Number)
  }
  const neutral = ['paper','surface','surface-2','hover','text','muted','text-faint','border','border-soft','border-strong','fill','scrim','page-bg','page-text','page-muted','page-faint']
    .map(name => ({ name: `--sf-${name}`, rgb: rgb(`--sf-${name}`) }))
  const luminance = value => { const c = value.map(n => { const s = n / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4 }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2] }
  const hue = value => {
    const [r,g,b] = value.map(n => n / 255), max = Math.max(r,g,b), min = Math.min(r,g,b), c = max-min
    return { degrees: c ? ((max === r ? (g-b)/c : max === g ? (b-r)/c+2 : (r-g)/c+4) * 60 + 360) % 360 : 0,
      saturation: max ? c/max : 0, chroma: c*255 }
  }
  const accent = hue(rgb('--sf-accent')), hueFailures = []
  for (const name of root) {
    if (!name.startsWith('--sf-') || /^--sf-(danger|ok|warn|mark-|wash-)/.test(name) || name === '--sf-selection-tint') continue
    const value = root.getPropertyValue(name).trim()
    if (!CSS.supports('color', value)) continue
    const current = hue(rgb(name)), delta = Math.abs(current.degrees - accent.degrees)
    // The PRD distinguishes neutral families from non-neutral accents. Absolute chroma
    // keeps near-white/warm-ink neutral shades from being misclassified by HSV saturation.
    if (current.chroma > 24 && current.saturation >= .15 && Math.min(delta, 360-delta) > 15) hueFailures.push({ name, ...current })
  }
  const surfaceBrighterThanPaper = luminance(rgb('--sf-surface')) > luminance(rgb('--sf-paper'))
  probe.remove()
  return { neutral, hueFailures, surfaceBrighterThanPaper }
}

export function stateAndIconsInPage(selector) {
  const root = document.querySelector(selector)
  const visible = el => { const box=el.getBoundingClientRect();return box.width>0 && box.height>0 && el.checkVisibility() }
  const icons = [...root.querySelectorAll('svg')].filter(visible).filter(el => !el.closest('.sf-native-tools,[data-conversation-content]'))
    .map(el => ({ width: parseFloat(getComputedStyle(el).width), stroke: getComputedStyle(el).strokeWidth }))
  const states = [...root.querySelectorAll('.sf-state')].filter(visible).map(el => ({
    kind: [...el.classList].find(name => ['sf-state-empty','sf-state-loading','sf-state-error'].includes(name)),
    title: el.querySelector('h3')?.textContent, description: el.querySelector('.sf-state-body>p')?.textContent,
    actions: el.querySelectorAll(':scope>button').length,
    totalActions: el.querySelectorAll('button').length,
  }))
  const source = root.querySelector('.sf-source-pane'), page = root.querySelector('.sf-paper-page')
  const seam = source && page ? { sourceBackground: getComputedStyle(source).backgroundColor,
    pageBackground: getComputedStyle(page).backgroundColor, sourceBorder: getComputedStyle(source).borderRightColor,
    pageBorder: getComputedStyle(page).borderColor, sourceShadow: getComputedStyle(source).boxShadow,
    pageShadow: getComputedStyle(page).boxShadow } : null
  return { icons, states, seam }
}
