import JSZip from 'jszip'
import {DOMParser} from 'linkedom'
import {z} from 'zod'
import {requestContext,id,hash} from '../../shared/schema.ts'
import {digest,json,newId,type FileStore} from '../store/files.ts'
import {snapshot,mutateLedger} from '../project/project.ts'
import {readWritingSpec,ownedRequirementsHash} from '../pipeline/writing-task-store.ts'
import {readDelivery} from './delivery.ts'
import {typographyToDocx} from './typography.ts'
import {invariant,parseStored} from '../../shared/errors.ts'
import {projectMarkdown,textOf} from '../editing/markdown.ts'
import {isCaptionText} from './scan.ts'

export const layoutVerificationRequest=z.object({context:requestContext,deliveryId:id,viewer:z.string().trim().min(1).max(200),reason:z.string().trim().min(10).max(2000),
  pages:z.number().int().min(1).max(10000),coverPages:z.number().int().min(0).max(100),bodyPages:z.number().int().min(1).max(10000)}).strict()
const layoutReceipt=z.object({schemaVersion:z.literal(1),id,projectId:id,deliveryId:id,documentHash:hash,revisionId:id,specHash:hash,artifactHash:hash,
  viewer:z.string(),reason:z.string(),pages:z.number(),coverPages:z.number(),bodyPages:z.number(),confirmedBy:id,confirmedAt:z.string()}).strict()
const receiptPath=(deliveryId:string)=>`.scholarflow/deliveries/${id.parse(deliveryId)}/layout-current.json`

/** Examines the delivered bytes. OOXML structure never substitutes for rendered pagination. */
export async function inspectArtifactReview(io:FileStore,deliveryId:string){
  const current=await snapshot(io),spec=await readWritingSpec(io),delivery=await readDelivery(io,deliveryId),checks:Array<{id:string;status:'pass'|'fail'|'unknown';detail:string}>=[]
  invariant(spec,'WRITING_SPEC_MISSING','当前写作要求缺失。')
  const add=(id:string,status:'pass'|'fail'|'unknown',detail:string)=>checks.push({id,status,detail})
  const extension=spec.format==='docx'?'docx':spec.format==='latex'?'tex':'md',main=delivery.files.find(file=>file.relativePath===`paper.${extension}`)
  add('delivery_format',main?'pass':'fail',main?`已回读并验证实际 ${extension} 文件的字节、大小和快照 hash。`:`交付中没有要求的 ${extension} 文件。`)
  if(spec.cover?.enabled||spec.brief?.format.cover){
    const complete=!!spec.cover?.enabled&&!!spec.cover.title.trim()&&spec.cover.fields.every(field=>field.label.trim()&&field.value.trim())
    add('cover_fields',complete?'pass':'fail',complete?'已确认封面字段均有值；还需核对实际文件中的对应内容。':'封面题目或必填身份字段未填写，不能报告完整交付。')
  }
  if(main&&extension==='docx'&&main.encoding==='base64'){
    const zip=await JSZip.loadAsync(Buffer.from(main.base64,'base64')),document=zip.file('word/document.xml'),styles=zip.file('word/styles.xml')
    invariant(document&&styles,'DELIVERY_DOCX_INVALID','Word 缺少实际正文或样式。')
    const doc=new DOMParser().parseFromString(await document.async('string'),'text/xml'),style=new DOMParser().parseFromString(await styles.async('string'),'text/xml'),text=Array.from(doc.getElementsByTagName('w:t')).map(node=>node.textContent).join('\n')
    if(spec.cover?.enabled){const present=text.includes(spec.cover.title)&&spec.cover.fields.every(field=>text.includes(field.label)&&(!field.value||text.includes(field.value)))&&doc.getElementsByTagName('w:sectPr').length>=2
      add('cover_artifact',present?'pass':'fail',present?'实际 Word 含封面内容与独立分节；实际分页仍需查看。':'实际 Word 的封面字段或分节不完整。')}
    if(spec.typography){const expected=typographyToDocx(spec.typography),fonts=Array.from(style.getElementsByTagName('w:rFonts')),sizes=Array.from(style.getElementsByTagName('w:sz')),spacing=Array.from(doc.getElementsByTagName('w:spacing'))
      const typography=fonts.some(node=>node.getAttribute('w:eastAsia')===expected.fonts.eastAsia&&node.getAttribute('w:ascii')===expected.fonts.ascii)&&sizes.some(node=>Number(node.getAttribute('w:val'))===expected.sizeHalfPoints)&&spacing.some(node=>Number(node.getAttribute('w:line'))===expected.lineTwips)
      const pages=Array.from(doc.getElementsByTagName('w:pgSz')),pageSize=pages.length>0&&pages.every(node=>Math.abs(Number(node.getAttribute('w:w'))-11906)<5&&Math.abs(Number(node.getAttribute('w:h'))-16838)<5)
      add('typography_artifact',typography&&pageSize?'pass':'fail',typography&&pageSize?'实际 Word 的默认中英文字体、字号、正文行距与 A4 页面参数对应确认值；局部人工排版仍按实际查看核对。':'实际 Word 排版参数与确认值不一致。')}
    if(spec.typography){const formatting=current.ledger.documents.paper.formatting,body=projectMarkdown(current.document.text).blocks.filter(block=>block.node.type==='paragraph'&&!isCaptionText(textOf(block.node))),overlaps=(row:{start:number;end:number})=>body.some(block=>row.start<block.end&&row.end>block.start),style=spec.typography
      const different=formatting?.characters.some(row=>overlaps(row)&&(row.fontZh!==undefined&&row.fontZh!==style.bodyFontZh||row.fontEn!==undefined&&row.fontEn!==style.bodyFontEn||row.sizePt!==undefined&&row.sizePt!==style.bodySizePt))||formatting?.paragraphs.some(row=>overlaps(row)&&row.lineSpacing!==undefined&&row.lineSpacing!==style.lineSpacing)
      add('body_typography_overrides',different?'fail':'pass',different?'正文局部字体、字号或行距覆盖了已确认排版值，需调整或明确更新要求并重新导出。':'正文局部排版未覆盖已确认的字体、字号和行距；标题和题注单独处理。')}
  }
  const pages=spec.brief?.length,requiresPages=pages&&(pages.pages!==undefined||pages.bodyPages!==undefined||pages.coverPages!==undefined)
  if(requiresPages){const file=await io.read(receiptPath(deliveryId)),receipt=file?parseStored(layoutReceipt,file.text,'LAYOUT_RECEIPT_INVALID','export.layout'):undefined
    const matched=receipt&&main&&receipt.projectId===current.ledger.projectId&&receipt.deliveryId===deliveryId&&receipt.documentHash===current.document.contentHash&&receipt.revisionId===current.document.revisionId&&receipt.specHash===ownedRequirementsHash(spec)&&receipt.artifactHash===main.hash
    add('rendered_pagination',matched?(pages.pages===undefined||pages.pages===receipt.pages)&&(pages.bodyPages===undefined||pages.bodyPages===receipt.bodyPages)&&(pages.coverPages===undefined||pages.coverPages===receipt.coverPages)?'pass':'fail':'unknown',matched?`实际查看记录：${receipt.viewer}，总计 ${receipt.pages} 页／封面 ${receipt.coverPages} 页／正文 ${receipt.bodyPages} 页；${receipt.reason}`:'页数属于必需条件；尚无绑定当前实际文件的 Word 或等效查看记录，不能按字数或 OOXML 推算通过。')}
  return {deliveryId,checks,valid:true,manifest:delivery.manifest}
}

