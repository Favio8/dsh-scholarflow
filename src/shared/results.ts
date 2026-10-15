import { z } from 'zod'
import { id,hash,requestContext,locator,relativePath } from './schema.ts'
export const researchInputRole=z.enum(['method','results','settings','figure','literature'])
export const researchMaterialRole=z.object({path:relativePath,role:researchInputRole}).strict()
export const researchMaterialRolesSchema=z.object({schemaVersion:z.literal(1),projectId:id,roles:z.array(researchMaterialRole).max(500),confirmedBy:id,confirmedAt:z.string()}).strict()
export const researchMaterialRolesRequest=z.object({context:requestContext,roles:z.array(researchMaterialRole).max(500),authorConfirmed:z.literal(true)}).strict()
export const resultFigureSchema=z.object({path:relativePath,hash,description:z.string().trim().min(1).max(4000),evidenceIds:z.array(id).min(1),visualStatus:z.literal('author-described')}).strict()
export const researchKindSchema=z.enum(['ai-method','systems','benchmark','theoretical'])
export const researchGoalProfileSchema=z.object({schemaVersion:z.literal(1),projectId:id,taskId:id,goal:z.enum(['course-delivery','research-results']),researchKind:researchKindSchema,confirmedAt:z.string()}).strict()
const condition=z.string().min(1).refine(value=>value.trim().length>0,'实验条件不能为空白。')
export const resultConditions=z.object({task:condition,dataset:condition,split:condition,method:condition,
  baseline:z.string().optional(),settings:condition,protocol:condition,run:z.string().optional(),seed:z.string().optional()}).strict()
export const resultMapping=z.object({recordsPointer:z.string().max(1000).default(''),valueField:z.string().min(1).max(500),metricField:z.string().max(500).optional(),
  metric:z.string().max(500).optional(),unitField:z.string().max(500).optional(),unit:z.string().max(200).optional(),
  conditionFields:z.partialRecord(z.enum(['task','dataset','split','method','baseline','settings','protocol','run','seed']),z.string().min(1).max(500)).default({}),
  conditions:resultConditions.partial().default({}),direction:z.enum(['higher','lower','unspecified']).default('unspecified')}).strict()
export const experimentRecordSchema=z.object({schemaVersion:z.literal(1),id,projectId:id,version:z.number().int().min(1),previousId:id.optional(),
  status:z.enum(['current','superseded']),title:z.string().min(1),sourceId:id,sourceHash:hash,materialId:id,mappingHash:hash,conditions:resultConditions,
  measurementEvidenceIds:z.array(id).min(1),direction:z.enum(['higher','lower','unspecified']),
  links:z.object({claimIds:z.array(id),sectionIds:z.array(id),figurePaths:z.array(z.string())}).strict(),confirmedAt:z.string(),confirmedBy:id}).strict()
export const resultAssociationRequest=z.object({context:requestContext,experimentId:id,storeHash:hash,claimIds:z.array(id).max(100),sectionIds:z.array(id).max(100),
  figures:z.array(z.object({path:z.string().min(1),description:z.string().trim().min(1).max(4000),evidenceIds:z.array(id).min(1)}).strict()).max(50)}).strict()
export const resultAssociationsSchema=z.object({schemaVersion:z.literal(1),projectId:id,records:z.record(id,z.object({experimentId:id,experimentHash:hash,claimIds:z.array(id),sectionIds:z.array(id),figures:z.array(resultFigureSchema),confirmedBy:id,confirmedAt:z.string()}).strict())}).strict()
export const resultComparisonRequest=z.object({context:requestContext,leftEvidenceId:id,rightEvidenceId:id,decimals:z.number().int().min(0).max(12).default(2),
  conversion:z.enum(['none','seconds-to-ms','ms-to-seconds','fraction-to-percent','percent-to-fraction']).default('none')}).strict()
export const experimentStoreSchema=z.object({schemaVersion:z.literal(1),projectId:id,records:z.record(id,experimentRecordSchema)}).strict()
export const resultPrepareRequest=z.object({context:requestContext,materialId:id,title:z.string().min(1).max(500),mapping:resultMapping,previousExperimentId:id.optional()}).strict()
export const resultConfirmRequest=z.object({context:requestContext,planId:id,planHash:hash,authorConfirmed:z.literal(true)}).strict()
export type ResultMapping=z.infer<typeof resultMapping>
export type ExperimentRecord=z.infer<typeof experimentRecordSchema>
export const resultCellSchema=z.object({field:z.string(),raw:z.string(),value:z.union([z.string(),z.number(),z.boolean(),z.null()]),locator,
  recordIndex:z.number().int().min(0),byteOffset:z.number().int().min(0).optional(),byteEnd:z.number().int().min(0).optional()}).strict()
export type ResultCell=z.infer<typeof resultCellSchema>
export const authorResultApprovalSchema=z.object({schemaVersion:z.literal(1),projectId:id,sessionId:id,documentHash:hash,revisionId:id,
  candidateId:id,candidateHash:hash,candidateCheckHash:hash,environmentHash:hash,modelRunId:id,evidenceIds:z.array(id).min(1),confirmedAt:z.string(),statement:z.string()}).strict()
