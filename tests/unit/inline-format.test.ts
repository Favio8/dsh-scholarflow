import {test} from 'node:test'
import assert from 'node:assert/strict'
import {toggleInlineFormat} from '../../src/core/editing/inline-format.ts'
import {parseMarkdown,textOf,walk,type AstNode} from '../../src/core/editing/markdown.ts'
import {rebaseFormatting} from '../../src/core/editing/formatting.ts'

const formatted=(text:string,type:string)=>{const values:string[]=[];walk(parseMarkdown(text),node=>{if(node.type===type)values.push(textOf(node))});return values}
test('SF-168: surrounding whitespace stays outside real emphasis and a second click removes it',()=>{
  const original='前  中文与 Western text  后',range={start:1,end:original.length-1}
  const result=toggleInlineFormat(original,range,'bold')
  assert.deepEqual(formatted(result.text,'strong'),['中文与 Western text'])
  assert.equal(textOf(parseMarkdown(result.text)),original)
  assert.equal(toggleInlineFormat(result.text,result.range,'bold').text,original)
})
test('SF-168: paragraphs, CRLF, nested italics and stable citations survive bold and cancellation',()=>{
  const original='\uFEFF# TEST_ONLY\r\n\r\n普通*斜体*内容[@sf_a]。\r\n\r\n第二段文字。\r\n',start=original.indexOf('普通'),end=original.lastIndexOf('。')+1
  const result=toggleInlineFormat(original,{start,end},'bold')
  assert.deepEqual(formatted(result.text,'strong'),['普通斜体内容[@sf_a]。','第二段文字。'])
  assert.deepEqual(formatted(result.text,'emphasis'),['斜体'])
  assert.equal(result.text.includes('[@sf_a]'),true)
  assert.equal(toggleInlineFormat(result.text,result.range,'bold').text,original)
})
test('SF-168: changing part of an existing emphasis leaves the surrounding text formatted',()=>{
  const original='**前部分后**',start=original.indexOf('部分'),result=toggleInlineFormat(original,{start,end:start+2},'bold')
  assert.deepEqual(formatted(result.text,'strong'),['前','后'])
  assert.equal(textOf(parseMarkdown(result.text)),'前部分后')
  assert.equal(toggleInlineFormat(result.text,result.range,'bold').text,original)
})
test('SF-168: formatting a range across a partial link and italic keeps text and links intact',()=>{
  const original='前*斜体部分*与[链接文字](https://example.com)后',range={start:original.indexOf('部分'),end:original.indexOf('文字')+2}
  const result=toggleInlineFormat(original,range,'bold'),tree=parseMarkdown(result.text),links:AstNode[]=[]
  walk(tree,node=>{if(node.type==='link')links.push(node)})
  assert.equal(textOf(tree),textOf(parseMarkdown(original)))
  assert.equal(links.length,1);assert.equal(links[0].url,'https://example.com')
  assert.equal(formatted(result.text,'strong').join(''),'部分与链接文字')
})
test('SF-168: exact delimiter edits retain a local font range rather than expanding it to the paragraph',()=>{
  const text='开始局部字体结束',result=toggleInlineFormat(text,{start:0,end:text.length},'bold')
  const format=rebaseFormatting({characters:[{start:2,end:6,fontZh:'楷体'}],paragraphs:[]},text,result.text,result.changes)
  assert.equal(result.text.slice(format.characters[0].start,format.characters[0].end),'局部字体')
  const italic=toggleInlineFormat('中文文字',{start:0,end:4},'italic')
  assert.deepEqual(formatted(italic.text,'emphasis'),['中文文字'])
  assert.equal(toggleInlineFormat(italic.text,italic.range,'italic').text,'中文文字')
})
