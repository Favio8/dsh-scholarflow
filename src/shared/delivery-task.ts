import { z } from 'zod'
import { id, hash, requestContext, anchorSchema } from './schema.ts'
import { reviewReportSchema } from './review.ts'
import { documentFormatting } from './formatting.ts'

export const deliveryGoal=z.enum(['course-delivery','research-results'])
export const candidateSnapshotSchema=z.object({schemaVersion:z.literal(1),id,taskId:id,projectId:id,sessionId:id,
  baseDocumentHash:hash,baseRevisionId:id,text:z.string().min(1).max(2*1024*1024).refine(text=>text.isWellFormed()),textHash:hash,
  environmentHash:hash,parentCandidateId:id.optional(),scope:z.enum(['document','paragraphs']),reason:z.string().min(1).max(16000),createdAt:z.string(),
  anchors:z.record(id,anchorSchema),formatting:documentFormatting.optional()}).strict()
export type CandidateSnapshot=z.infer<typeof candidateSnapshotSchema>
export const candidateCheckSchema=z.object({schemaVersion:z.literal(1),id,subject:z.literal('candidate'),candidateId:id,candidateHash:hash,
  taskId:id,projectId:id,sessionId:id,textHash:hash,environmentHash:hash,evaluatorVersion:z.literal('sf-candidate-v1'),
  report:reviewReportSchema,modelPlanHash:hash.optional(),createdAt:z.string()}).strict()
export const candidateRefRequest=z.object({context:requestContext,taskId:id,candidateId:id,candidateHash:hash}).strict()
export const candidateAdoptRequest=candidateRefRequest.extend({planId:id,planHash:hash,bufferHash:hash}).strict()
