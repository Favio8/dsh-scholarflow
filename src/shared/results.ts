import { z } from 'zod'
import { id,hash,requestContext,locator } from './schema.ts'
export const resultConditions=z.object({task:z.string().min(1),dataset:z.string().min(1),split:z.string().min(1),method:z.string().min(1),
  baseline:z.string().optional(),settings:z.string().min(1),protocol:z.string().min(1),run:z.string().optional(),seed:z.string().optional()}).strict()
export const resultMapping=z.object({recordsPointer:z.string().max(1000).default(''),valueField:z.string().min(1).max(500),metricField:z.string().max(500).optional(),
  metric:z.string().max(500).optional(),unitField:z.string().max(500).optional(),unit:z.string().max(200).optional(),
  conditionFields:z.partialRecord(z.enum(['task','dataset','split','method','baseline','settings','protocol','run','seed']),z.string().min(1).max(500)).default({}),
  conditions:resultConditions.partial().default({}),direction:z.enum(['higher','lower','unspecified']).default('unspecified')}).strict()
export const experimentRecordSchema=z.object({schemaVersion:z.literal(1),id,projectId:id,version:z.number().int().min(1),previousId:id.optional(),
  status:z.enum(['current','superseded']),title:z.string().min(1),sourceId:id,sourceHash:hash,materialId:id,mappingHash:hash,conditions:resultConditions,
  measurementEvidenceIds:z.array(id).min(1),direction:z.enum(['higher','lower','unspecified']),
  links:z.object({claimIds:z.array(id),sectionIds:z.array(id),figurePaths:z.array(z.string())}).strict(),confirmedAt:z.string(),confirmedBy:id}).strict()
export const experimentStoreSchema=z.object({schemaVersion:z.literal(1),projectId:id,records:z.record(id,experimentRecordSchema)}).strict()
export const resultPrepareRequest=z.object({context:requestContext,materialId:id,title:z.string().min(1).max(500),mapping:resultMapping,previousExperimentId:id.optional()}).strict()
export const resultConfirmRequest=z.object({context:requestContext,planId:id,planHash:hash,authorConfirmed:z.literal(true)}).strict()
export type ResultMapping=z.infer<typeof resultMapping>
export type ExperimentRecord=z.infer<typeof experimentRecordSchema>
export const resultCellSchema=z.object({field:z.string(),raw:z.string(),value:z.union([z.string(),z.number(),z.boolean(),z.null()]),locator,
  recordIndex:z.number().int().min(0),byteOffset:z.number().int().min(0).optional(),byteEnd:z.number().int().min(0).optional()}).strict()
export type ResultCell=z.infer<typeof resultCellSchema>
