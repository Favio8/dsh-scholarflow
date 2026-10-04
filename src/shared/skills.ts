import { z } from 'zod'
import { id, hash, relativePath, stage } from './schema.ts'

export const skillCapability = z.enum(['draft-section', 'selection-transform', 'review', 'research', 'planning'])
export const skillMetadataSchema = z.object({ schemaVersion: z.literal(1), qualifiedId: z.string().min(1).max(1000), displayName: z.string().min(1).max(300),
  description: z.string().min(1).max(1024), entry: z.literal('SKILL.md'), capabilities: z.array(skillCapability).max(5), suggestedStages: z.array(stage).max(7),
  invocation: z.literal('manual-or-stage'), executionPolicy: z.literal('instructions-only'), compatibility: z.enum(['compatible', 'partial']),
  warnings: z.array(z.string().max(2000)).max(30) }).strict()
export const skillFileSchema = z.object({ relativePath, hash, sizeBytes: z.number().int().min(0).max(20 * 1024 * 1024) }).strict()
export const skillOriginSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('builtin'), asset: relativePath }).strict(),
  z.object({ kind: z.literal('project'), projectId: id, namespace: id, resourceId: id }).strict(),
  z.object({ kind: z.literal('local'), rootFingerprint: hash, subpath: z.string().max(800), license: z.string().max(2000).optional() }).strict(),
  z.object({ kind: z.literal('github'), repository: z.url(), commit: z.string().regex(/^[a-f0-9]{40}$/), subpath: z.string().max(800), license: z.string().max(2000).optional() }).strict(),
])
export const skillManifestSchema = z.object({ schemaVersion: z.literal(1), metadata: skillMetadataSchema, digest: hash, origin: skillOriginSchema,
  files: z.array(skillFileSchema).min(1).max(200), installedAt: z.iso.datetime() }).strict()
export type SkillMetadata = z.infer<typeof skillMetadataSchema>
export type SkillManifest = z.infer<typeof skillManifestSchema>
export type SkillOrigin = z.infer<typeof skillOriginSchema>
export const resourceBindingSchema = z.object({ bindingId: id, qualifiedId: z.string().min(1).max(1000), scope: z.enum(['builtin', 'library', 'project']),
  digest: hash, entryPath: relativePath,
  origin: z.object({ repository: z.url(), commit: z.string().regex(/^[a-f0-9]{40}$/), subpath: z.string().max(800), license: z.string().max(2000).optional() }).strict().optional(),
  enabledStages: z.array(stage).max(7) }).strict()
export const resourceLockSchema = z.object({ schemaVersion: z.literal(1), projectId: id, bindings: z.array(resourceBindingSchema).max(30), resolvedAt: z.iso.datetime() }).strict()
export type ResourceBinding = z.infer<typeof resourceBindingSchema>
export const skillOptions = z.object({ capabilities: z.array(skillCapability).min(1).max(5), suggestedStages: z.array(stage).min(1).max(7) }).strict()
export const projectSkillSidecar = skillOptions.extend({ schemaVersion: z.literal(1) }).strict()

// Binary resources are immutable bytes, never executable payloads. No Host or
// filesystem types cross the Core boundary, and original SKILL.md stays intact.
export interface SkillFile { relativePath: string; bytes: Uint8Array }
export interface SkillBundle { manifest: SkillManifest; files: SkillFile[]; instructions: string }