export async function recordLayoutVerification(io:FileStore,request:unknown){
  const input=layoutVerificationRequest.parse(request),current=await snapshot(io),spec=await readWritingSpec(io),delivery=await readDelivery(io,input.deliveryId)
  invariant(spec&&current.ledger.projectId===input.context.projectId&&delivery.manifest.documentHash===current.document.contentHash&&delivery.manifest.revisionId===current.document.revisionId,'LAYOUT_INPUT_CHANGED','页数核对必须针对当前保存稿的实际交付文件。')
  invariant(input.pages===input.coverPages+input.bodyPages,'LAYOUT_COUNT_INVALID','总页数须等于封面与正文页数之和。')
  const extension=spec.format==='docx'?'docx':spec.format==='latex'?'tex':'md',main=delivery.files.find(file=>file.relativePath===`paper.${extension}`)
  invariant(main,'DELIVERY_FORMAT_MISSING','实际交付文件缺失。')
  const receipt=layoutReceipt.parse({schemaVersion:1,id:newId('layout'),projectId:current.ledger.projectId,deliveryId:input.deliveryId,documentHash:current.document.contentHash,revisionId:current.document.revisionId,specHash:ownedRequirementsHash(spec),artifactHash:main.hash,
    viewer:input.viewer,reason:input.reason,pages:input.pages,coverPages:input.coverPages,bodyPages:input.bodyPages,confirmedBy:input.context.sessionId,confirmedAt:new Date().toISOString()})
  const result=await mutateLedger(io,input.context.expectedLedgerRevision!,async()=>{const fresh=await snapshot(io);invariant(fresh.document.contentHash===receipt.documentHash&&ownedRequirementsHash((await readWritingSpec(io))!)===receipt.specHash,'LAYOUT_INPUT_CHANGED','查看确认期间正文或要求已改变。');await readDelivery(io,input.deliveryId);return [{path:receiptPath(input.deliveryId),before:await io.read(receiptPath(input.deliveryId)),after:json(receipt)},{path:`.scholarflow/deliveries/${input.deliveryId}/layout-history/${receipt.id}.json`,before:undefined,after:json(receipt)}]})
  return {receipt,revision:result.revision}
}
