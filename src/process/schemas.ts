import { z } from 'zod';

export const ChunkEventLLMSchema = z.object({
  entityName: z.string().min(1),
  eventType: z.enum(['exploit', 'audit', 'governance', 'launch', 'partnership', 'funding', 'hack', 'legal']),
  description: z.string().min(1),
});

export const ChunkSummaryLLMSchema = z.object({
  summary: z.string().min(10),
  urgency: z.enum(['routine', 'elevated', 'breaking']),
  confidence: z.number().min(1).max(10),
  entities: z
    .array(
      z.object({
        name: z.string().min(1),
        aliases: z.array(z.string()).default([]),
        type: z.enum(['token', 'person', 'project', 'company', 'event']).default('project'),
        mentionCount: z.number().int().min(1).default(1),
        sentiment: z.number().min(-1).max(1).default(0),
      }),
    )
    .max(20)
    .default([]),
  keyEvents: z.array(z.string()).max(5).default([]),
  events: z.array(ChunkEventLLMSchema).max(5).default([]),
});

export type ChunkSummary = z.infer<typeof ChunkSummaryLLMSchema>;
export type ChunkEvent = z.infer<typeof ChunkEventLLMSchema>;

export const MarketReportLLMSchema = z.object({
  tldr: z.string().max(500),
  keyEvents: z.array(z.string()).max(10).default([]),
  marketCatalysts: z.array(z.string()).max(6).default([]),
  eventChains: z.array(z.string()).max(5).default([]),
  entitySentiment: z
    .array(
      z.object({
        name: z.string().min(1),
        sentiment: z.number().min(-1).max(1),
        reason: z.string().min(1),
      }),
    )
    .max(15)
    .default([]),
  sections: z
    .array(
      z.object({
        title: z.string().min(1),
        body: z.string().min(1),
      }),
    )
    .max(4)
    .default([]),
  newProjects: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string().min(1),
      }),
    )
    .max(5)
    .default([]),
});

export type MarketReport = z.infer<typeof MarketReportLLMSchema>;
