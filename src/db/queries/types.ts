export interface ItemRow {
  id: string;
  source: string;
  source_id: string;
  author: string;
  content: string;
  timestamp: number;
  url: string | null;
  engagement: number;
  attachments: string | null;
  content_hash: string;
  content_anchor: string | null;
  original_language: string | null;
  translated: boolean;
  filter_reason: string | null;
  status: string;
  batch_id: string | null;
  created_at: number;
}

export interface SummaryRow {
  id: string;
  source: string;
  source_id: string;
  window_start: number;
  window_end: number;
  body: string;
  sentiment: number | null;
  urgency: string | null;
  item_count: number;
  created_at: number;
}

export interface ReportRow {
  id: string;
  date: string;
  type: string;
  body: string;
  tldr: string | null;
  sentiment: number | null;
  delivery_status: string;
  delivered_at: number | null;
  created_at: number;
}

export interface SourceRow {
  source: string;
  source_id: string;
  label: string | null;
  enabled: boolean;
  priority: number;
  poll_interval: number;
  trust_weight: number;
  initial_trust_weight: number;
  added_at: number;
  tier: string;
}

export interface AppConfigRow {
  key: string;
  value: string;
}

export interface ChatDailyUsageRow {
  user_id: string;
  usage_day: string;
  token_count: number;
  created_at: number;
  updated_at: number;
}

export interface LlmUsageRow {
  id: string;
  stage: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  created_at: number;
}

export interface HealthEventRow {
  id: string;
  category: string;
  severity: string;
  message: string;
  metadata: Record<string, unknown>;
  acknowledged: boolean;
  created_at: number;
}

export interface EmbeddingRow {
  id: string;
  target_type: string;
  target_id: string;
  model: string;
  dimensions: number;
  vector: Buffer;
  created_at: number;
}

export interface CalendarEventRow {
  id: string;
  name: string;
  category: 'macro' | 'unlock' | 'expiry' | 'governance' | 'launch' | 'legal' | 'custom';
  description: string | null;
  recurrence_rule: 'daily' | 'weekly' | 'monthly' | 'quarterly' | null;
  entity_id: string | null;
  entity_name: string | null;
  next_occurrence: number;
  created_at: number;
}

export interface EventRow {
  id: string;
  entity_id: string | null;
  entity_name: string;
  event_type: 'exploit' | 'audit' | 'governance' | 'launch' | 'partnership' | 'funding' | 'hack' | 'legal';
  description: string;
  event_time: number;
  source: string;
  source_id: string;
  summary_id: string;
  chain_id: string | null;
  created_at: number;
}

export interface EventChainRow {
  chain_root_id: string;
  entity_id: string | null;
  entity_name: string;
  event_count: number;
  first_event_time: number;
  latest_event_time: number;
  event_types: string[];
  descriptions: string[];
}

export interface SummaryEventWithChainRow {
  id: string;
  entity_name: string;
  event_type: EventRow['event_type'];
  description: string;
  event_time: number;
  summary_id: string;
  chain_root_id: string;
  chain_event_count: number;
  chain_position: number;
  chain_first_event_time: number;
  chain_latest_event_time: number;
  chain_event_types: string[];
  previous_summary_id: string | null;
  previous_event_type: EventRow['event_type'] | null;
  previous_event_description: string | null;
  previous_event_time: number | null;
  next_summary_id: string | null;
  next_event_type: EventRow['event_type'] | null;
  next_event_description: string | null;
  next_event_time: number | null;
}

export interface ReportChainDrilldownRow {
  chain_root_id: string;
  entity_name: string;
  event_count: number;
  first_event_time: number;
  latest_event_time: number;
  event_types: string[];
  latest_summary_id: string;
  latest_event_type: EventRow['event_type'];
  latest_event_description: string;
  total_chain_count: number;
}

export type EntityRelationshipType =
  | 'competes_with'
  | 'built_on'
  | 'invested_in'
  | 'forked_from'
  | 'acquired'
  | 'founded'
  | 'advises'
  | 'partnered_with'
  | 'regulated_by';
export type EntityRelationshipSource = 'llm_inferred' | 'manual' | 'coingecko';

export interface EntityRelationshipRow {
  id: string;
  entityIdA: string;
  entityNameA: string;
  entityIdB: string;
  entityNameB: string;
  relationshipType: EntityRelationshipType;
  confidence: number;
  source: EntityRelationshipSource;
  summaryId: string | null;
  sinceAt: number | null;
  untilAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface EntityRelationshipGraphNodeRow {
  id: string;
  name: string;
  depth: number;
  isRoot: boolean;
}

export interface EntityRelationshipGraphRow {
  rootEntityId: string;
  nodes: EntityRelationshipGraphNodeRow[];
  relationships: EntityRelationshipRow[];
}
