// AT-61 / G1-W3: measure the actual pagination of an exported DOCX. Export returning 200 and
// the XML carrying `w:line="288"` prove nothing about how many pages the reader sees, so this
// converts the file with a real office engine and counts real pages, then optionally asks
// Microsoft Word itself through COM for the authoritative figure.
//
// Usage: node scripts/measure-pagination.mjs <file.docx> [--json out.json] [--no-word]
import { readFile, writeFile, mkdir, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { resolve, dirname, join, basename } from 'node:path'
import { tmpdir } from 'node:os'

const SOFFICE = 'C:/Program Files/LibreOffice/program/soffice.exe'
const POWERSHELL = join(process.env.SystemRoot ?? 'C:/Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')

export async function convertToPdf(docxPath, outDir) {
  await mkdir(outDir, { recursive: true })
  await rm(join(outDir, basename(docxPath).replace(/\.docx$/i, '.pdf')), { force: true })
  const code = await new Promise(done => {
    const child = spawn(SOFFICE, ['--headless', '--norestore', '--convert-to', 'pdf', '--outdir', outDir, docxPath], { windowsHide: true, stdio: 'ignore' })
    child.on('exit', value => done(value ?? 1))
    child.on('error', () => done(1))
  })
  const pdf = join(outDir, basename(docxPath).replace(/\.docx$/i, '.pdf'))
  if (code !== 0 || !existsSync(pdf)) throw new Error(`LibreOffice did not produce a PDF (exit ${code})`)
  return pdf
}

/** Page count and per-page text through the same PDF engine the reader would use. */
export async function readPdf(pdfPath) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(await readFile(pdfPath))
  const document = await getDocument({ data, useSystemFonts: true, isEvalSupported: false }).promise
  const pages = []
  for (let index = 1; index <= document.numPages; index++) {
    const page = await document.getPage(index)
    const content = await page.getTextContent()
    pages.push({ index, text: content.items.map(item => item.str).join('').replace(/\s+/g, ' ').trim(),
      width: page.getViewport({ scale: 1 }).width, height: page.getViewport({ scale: 1 }).height })
  }
  if (typeof document.destroy === 'function') await document.destroy()
  else if (typeof document.cleanup === 'function') await document.cleanup()
  return pages
}

/** The authoritative count comes from Word itself; nothing else can claim "opened in Word". */
export async function wordPageCount(docxPath) {
  if (!existsSync(POWERSHELL)) return { available: false, reason: 'PowerShell 不可用' }
  const script = [
    '$ErrorActionPreference="Stop"',
    'try { $w = New-Object -ComObject Word.Application } catch { Write-Output "UNAVAILABLE"; exit 0 }',
    '$w.Visible = $false',
    '$w.DisplayAlerts = 0',
    `$doc = $w.Documents.Open("${docxPath.replaceAll('\\', '\\\\')}", $false, $true)`,
    '$doc.Repaginate()',
    '$pages = $doc.ComputeStatistics(2)',
    '$words = $doc.ComputeStatistics(0)',
    '$version = $w.Version',
    'Write-Output "PAGES=$pages"',
    'Write-Output "WORDS=$words"',
    'Write-Output "VERSION=$version"',
    '$doc.Close($false)',
    '$w.Quit()',
  ].join('; ')
  const output = await new Promise(done => {
    const child = spawn(POWERSHELL, ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true })
    let text = ''
    child.stdout.on('data', chunk => { text += chunk.toString() })
    child.stderr.on('data', chunk => { text += chunk.toString() })
    child.on('error', () => done('UNAVAILABLE'))
    child.on('close', () => done(text))
  })
  if (/UNAVAILABLE/.test(output)) return { available: false, reason: '这台机器没有安装 Microsoft Word 或 COM 不可用' }
  const pages = Number(/PAGES=(\d+)/.exec(output)?.[1])
  const words = Number(/WORDS=(\d+)/.exec(output)?.[1])
  const version = /VERSION=([^\r\n]+)/.exec(output)?.[1]?.trim()
  if (!Number.isFinite(pages)) return { available: false, reason: output.trim().slice(0, 300) }
  return { available: true, pages, words, version: version ?? 'unknown' }
}

/**
 * A cover page is the first page that carries no body heading; this reports which pages look
 * like a cover so the count of cover versus body pages is read, not assumed.
 */
export function splitCover(pages, coverTitle) {
  const probe = (coverTitle ?? '').slice(0, 8)
  const cover = pages.filter(page => probe && page.text.includes(probe) && page.text.length < 400)
  return { coverPages: cover.length, bodyPages: pages.length - cover.length }
}

/** Where the page box and content suggest the layout broke rather than flowed. */
export function layoutNotes(pages) {
  const notes = []
  for (const page of pages) {
    if (page.text.length === 0) notes.push({ page: page.index, issue: 'blank' })
    else if (page.text.length < 40 && page.index !== 1) notes.push({ page: page.index, issue: 'nearly-empty', chars: page.text.length })
  }
  const a4 = pages[0] && Math.abs(pages[0].width - 595.28) < 3 && Math.abs(pages[0].height - 841.89) < 3
  return { a4, notes }
}

if (process.argv[1]?.endsWith('measure-pagination.mjs')) {
  const target = process.argv[2]
  if (!target) { console.error('usage: node scripts/measure-pagination.mjs <file.docx> [--json out] [--no-word]'); process.exit(2) }
  const docx = resolve(target)
  const outDir = join(tmpdir(), `sf-pagination-${Date.now()}`)
  const pdf = await convertToPdf(docx, outDir)
  const pages = await readPdf(pdf)
  const layout = layoutNotes(pages)
  const word = process.argv.includes('--no-word') ? { available: false, reason: 'skipped' } : await wordPageCount(docx)
  const report = { document: docx, convertedPdf: pdf,
    pagesByRenderer: pages.length, pagesByWord: word.available ? word.pages : null, wordsByWord: word.available ? word.words : null,
    viewer: word.available ? `Microsoft Word ${word.version}` : 'LibreOffice (Word unavailable)',
    pageSizeA4: layout.a4, layoutNotes: layout.notes,
    pages: pages.map(page => ({ index: page.index, chars: page.text.length, head: page.text.slice(0, 60) })) }
  console.log(JSON.stringify(report, null, 2))
  const jsonAt = process.argv.indexOf('--json')
  if (jsonAt > 0 && process.argv[jsonAt + 1]) await writeFile(resolve(process.argv[jsonAt + 1]), JSON.stringify(report, null, 2))
  const agrees = !word.available || word.pages === pages.length
  if (!agrees) { console.error(`page counts disagree: LibreOffice ${pages.length}, Word ${word.pages}`); process.exitCode = 1 }
}
