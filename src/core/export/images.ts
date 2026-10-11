import {digest,type FileStore} from '../store/files.ts'
import {projectMarkdown,walk} from '../editing/markdown.ts'
import {markdownDestinations,projectRelativeUrl} from '../editing/markdown-resources.ts'
import {invariant} from '../../shared/errors.ts'

export interface ExportImage {url:string;relativePath:string;hash:string;bytes:Uint8Array;type:'png'|'jpg';width:number;height:number}
export function imageDimensions(bytes:Uint8Array){
  const data=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength)
  if(bytes.length>=24&&[137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value))return {type:'png' as const,width:data.getUint32(16),height:data.getUint32(20)}
  if(bytes[0]===255&&bytes[1]===216){
    let offset=2
    while(offset+4<=bytes.length){if(bytes[offset]!==255)break;const marker=bytes[offset+1];offset+=2;if(marker===216||marker===1)continue;if(marker===217||marker===218)break
      const length=data.getUint16(offset);if(length<2||offset+length>bytes.length)break
      if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&length>=7)return {type:'jpg' as const,height:data.getUint16(offset+3),width:data.getUint16(offset+5)}
      offset+=length
    }
  }
  invariant(false,'IMAGE_FORMAT_UNSUPPORTED','图片导出支持本地 PNG 和 JPEG；请检查实际文件格式。')
}
export async function exportImages(io:FileStore,text:string,mainDocument:string){
  const projection=projectMarkdown(text),definitions=new Map<string,string>(),urls=new Set<string>()
  walk(projection.tree,node=>{if(node.type==='definition'&&node.identifier&&node.url)definitions.set(node.identifier.toLowerCase(),node.url)})
  walk(projection.tree,node=>{if(node.type==='image'&&node.url)urls.add(node.url);if(node.type==='imageReference'&&node.identifier){const url=definitions.get(node.identifier.toLowerCase());invariant(url,'IMAGE_REFERENCE_MISSING','图片引用定义缺失。');urls.add(url)}})
  const images:ExportImage[]=[]
  for(const url of urls){
    const {target}=projectRelativeUrl(mainDocument,'paper.md',url)
    invariant(target,'REMOTE_IMAGE_NOT_EXPORTABLE','导出图片需为项目内 PNG/JPEG；远程图片请先下载到项目并修改主稿。')
    invariant(!/[?#]/u.test(url),'IMAGE_URL_UNSUPPORTED','本地图片地址不能含查询参数或片段。')
    invariant((await io.stat(target))?.type==='file','IMAGE_ASSET_MISSING','主稿引用的本地图片不存在，请重新连接图片文件。')
    const bytes=await (io.readImageAssetBytes??io.readBytes).call(io,target,20*1024*1024),size=imageDimensions(bytes)
    invariant(size.width>0&&size.height>0&&size.width<=30000&&size.height<=30000,'IMAGE_INVALID','图片尺寸无效或超过导出限额。')
    const hash=digest(bytes);images.push({url,relativePath:`assets/${hash.slice(7)}.${size.type}`,hash,bytes,...size})
  }
  let packaged=text
  for(const row of markdownDestinations(text).reverse()){const image=images.find(image=>image.url===row.url);if(image)packaged=packaged.slice(0,row.startUtf16)+image.relativePath+packaged.slice(row.endUtf16)}
  return {text:packaged,images,hash:digest(JSON.stringify(images.map(({url,hash,relativePath})=>({url,hash,relativePath}))))}
}
