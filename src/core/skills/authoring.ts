import {stringify} from 'yaml'
import {z} from 'zod'
import {skillOptions,type SkillBundle} from '../../shared/skills.ts'
import {packageSkill} from './package.ts'
import {invariant} from '../../shared/errors.ts'
import {newId} from '../store/files.ts'

export const authorSkillRequest=skillOptions.extend({name:z.string().trim().min(1).max(64),description:z.string().trim().min(1).max(1024),
  instructions:z.string().trim().min(1).max(60000),qualifiedId:z.string().max(1000).optional(),
  derivedFrom:z.object({qualifiedId:z.string().max(1000),digest:z.string().regex(/^sha256:[a-f0-9]{64}$/)}).optional()}).strict()
export function authorSkill(request:unknown,source?:SkillBundle){
  const input=authorSkillRequest.parse(request)
  invariant(!input.qualifiedId||input.qualifiedId.startsWith('user:'),'SKILL_AUTHOR_ID_INVALID','只能为用户创作的 Skill 保存同一身份的新版本。')
  const qualifiedId=input.qualifiedId??`user:${newId('skill')}`
  const text='---\n'+stringify({name:input.name,description:input.description})+'---\n\n'+input.instructions+'\n'
  const files=[{relativePath:'SKILL.md',bytes:new TextEncoder().encode(text)},...(source?.files.filter(row=>row.relativePath!=='SKILL.md')??[])]
  return packageSkill(qualifiedId,files,{kind:'user',createdAt:new Date().toISOString(),...(input.derivedFrom&&{derivedFrom:input.derivedFrom})},
    {capabilities:input.capabilities,suggestedStages:input.suggestedStages})
}
