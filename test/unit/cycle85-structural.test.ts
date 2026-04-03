/**
 * Structural regression tests for cycle 85 fixes: EP-001 and LM-012.
 *
 * EP-001: Query embeddings now use RETRIEVAL_QUERY instead of RETRIEVAL_DOCUMENT
 * LM-012: Double sanitization removed in pre-summarize (wrapWithNonce handles it)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readSrc(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), 'utf-8');
}

// ===========================================================================
// EP-001: Query embeddings use RETRIEVAL_QUERY, document embeddings use RETRIEVAL_DOCUMENT
// ===========================================================================

describe('EP-001: embed() accepts taskType parameter', () => {
  const src = readSrc('src/embed.ts');

  it('embed function signature includes optional taskType parameter', () => {
    // Match: async function embed(text: string, taskType: TaskType = TaskType.RETRIEVAL_DOCUMENT)
    assert.match(
      src,
      /async\s+function\s+embed\s*\([^)]*taskType\s*[:\?]/,
      'embed() must accept a taskType parameter',
    );
  });

  it('embed defaults to RETRIEVAL_DOCUMENT when taskType is not provided', () => {
    assert.match(
      src,
      /taskType\s*(?::\s*TaskType)?\s*=\s*TaskType\.RETRIEVAL_DOCUMENT/,
      'embed() must default taskType to TaskType.RETRIEVAL_DOCUMENT',
    );
  });

  it('embed passes taskType to the embedContent call', () => {
    // The embed function should forward taskType to model.embedContent
    assert.match(
      src,
      /embedContent\(\s*\{[\s\S]*?taskType[\s\S]*?\}\s*\)/,
      'embed() must pass taskType through to embedContent',
    );
  });

  it('imports TaskType from @google/generative-ai', () => {
    assert.match(
      src,
      /import\s*\{[^}]*TaskType[^}]*\}\s*from\s*['"]@google\/generative-ai['"]/,
      'embed.ts must import TaskType from @google/generative-ai',
    );
  });
});

describe('EP-001: chat/tools.ts passes RETRIEVAL_QUERY for search', () => {
  const src = readSrc('src/chat/tools.ts');

  it('imports TaskType from @google/generative-ai', () => {
    assert.match(
      src,
      /import\s*\{?\s*TaskType\s*\}?\s*from\s*['"]@google\/generative-ai['"]/,
      'chat/tools.ts must import TaskType',
    );
  });

  it('semantic search calls embed with RETRIEVAL_QUERY', () => {
    // Extract the semantic search tool body
    const fnStart = src.indexOf('createSemanticSearch');
    assert.ok(fnStart !== -1, 'createSemanticSearch must exist');

    const fnBody = src.slice(fnStart, src.indexOf('\nfunction ', fnStart + 1));

    assert.ok(
      fnBody.includes('TaskType.RETRIEVAL_QUERY') || fnBody.includes("'RETRIEVAL_QUERY'"),
      'semantic search must pass RETRIEVAL_QUERY when calling embed for queries',
    );
  });

  it('embed interface in tools.ts declares optional taskType parameter', () => {
    assert.match(
      src,
      /embed\s*\([^)]*taskType\s*\?\s*:\s*TaskType/,
      'Embedder interface must declare taskType as optional parameter',
    );
  });
});

describe('EP-001: embed-pipeline.ts uses default RETRIEVAL_DOCUMENT (not RETRIEVAL_QUERY)', () => {
  const src = readSrc('src/embed-pipeline.ts');

  it('does NOT import TaskType (relies on embed default)', () => {
    assert.doesNotMatch(
      src,
      /TaskType/,
      'embed-pipeline.ts should not reference TaskType — it uses the embed default (RETRIEVAL_DOCUMENT)',
    );
  });

  it('does NOT pass RETRIEVAL_QUERY anywhere', () => {
    assert.doesNotMatch(
      src,
      /RETRIEVAL_QUERY/,
      'embed-pipeline.ts must NOT use RETRIEVAL_QUERY — document embeddings use the default RETRIEVAL_DOCUMENT',
    );
  });

  it('uses embedBatch (not single embed) for pipeline indexing', () => {
    assert.match(
      src,
      /embedBatch/,
      'embed-pipeline.ts should use embedBatch for efficient batch indexing',
    );
  });
});

// ===========================================================================
// LM-012: Double sanitization removed in pre-summarize
// ===========================================================================

describe('LM-012: pre-summarize does NOT double-sanitize before wrapWithNonce', () => {
  const src = readSrc('src/pre-summarize/index.ts');

  it('does NOT call sanitizeForPrompt', () => {
    assert.doesNotMatch(
      src,
      /sanitizeForPrompt/,
      'pre-summarize must NOT call sanitizeForPrompt — wrapWithNonce handles sanitization',
    );
  });

  it('formatBatchContent calls wrapWithNonce directly on item.content', () => {
    // Extract the formatBatchContent function
    const fnStart = src.indexOf('function formatBatchContent');
    assert.ok(fnStart !== -1, 'formatBatchContent must exist');

    // Skip past the parameter list closing paren, then find the function body opening brace
    let parenDepth = 0;
    let bodyStart = -1;
    for (let i = src.indexOf('(', fnStart); i < src.length; i++) {
      if (src[i] === '(') parenDepth++;
      if (src[i] === ')') parenDepth--;
      if (parenDepth === 0) {
        // Now find the next '{' which starts the function body
        bodyStart = src.indexOf('{', i);
        break;
      }
    }
    assert.ok(bodyStart > fnStart, 'Could not find function body start');

    // Brace-depth count from the body opening brace
    let depth = 0;
    let fnEnd = -1;
    for (let i = bodyStart; i < src.length; i++) {
      if (src[i] === '{') depth++;
      if (src[i] === '}') depth--;
      if (depth === 0) { fnEnd = i; break; }
    }
    assert.ok(fnEnd > bodyStart, 'Could not find end of formatBatchContent');
    const fnBody = src.slice(fnStart, fnEnd + 1);

    // wrapWithNonce should be called on item.content directly (may be via llm.wrapWithNonce)
    assert.ok(
      fnBody.includes('wrapWithNonce(item.content)') ||
      fnBody.includes('.wrapWithNonce(item.content)'),
      'formatBatchContent must call wrapWithNonce directly on item.content (no pre-sanitization)',
    );
  });

  it('wrapWithNonce is used in the LLMCaller interface', () => {
    assert.match(
      src,
      /wrapWithNonce\s*\(\s*content\s*:\s*string\s*\)/,
      'LLMCaller interface must declare wrapWithNonce accepting raw content',
    );
  });
});

describe('LM-012: process/summarize.ts does NOT double-sanitize before wrapWithNonce', () => {
  const src = readSrc('src/process/summarize.ts');

  it('does NOT call sanitizeForPrompt before wrapWithNonce', () => {
    // Check that sanitizeForPrompt does not appear in the file at all
    // (summarize.ts uses wrapWithNonce from llm, which handles sanitization internally)
    assert.doesNotMatch(
      src,
      /sanitizeForPrompt/,
      'summarize.ts must NOT call sanitizeForPrompt — wrapWithNonce handles it',
    );
  });

  it('callAndParse wraps user content with wrapWithNonce', () => {
    const fnStart = src.indexOf('async function callAndParse');
    assert.ok(fnStart !== -1, 'callAndParse must exist');

    const fnBody = src.slice(fnStart, src.indexOf('\n  async function', fnStart + 1));

    assert.ok(
      fnBody.includes('wrapWithNonce(userContent)') ||
      fnBody.includes('wrapWithNonce(userContent,'),
      'callAndParse must call wrapWithNonce on userContent directly',
    );
  });

  it('LLM interface in summarize.ts declares wrapWithNonce', () => {
    assert.match(
      src,
      /wrapWithNonce\s*\(\s*content\s*:\s*string\s*\)/,
      'LLM interface must include wrapWithNonce',
    );
  });
});
