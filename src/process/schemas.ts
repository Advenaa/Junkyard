import { z } from 'zod';

const nonEmptyText = z.string().trim().min(1);
const normalizeEntityReference = (value: string): string => value.trim().toLowerCase();

export const ChunkEventLLMSchema = z.object({
  entityName: z.string().min(1),
  eventType: z.enum(['exploit', 'audit', 'governance', 'launch', 'partnership', 'funding', 'hack', 'legal']),
  description: z.string().min(1),
});

export const AuthorClaimLLMSchema = z.object({
  authorHandle: z.string().min(1),
  entityName: z.string().min(1),
  claimType: z.enum(['bullish', 'bearish', 'event', 'neutral']),
  claimText: z.string().min(1),
  confidence: z.number().min(0).max(1).default(0.5),
});

export const ChunkRelationshipLLMSchema = z.object({
  entityNameA: z.string().min(1),
  entityNameB: z.string().min(1),
  relationshipType: z.enum([
    'competes_with',
    'built_on',
    'invested_in',
    'forked_from',
    'acquired',
    'founded',
    'advises',
    'partnered_with',
    'regulated_by',
  ]),
  confidence: z.number().min(0).max(1).default(0.7),
});

const ChunkEntityLLMSchema = z.object({
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  type: z.enum(['token', 'person', 'project', 'company', 'event']).default('project'),
  mentionCount: z.number().int().min(1).default(1),
  sentiment: z.number().min(-1).max(1).default(0),
});

export const ChunkSummaryLLMSchema = z
  .object({
    summary: z.string().min(10),
    urgency: z.enum(['routine', 'elevated', 'breaking']),
    confidence: z.number().min(1).max(10),
    entities: z.array(ChunkEntityLLMSchema).max(20),
    keyEvents: z.array(z.string()).max(5).default([]),
    events: z.array(ChunkEventLLMSchema).max(5),
    relationships: z.array(ChunkRelationshipLLMSchema).max(5),
    authorClaims: z.array(AuthorClaimLLMSchema).max(8),
  })
  .superRefine((value, ctx) => {
    const validEntityReferences = new Set<string>();
    for (const entity of value.entities) {
      const canonicalName = normalizeEntityReference(entity.name);
      if (canonicalName) validEntityReferences.add(canonicalName);
      for (const alias of entity.aliases) {
        const normalizedAlias = normalizeEntityReference(alias);
        if (normalizedAlias) validEntityReferences.add(normalizedAlias);
      }
    }

    for (const [index, event] of value.events.entries()) {
      const entityName = normalizeEntityReference(event.entityName);
      if (entityName === '' || !validEntityReferences.has(entityName)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Must reference a name or alias from entities',
          path: ['events', index, 'entityName'],
        });
      }
    }

    for (const [index, relationship] of value.relationships.entries()) {
      const entityNameA = normalizeEntityReference(relationship.entityNameA);
      const entityNameB = normalizeEntityReference(relationship.entityNameB);

      if (entityNameA === '' || !validEntityReferences.has(entityNameA)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Must reference a name or alias from entities',
          path: ['relationships', index, 'entityNameA'],
        });
      }

      if (entityNameB === '' || !validEntityReferences.has(entityNameB)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Must reference a name or alias from entities',
          path: ['relationships', index, 'entityNameB'],
        });
      }

      if (entityNameA !== '' && entityNameA === entityNameB) {
        ctx.addIssue({
          code: 'custom',
          message: 'Must reference two distinct entities',
          path: ['relationships', index, 'entityNameB'],
        });
      }
    }

    for (const [index, claim] of value.authorClaims.entries()) {
      const entityName = normalizeEntityReference(claim.entityName);
      if (entityName === '' || !validEntityReferences.has(entityName)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Must reference a name or alias from entities',
          path: ['authorClaims', index, 'entityName'],
        });
      }
    }
  });

export type ChunkSummary = z.infer<typeof ChunkSummaryLLMSchema>;
export type ChunkEvent = z.infer<typeof ChunkEventLLMSchema>;
export type AuthorClaim = z.infer<typeof AuthorClaimLLMSchema>;
export type ChunkRelationship = z.infer<typeof ChunkRelationshipLLMSchema>;

export const MacroRegimeLLMSchema = z.object({
  classification: z.enum(['risk-on', 'risk-off', 'transition', 'unclear']),
  confidence: z.number().min(0).max(1),
  rationale: nonEmptyText.max(240),
});

export const MarketReportLLMSchema = z.object({
  tldr: nonEmptyText.max(500),
  keyEvents: z.array(nonEmptyText).max(10).default([]),
  marketCatalysts: z.array(nonEmptyText).max(6).default([]),
  regionalDivergence: z.array(nonEmptyText).max(5).default([]),
  narrativeShifts: z.array(nonEmptyText).max(5).default([]),
  eventChains: z.array(nonEmptyText).max(5).default([]),
  firstMovers: z.array(nonEmptyText).max(5).default([]),
  alphaSignals: z.array(nonEmptyText).max(5).default([]),
  priceAlerts: z.array(nonEmptyText).max(5).default([]),
  unusualActivity: z.array(nonEmptyText).max(5).default([]),
  macroAlerts: z.array(nonEmptyText).max(5).default([]),
  macroRegime: MacroRegimeLLMSchema.nullable().default(null),
  entitySentiment: z
    .array(
      z.object({
        name: nonEmptyText,
        sentiment: z.number().min(-1).max(1),
        reason: nonEmptyText,
      }),
    )
    .max(15)
    .default([]),
  sections: z
    .array(
      z.object({
        title: nonEmptyText,
        body: nonEmptyText,
      }),
    )
    .max(4)
    .default([]),
  newProjects: z
    .array(
      z.object({
        name: nonEmptyText,
        description: nonEmptyText,
      }),
    )
    .max(5)
    .default([]),
});

export type MarketReport = z.infer<typeof MarketReportLLMSchema>;
export type MacroRegime = z.infer<typeof MacroRegimeLLMSchema>;
