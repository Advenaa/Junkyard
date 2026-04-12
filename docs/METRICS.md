# Structured Metrics

Podders emits machine-parseable metrics through the existing `pino` logger. Each record carries a stable `event` field so log shippers, `jq`, or ad hoc shell filters can target a specific batch metric without parsing the human message text. Example: `jq 'select(.event=="chunk_distribution")' podders.log`.

## `chunk_distribution`

The summarize pipeline emits `event: "chunk_distribution"` once per claimed batch in [`src/process/summarize.ts`](../src/process/summarize.ts). The record includes `stage`, `source`, `sourceId`, `batchId`, `chunkCount`, `tokenBudget`, `chunkTokens`, and `chunkItems`, where the two arrays describe the per-chunk token and item distribution for that summarize run. Filter with `jq 'select(.event=="chunk_distribution")' podders.log`.

## `entity_resolution`

The entity manager emits `event: "entity_resolution"` once per `resolveEntitiesDetailed()` batch in [`src/knowledge/entities.ts`](../src/knowledge/entities.ts). The record includes `totalNames`, `aliasHits`, `contextHits`, `llmDisambiguations`, and `unresolved`, plus the batch context fields `source` and `summaryId`. This lets operators track how much of a batch was handled by alias lookup, co-occurrence context, or Tier 3 LLM disambiguation versus names that still fell back unresolved. Filter with `jq 'select(.event=="entity_resolution")' podders.log`.

## `llm_budget`

The shared LLM wrapper emits `event: "llm_budget"` on each successful `llm.call()` in [`src/llm.ts`](../src/llm.ts). The record includes `stage`, `model`, `inputTokens`, `outputTokens`, `costUsd`, and `durationMs`, which makes stage-by-stage token and cost analysis possible without reading the `llm_usage` table directly. Filter with `jq 'select(.event=="llm_budget")' podders.log`.
