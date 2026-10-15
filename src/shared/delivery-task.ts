import { z } from 'zod'
import { id, hash, requestContext, anchorSchema,outlineSchema,claimSchema } from './schema.ts'
import { reviewReportSchema } from './review.ts'
import { documentFormatting } from './formatting.ts'
import { runStateSchema,modelOutputSchema } from './runs.ts'
import {researchKindSchema} from './results.ts'

export const deliveryGoal=z.enum(['course-delivery','research-results'])
export const candidateClaimUpdate=claimSchema.pick({id:true,text:true,evidenceLinks:true,limitations:true}).extend({text:z.string().trim().min(1).max(16000)}).strict()
export const deliveryWritingOutputSchema=modelOutputSchema.extend({outlineSections:z.array(z.object({id,title:z.string().trim().min(1).max(500)}).strict()).max(200).optional(),claimUpdates:z.array(candidateClaimUpdate).max(500).optional()})
export const candidateSnapshotSchema=z.object({schemaVersion:z.literal(1),id,taskId:id,projectId:id,sessionId:id,
  baseDocumentHash:hash,baseRevisionId:id,text:z.string().min(1).max(2*1024*1024).refine(text=>text.isWellFormed()),textHash:hash,
  environmentHash:hash,parentCandidateId:id.optional(),scope:z.enum(['document','paragraphs']),reason:z.string().min(1).max(16000),createdAt:z.string(),
  anchors:z.record(id,anchorSchema),formatting:documentFormatting.optional(),outline:outlineSchema.optional(),baseOutlineHash:hash.optional(),claimUpdates:z.record(id,claimSchema).optional(),baseClaimHashes:z.record(id,hash).optional()}).strict()
export type CandidateSnapshot=z.infer<typeof candidateSnapshotSchema>
export const candidateCheckSchema=z.object({schemaVersion:z.literal(1),id,subject:z.literal('candidate'),candidateId:id,candidateHash:hash,
  taskId:id,projectId:id,sessionId:id,textHash:hash,environmentHash:hash,evaluatorVersion:z.literal('sf-candidate-v1'),
  report:reviewReportSchema,modelPlanHash:hash.optional(),modelPlanFileHash:hash.optional(),modelReceiptHash:hash.optional(),modelInputHash:hash.optional(),createdAt:z.string()}).strict()
export const candidateRefRequest=z.object({context:requestContext,taskId:id,candidateId:id,candidateHash:hash}).strict()
export const candidateAdoptRequest=candidateRefRequest.extend({planId:id,planHash:hash,bufferHash:hash}).strict()
export const deliveryTaskSchema=z.object({schemaVersion:z.literal(1),id,projectId:id,sessionId:id,workspaceId:id,runId:id,goal:deliveryGoal,
  researchKind:researchKindSchema.default('ai-method'),revision:z.number().int().nonnegative(),phase:z.enum(['inputs','first-draft','evidence','candidate-check','revision','awaiting-adoption','recheck','export','finished']),
  status:runStateSchema.shape.status,approvalHash:hash,writingTaskId:id.optional(),candidateId:id.optional(),candidateHash:hash.optional(),checkId:id.optional(),checkHash:hash.optional(),
  deliveryId:id.optional(),adoptionPlanId:id.optional(),adoptionDecided:z.boolean().default(false),keptOriginal:z.boolean().optional(),
  researchPrepared:z.boolean().optional(),researchDraftPrepared:z.boolean().optional(),researchInputHash:hash.optional(),
  pendingStructure:z.boolean().optional(),structureChoice:z.object({candidateId:id,decision:z.enum(['allow','keep']),at:z.string()}).strict().optional(),
  model: z.object({providerId:z.string(),modelId:z.string(),reasoningEffort:z.string().optional(),maxOutputTokens:z.number().int().positive().optional()}).strict(),
  materialHashes:z.record(z.string(),hash),specHash:hash,sourceSelectionHash:hash,resourceHashes:z.record(z.string(),hash),
  allowStructure:z.boolean(),online:z.boolean(),requiredCheckIds:z.array(id),advisoryCheckIds:z.array(id),missingMaterials:z.array(z.string()),
  queries:z.array(z.object({key:hash,gapIds:z.array(id),query:z.string(),evidenceBefore:hash,evidenceAfter:hash.optional(),failureCode:z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/u).optional(),outcome:z.enum(['pending','progress','no-progress','unavailable'])}).strict()),
  lastProgressHash:hash.optional(),progressHistory:z.array(hash).max(16).default([]),gapRevisionEvidenceHash:hash.optional(),bestFactDebt:z.array(z.number().int().nonnegative()).length(5).optional(),stalls:z.number().int().nonnegative().default(0),calls:z.array(z.object({runId:id,planHash:hash,stage:z.enum(['review','revision','research']),status:z.enum(['pending','succeeded','failed','unknown'])}).strict()),
  acknowledgedUnknownCalls:z.record(id,z.string()).default({}),
  message:z.string(),createdAt:z.string(),updatedAt:z.string()}).strict()
export type DeliveryTask=z.infer<typeof deliveryTaskSchema>
export const deliveryPrepareRequest=z.object({context:requestContext,goal:deliveryGoal,allowStructure:z.boolean().default(false),researchKind:researchKindSchema.default('ai-method')}).strict()
export const deliveryActionRequest=z.object({context:requestContext,taskId:id,action:z.enum(['pause','resume','recheck','cancel','keep-original','allow-structure','keep-structure']),expectedTaskRevision:z.number().int().nonnegative(),acknowledgeUnknownCall:z.boolean().default(false)}).strict()
