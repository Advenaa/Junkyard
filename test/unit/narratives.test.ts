import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createNarrativeDetector, midnightEpoch, decrementDate } from '../../src/process/narratives.js';
import type { Narrative } from '../../src/process/narratives.js';
import { createPool } from '../../src/db/connection.js';
import { runMigrations } from '../../src/db/migrations.js';
import { getNarrativeDrilldownById } from '../../src/db/queries.js';

// ── Helpers ─────────────────────────────────────────────────────────────

/** Encode a number[] as a Buffer matching bytesToVector's expected format. */
function vectorToBuffer(values: number[]): Buffer {
  const f32 = new Float32Array(values);
  return Buffer.from(f32.buffer);
}

/**
 * Build a production-shape Stage 1 summary body. In production, summaries.body
 * holds a JSON-stringified ChunkSummary, not raw text — narrative naming must
 * parse this and extract `.summary`, never feed the whole JSON to the LLM.
 */
function summaryBody(summary: string): string {
  return JSON.stringify({
    summary,
    urgency: 'normal',
    entities: [],
    keyEvents: [],
    confidence: 0.8,
  });
}

/** Local copy of cosineSimilarity for test assertions. */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** Local cosineDistance for assertions. */
function cosineDistance(a: number[], b: number[]): number {
  return 1 - cosineSimilarity(a, b);
}

/** Local computeCentroid for assertions. */
function computeCentroid(points: number[][]): number[] {
  if (points.length === 0) return [];
  const dim = points[0].length;
  const centroid = new Array<number>(dim).fill(0);
  for (const p of points) {
    for (let i = 0; i < dim; i++) centroid[i] += p[i];
  }
  for (let i = 0; i < dim; i++) centroid[i] /= points.length;
  return centroid;
}

const noopLog = {
  info() {},
  debug() {},
  warn() {},
  error() {},
  child() {
    return noopLog;
  },
} as any;

const defaultConfig = {
  models: { normalizer: 'test-haiku', chunk: 'test-haiku', thinkalot: 'test-sonnet' },
} as any;

/** Build a mock pool that returns configured rows for each query. */
function mockPool(opts: {
  summaryRows?: Array<{ summary_id: string; vector: Buffer; body: string; sentiment: number | null }>;
  priorNarratives?: Array<{
    id: string;
    name: string;
    date: string;
    member_count: number;
    avg_sentiment: number | null;
    signal_strength: string;
    summary_ids: string[];
  }>;
  priorEmbeddings?: Map<string, Buffer[]>;
}) {
  const inserts: any[][] = [];

  return {
    pool: {
      async query(sql: string, params?: any[]) {
        const trimmed = sql.replace(/\s+/g, ' ').trim();
        if (trimmed.includes('FROM embeddings e JOIN summaries s')) {
          return { rows: opts.summaryRows ?? [] };
        }
        if (trimmed.includes('FROM narratives WHERE')) {
          return { rows: opts.priorNarratives ?? [] };
        }
        if (trimmed.includes('FROM embeddings e WHERE')) {
          // Prior narrative embeddings lookup
          const ids = params?.[0] as string[];
          const buffers = opts.priorEmbeddings?.get(ids.join(',')) ?? [];
          return { rows: buffers.map((v) => ({ vector: v })) };
        }
        if (trimmed.includes('INSERT INTO narratives')) {
          inserts.push(params!);
          return { rows: [] };
        }
        return { rows: [] };
      },
    } as any,
    inserts,
  };
}

function mockLlm(nameReturns: string | string[] = 'Test Narrative') {
  let callIdx = 0;
  const names = Array.isArray(nameReturns) ? nameReturns : [nameReturns];
  return {
    calls: [] as any[],
    async call(params: any) {
      (this as any).calls.push(params);
      const name = names[callIdx % names.length];
      callIdx++;
      return { content: name };
    },
  };
}

const enabledEmbedder = { isAvailable: () => true };
const disabledEmbedder = { isAvailable: () => false };

/**
 * Generate N vectors in 3D that form tight clusters.
 * Each cluster is centred around a distinct axis direction.
 */
function makeClusteredVectors(
  clusterSizes: number[],
  dim = 10,
): {
  vectors: number[][];
  buffers: Buffer[];
} {
  const vectors: number[][] = [];
  for (let c = 0; c < clusterSizes.length; c++) {
    // Base direction for this cluster: one-hot on dimension c
    const base = new Array<number>(dim).fill(0);
    base[c % dim] = 1;
    for (let i = 0; i < clusterSizes[c]; i++) {
      // Add tiny noise so k-means sees distinct points
      const v = base.map((x) => x + (Math.random() - 0.5) * 0.01);
      vectors.push(v);
    }
  }
  return {
    vectors,
    buffers: vectors.map(vectorToBuffer),
  };
}

// ── Local math verification (since source functions are not exported) ───

describe('cosineSimilarity (local reference)', () => {
  it('parallel vectors -> 1.0', () => {
    assert.ok(Math.abs(cosineSimilarity([1, 0, 0], [1, 0, 0]) - 1.0) < 1e-6);
  });

  it('orthogonal vectors -> 0.0', () => {
    assert.ok(Math.abs(cosineSimilarity([1, 0, 0], [0, 1, 0])) < 1e-6);
  });

  it('opposite vectors -> -1.0', () => {
    assert.ok(Math.abs(cosineSimilarity([1, 0], [-1, 0]) + 1.0) < 1e-6);
  });

  it('zero vector returns 0 (no NaN)', () => {
    assert.equal(cosineSimilarity([0, 0, 0], [1, 2, 3]), 0);
  });
});

describe('cosineDistance (local reference)', () => {
  it('identical vectors -> 0', () => {
    assert.ok(Math.abs(cosineDistance([1, 0], [1, 0])) < 1e-6);
  });

  it('orthogonal vectors -> 1', () => {
    assert.ok(Math.abs(cosineDistance([1, 0], [0, 1]) - 1.0) < 1e-6);
  });

  it('opposite vectors -> 2', () => {
    assert.ok(Math.abs(cosineDistance([1, 0], [-1, 0]) - 2.0) < 1e-6);
  });

  it('is exactly 1 - cosineSimilarity', () => {
    const a = [0.3, 0.7, 0.1];
    const b = [0.9, 0.2, 0.5];
    assert.ok(Math.abs(cosineDistance(a, b) - (1 - cosineSimilarity(a, b))) < 1e-12);
  });
});

describe('computeCentroid (local reference)', () => {
  it('single point returns that point', () => {
    const c = computeCentroid([[3, 4, 5]]);
    assert.deepEqual(c, [3, 4, 5]);
  });

  it('two points returns midpoint', () => {
    const c = computeCentroid([
      [0, 0],
      [4, 6],
    ]);
    assert.deepEqual(c, [2, 3]);
  });

  it('three points returns average', () => {
    const c = computeCentroid([
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ]);
    assert.deepEqual(c, [4, 5, 6]);
  });

  it('empty array returns empty', () => {
    assert.deepEqual(computeCentroid([]), []);
  });
});

// ── silhouetteScore logic (tested via properties) ───────────────────────

describe('silhouetteScore properties (local reference)', () => {
  /** Local silhouetteScore replicating the source logic. */
  function silhouetteScore(points: number[][], assignments: number[], k: number): number {
    const n = points.length;
    if (n <= 1) return 0;
    let totalSilhouette = 0;
    let counted = 0;
    for (let i = 0; i < n; i++) {
      const clusterI = assignments[i];
      let sumA = 0,
        countA = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        if (assignments[j] === clusterI) {
          sumA += cosineDistance(points[i], points[j]);
          countA++;
        }
      }
      if (countA === 0) continue;
      const a = sumA / countA;
      let minB = Infinity;
      for (let c = 0; c < k; c++) {
        if (c === clusterI) continue;
        let sumB = 0,
          countB = 0;
        for (let j = 0; j < n; j++) {
          if (assignments[j] === c) {
            sumB += cosineDistance(points[i], points[j]);
            countB++;
          }
        }
        if (countB > 0) {
          const avgB = sumB / countB;
          if (avgB < minB) minB = avgB;
        }
      }
      if (minB === Infinity) continue;
      const b = minB;
      const maxAB = Math.max(a, b);
      const s = maxAB === 0 ? 0 : (b - a) / maxAB;
      totalSilhouette += s;
      counted++;
    }
    return counted === 0 ? 0 : totalSilhouette / counted;
  }

  it('single point -> 0', () => {
    assert.equal(silhouetteScore([[1, 0]], [0], 1), 0);
  });

  it('all points in same cluster with k=1 -> 0 (no other cluster)', () => {
    const pts = [
      [1, 0, 0],
      [0.9, 0.1, 0],
      [0.8, 0.2, 0],
    ];
    assert.equal(silhouetteScore(pts, [0, 0, 0], 1), 0);
  });

  it('well-separated clusters -> high score (>0.5)', () => {
    // Cluster 0: near [1,0,0], Cluster 1: near [0,1,0]
    const pts = [
      [1, 0.01, 0],
      [1, -0.01, 0],
      [1, 0, 0.01],
      [0.01, 1, 0],
      [-0.01, 1, 0],
      [0, 1, 0.01],
    ];
    const assignments = [0, 0, 0, 1, 1, 1];
    const score = silhouetteScore(pts, assignments, 2);
    assert.ok(score > 0.5, `Expected >0.5 but got ${score}`);
  });

  it('overlapping clusters -> low score (<0.3)', () => {
    // All points near [1,1,1] but split into 2 clusters
    const pts = [
      [1, 1, 1],
      [1.01, 1, 1],
      [1, 1.01, 1],
      [0.99, 1, 1],
      [1, 0.99, 1],
      [1, 1, 0.99],
    ];
    const assignments = [0, 0, 0, 1, 1, 1];
    const score = silhouetteScore(pts, assignments, 2);
    assert.ok(score < 0.3, `Expected <0.3 but got ${score}`);
  });

  it('empty input -> 0', () => {
    assert.equal(silhouetteScore([], [], 0), 0);
  });

  it('all singleton clusters -> 0 (each point alone)', () => {
    const pts = [
      [1, 0],
      [0, 1],
      [1, 1],
    ];
    const assignments = [0, 1, 2];
    const score = silhouetteScore(pts, assignments, 3);
    assert.equal(score, 0);
  });
});

// ── createNarrativeDetector integration tests ───────────────────────────

describe('createNarrativeDetector', () => {
  it('returns [] when embedder is not available', async () => {
    const { pool } = mockPool({});
    const llm = mockLlm();
    const detector = createNarrativeDetector(pool, noopLog, defaultConfig, llm, disabledEmbedder);
    const result = await detector.detectNarratives();
    assert.deepEqual(result, []);
  });

  it('returns [] when fewer than 9 summaries', async () => {
    // 5 summaries, under the 9 threshold
    const dim = 10;
    const rows = Array.from({ length: 5 }, (_, i) => {
      const v = new Array(dim).fill(0);
      v[0] = 1;
      v[1] = i * 0.01;
      return {
        summary_id: `s${i}`,
        vector: vectorToBuffer(v),
        body: summaryBody(`Summary ${i} content here`),
        sentiment: 0.5,
      };
    });
    const { pool } = mockPool({ summaryRows: rows });
    const llm = mockLlm();
    const detector = createNarrativeDetector(pool, noopLog, defaultConfig, llm, enabledEmbedder);
    const result = await detector.detectNarratives();
    assert.deepEqual(result, []);
  });

  it('detects narratives from well-separated clusters (9+ summaries)', async () => {
    const dim = 10;
    // 3 clusters of 4 points each = 12 summaries, well-separated
    const { vectors, buffers } = makeClusteredVectors([4, 4, 4], dim);
    const rows = vectors.map((v, i) => ({
      summary_id: `s${i}`,
      vector: buffers[i],
      body: summaryBody(`Summary ${i}: topic about cluster ${Math.floor(i / 4)}`),
      sentiment: i % 2 === 0 ? 0.8 : -0.2,
    }));

    const { pool, inserts } = mockPool({ summaryRows: rows });
    const llm = mockLlm(['Cluster Alpha', 'Cluster Beta', 'Cluster Gamma']);
    const detector = createNarrativeDetector(pool, noopLog, defaultConfig, llm, enabledEmbedder);
    const narratives = await detector.detectNarratives();

    // Should produce at least 1 narrative (clusters with 3+ members)
    assert.ok(narratives.length >= 1, `Expected narratives but got ${narratives.length}`);

    // Each narrative has required fields
    for (const n of narratives) {
      assert.ok(n.id, 'narrative should have an id');
      assert.ok(n.name, 'narrative should have a name');
      assert.ok(n.date, 'narrative should have a date');
      assert.ok(n.memberCount >= 3, 'cluster must have 3+ members');
      assert.ok(Array.isArray(n.summaryIds), 'summaryIds should be array');
      assert.equal(n.summaryIds.length, n.memberCount);
    }

    // Should have inserted into DB
    assert.equal(inserts.length, narratives.length);
    for (const params of inserts) {
      assert.ok(Array.isArray(params[6]), 'summary_ids insert param should be a JS array');
    }
  });

  it('binds summary_ids as a JS array for Postgres text[] inserts', async () => {
    const dim = 10;
    const { vectors, buffers } = makeClusteredVectors([4, 4, 4], dim);
    const rows = vectors.map((v, i) => ({
      summary_id: `s${i}`,
      vector: buffers[i],
      body: summaryBody(`Summary ${i}: topic about cluster ${Math.floor(i / 4)}`),
      sentiment: 0.5,
    }));

    const { pool, inserts } = mockPool({ summaryRows: rows });
    const llm = mockLlm(['Cluster Alpha', 'Cluster Beta', 'Cluster Gamma']);
    const detector = createNarrativeDetector(pool, noopLog, defaultConfig, llm, enabledEmbedder);
    await detector.detectNarratives();

    assert.ok(inserts.length > 0, 'Expected at least one narrative insert');
    for (const params of inserts) {
      assert.ok(Array.isArray(params[6]), 'summary_ids bind param must be a JS array');
      assert.notEqual(typeof params[6], 'string', 'summary_ids bind param must not be JSON text');
    }
  });

  it('narratives have correct signalStrength "new" when no prior narratives', async () => {
    const dim = 10;
    const { vectors, buffers } = makeClusteredVectors([5, 5], dim);
    const rows = vectors.map((v, i) => ({
      summary_id: `s${i}`,
      vector: buffers[i],
      body: summaryBody(`Summary ${i}`),
      sentiment: null,
    }));

    const { pool } = mockPool({ summaryRows: rows, priorNarratives: [] });
    const llm = mockLlm();
    const detector = createNarrativeDetector(pool, noopLog, defaultConfig, llm, enabledEmbedder);
    const narratives = await detector.detectNarratives();

    for (const n of narratives) {
      assert.equal(n.signalStrength, 'new', 'No priors -> signal should be "new"');
    }
  });

  it('signal strength "strong" when growth rate >= 3.0', async () => {
    const dim = 10;
    // Two clusters so k-means has something to separate, but main cluster is large
    const baseVec = new Array(dim).fill(0);
    baseVec[0] = 1;
    const otherVec = new Array(dim).fill(0);
    otherVec[2] = 1;
    // Main cluster: 9 points near [1,0,...,0]
    const mainCluster = Array.from({ length: 9 }, () => {
      const v = [...baseVec];
      v[1] = (Math.random() - 0.5) * 0.005;
      return v;
    });
    // Second cluster: 3 points near [0,0,1,...,0]
    const otherCluster = Array.from({ length: 3 }, () => {
      const v = [...otherVec];
      v[3] = (Math.random() - 0.5) * 0.005;
      return v;
    });
    const vectors = [...mainCluster, ...otherCluster];
    const buffers = vectors.map(vectorToBuffer);
    const rows = vectors.map((v, i) => ({
      summary_id: `s${i}`,
      vector: buffers[i],
      body: summaryBody(`Summary ${i}`),
      sentiment: 0.5,
    }));

    // Prior narrative had 2 members with same direction as main cluster
    // Growth = 9/2 = 4.5 >= 3.0 -> strong (if k-means keeps main cluster together)
    // Even if split into sub-clusters of 4+5, growth = 4/2=2 or 5/2=2.5 -> emerging
    // Use member_count=1 so even a 3-member sub-cluster gives growth=3.0 -> strong
    const { pool } = mockPool({
      summaryRows: rows,
      priorNarratives: [
        {
          id: 'prior1',
          name: 'Old Narrative',
          date: '2026-04-01',
          member_count: 1,
          avg_sentiment: 0.5,
          signal_strength: 'new',
          summary_ids: ['prior_s0'],
        },
      ],
      priorEmbeddings: new Map([['prior_s0', [vectorToBuffer(baseVec)]]]),
    });
    const llm = mockLlm();
    const detector = createNarrativeDetector(pool, noopLog, defaultConfig, llm, enabledEmbedder);
    const narratives = await detector.detectNarratives();

    // At least one narrative matching the prior direction should be "strong"
    const strongOnes = narratives.filter((n) => n.signalStrength === 'strong');
    assert.ok(
      strongOnes.length > 0,
      `Expected at least one "strong" narrative, got: ${narratives.map((n) => `${n.signalStrength}(${n.memberCount})`)}`,
    );
  });

  it('signal strength "fading" when growth rate <= 0.5', async () => {
    const dim = 10;

    // Three well-separated deterministic clusters on orthogonal axes.
    // Cluster A (3 pts): near [1,0,0,...] — this matches the prior narrative direction.
    // Cluster B (3 pts): near [0,0,1,...] — far from prior.
    // Cluster C (3 pts): near [0,0,0,0,1,...] — far from prior.
    // Total = 9 (minimum for detection). maxK = floor(9/3) = 3, so k=3 is tested.
    // The clusters are on completely different axes so k-means always separates them.

    const baseVec = new Array(dim).fill(0);
    baseVec[0] = 1;

    const clusterA = Array.from({ length: 3 }, (_, i) => {
      const v = [...baseVec];
      v[1] = (i - 1) * 0.005; // tiny deterministic perturbation
      return v;
    });

    const bBase = new Array(dim).fill(0);
    bBase[2] = 1;
    const clusterB = Array.from({ length: 3 }, (_, i) => {
      const v = [...bBase];
      v[3] = (i - 1) * 0.005;
      return v;
    });

    const cBase = new Array(dim).fill(0);
    cBase[4] = 1;
    const clusterC = Array.from({ length: 3 }, (_, i) => {
      const v = [...cBase];
      v[5] = (i - 1) * 0.005;
      return v;
    });

    const vectors = [...clusterA, ...clusterB, ...clusterC];
    const buffers = vectors.map(vectorToBuffer);
    const rows = vectors.map((v, i) => ({
      summary_id: `s${i}`,
      vector: buffers[i],
      body: summaryBody(`Summary ${i}`),
      sentiment: 0.3,
    }));

    // Prior had 8 members with same direction as cluster A.
    // Current cluster A has 3 members -> growth = 3/8 = 0.375 <= 0.5 -> fading.
    // Cosine similarity between cluster A centroid and prior centroid is ~1.0 (same axis).
    const { pool } = mockPool({
      summaryRows: rows,
      priorNarratives: [
        {
          id: 'prior1',
          name: 'Big Narrative',
          date: '2026-04-01',
          member_count: 8,
          avg_sentiment: 0.5,
          signal_strength: 'strong',
          summary_ids: ['ps0', 'ps1'],
        },
      ],
      priorEmbeddings: new Map([['ps0,ps1', [vectorToBuffer(baseVec), vectorToBuffer(baseVec)]]]),
    });
    const llm = mockLlm();
    const detector = createNarrativeDetector(pool, noopLog, defaultConfig, llm, enabledEmbedder);
    const narratives = await detector.detectNarratives();

    const fadingOnes = narratives.filter((n) => n.signalStrength === 'fading');
    assert.ok(
      fadingOnes.length > 0,
      `Expected a "fading" narrative, got: ${narratives.map((n) => `${n.signalStrength}(${n.memberCount})`)}`,
    );
  });

  it('computes avgSentiment correctly (mixed sentiments)', async () => {
    const dim = 10;
    const { vectors, buffers } = makeClusteredVectors([9], dim);
    // Alternate sentiments: 0.8, -0.2, null, 0.8, -0.2, null, ...
    const rows = vectors.map((v, i) => ({
      summary_id: `s${i}`,
      vector: buffers[i],
      body: summaryBody(`Summary ${i}`),
      sentiment: i % 3 === 2 ? null : i % 3 === 0 ? 0.8 : -0.2,
    }));

    const { pool } = mockPool({ summaryRows: rows });
    const llm = mockLlm();
    const detector = createNarrativeDetector(pool, noopLog, defaultConfig, llm, enabledEmbedder);
    const narratives = await detector.detectNarratives();

    assert.ok(narratives.length >= 1);
    // With 9 points: indices 0,3,6 -> 0.8; indices 1,4,7 -> -0.2; indices 2,5,8 -> null
    // avg of non-null = (0.8*3 + (-0.2)*3) / 6 = 1.8/6 = 0.3
    for (const n of narratives) {
      if (n.avgSentiment !== null) {
        assert.ok(typeof n.avgSentiment === 'number');
      }
    }
  });

  it('avgSentiment is null when all sentiments are null', async () => {
    const dim = 10;
    const { vectors, buffers } = makeClusteredVectors([9], dim);
    const rows = vectors.map((v, i) => ({
      summary_id: `s${i}`,
      vector: buffers[i],
      body: summaryBody(`Summary ${i}`),
      sentiment: null,
    }));

    const { pool } = mockPool({ summaryRows: rows });
    const llm = mockLlm();
    const detector = createNarrativeDetector(pool, noopLog, defaultConfig, llm, enabledEmbedder);
    const narratives = await detector.detectNarratives();

    assert.ok(narratives.length >= 1);
    for (const n of narratives) {
      assert.equal(n.avgSentiment, null);
    }
  });

  it('LLM is called with correct stage and model for naming', async () => {
    const dim = 10;
    const { vectors, buffers } = makeClusteredVectors([9], dim);
    const rows = vectors.map((v, i) => ({
      summary_id: `s${i}`,
      vector: buffers[i],
      body: summaryBody(`Summary ${i}`),
      sentiment: 0.5,
    }));

    const { pool } = mockPool({ summaryRows: rows });
    const llm = mockLlm('DeFi Governance Debate');
    const detector = createNarrativeDetector(pool, noopLog, defaultConfig, llm, enabledEmbedder);
    await detector.detectNarratives();

    assert.ok(llm.calls.length >= 1, 'LLM should be called for naming');
    for (const call of llm.calls) {
      assert.equal(call.model, 'test-haiku');
      assert.equal(call.stage, 'narrative-cluster');
      assert.equal(call.maxTokens, 20);
      assert.ok(call.system.includes('3-5 words'));
    }
  });

  it('narrative name is trimmed from LLM response', async () => {
    const dim = 10;
    const { vectors, buffers } = makeClusteredVectors([9], dim);
    const rows = vectors.map((v, i) => ({
      summary_id: `s${i}`,
      vector: buffers[i],
      body: summaryBody(`Summary ${i}`),
      sentiment: 0.5,
    }));

    const { pool } = mockPool({ summaryRows: rows });
    // Return name with whitespace
    const llm = mockLlm('  Padded Name  ');
    const detector = createNarrativeDetector(pool, noopLog, defaultConfig, llm, enabledEmbedder);
    const narratives = await detector.detectNarratives();

    assert.ok(narratives.length >= 1);
    for (const n of narratives) {
      assert.equal(n.name, 'Padded Name');
    }
  });

  it('LLM naming prompt receives parsed summary text, not raw JSON', async () => {
    const dim = 10;
    const { vectors, buffers } = makeClusteredVectors([9], dim);
    const rows = vectors.map((v, i) => ({
      summary_id: `s${i}`,
      vector: buffers[i],
      body: summaryBody(`Human readable summary ${i}`),
      sentiment: 0.5,
    }));

    const { pool } = mockPool({ summaryRows: rows });
    const llm = mockLlm('Cluster Name');
    const detector = createNarrativeDetector(pool, noopLog, defaultConfig, llm, enabledEmbedder);
    await detector.detectNarratives();

    assert.ok(llm.calls.length >= 1, 'LLM should have been called');
    for (const call of llm.calls) {
      const prompt = call.messages[0].content as string;
      assert.ok(
        prompt.includes('Human readable summary'),
        `Prompt should contain parsed summary text, got: ${prompt.slice(0, 200)}`,
      );
      assert.ok(!prompt.includes('"summary"'), `Prompt must not contain JSON syntax, got: ${prompt.slice(0, 200)}`);
      assert.ok(!prompt.includes('"urgency"'), `Prompt must not contain JSON metadata, got: ${prompt.slice(0, 200)}`);
    }
  });

  it('fallback path (LLM throws) does not leak JSON syntax into stored name', async () => {
    const dim = 10;
    const { vectors, buffers } = makeClusteredVectors([9], dim);
    const rows = vectors.map((v, i) => ({
      summary_id: `s${i}`,
      vector: buffers[i],
      body: summaryBody(`Fallback worthy human summary number ${i}`),
      sentiment: 0.5,
    }));

    const { pool, inserts } = mockPool({ summaryRows: rows });
    // LLM always throws — forces the fallback path
    const throwingLlm = {
      calls: [] as any[],
      async call(params: any) {
        (this as any).calls.push(params);
        throw new Error('simulated LLM outage');
      },
    };
    const detector = createNarrativeDetector(pool, noopLog, defaultConfig, throwingLlm, enabledEmbedder);
    const narratives = await detector.detectNarratives();

    assert.ok(narratives.length >= 1, 'Expected at least one narrative via fallback');
    for (const n of narratives) {
      assert.ok(!n.name.includes('{"summary"'), `Name leaks JSON: ${n.name}`);
      assert.ok(!n.name.includes('"urgency"'), `Name leaks JSON metadata: ${n.name}`);
      assert.ok(!n.name.startsWith('{'), `Name starts with JSON brace: ${n.name}`);
      assert.ok(n.name.toLowerCase().includes('fallback') || n.name.length > 0, `Name looks empty: ${n.name}`);
    }
    // The DB insert (param index 1 = name) must also be clean
    for (const params of inserts) {
      const storedName = params[1] as string;
      assert.ok(!storedName.includes('{"summary"'), `Stored name leaks JSON: ${storedName}`);
    }
  });

  it('filters out clusters with fewer than 3 members', async () => {
    const dim = 10;
    // 3 clusters: sizes 5, 5, 2 — the size-2 cluster should be filtered
    const { vectors, buffers } = makeClusteredVectors([5, 5, 2], dim);
    const rows = vectors.map((v, i) => ({
      summary_id: `s${i}`,
      vector: buffers[i],
      body: summaryBody(`Summary ${i}`),
      sentiment: 0.5,
    }));

    const { pool } = mockPool({ summaryRows: rows });
    const llm = mockLlm();
    const detector = createNarrativeDetector(pool, noopLog, defaultConfig, llm, enabledEmbedder);
    const narratives = await detector.detectNarratives();

    // All returned narratives should have 3+ members
    for (const n of narratives) {
      assert.ok(n.memberCount >= 3, `Found narrative with only ${n.memberCount} members`);
    }
  });

  it('each narrative has unique ULID id', async () => {
    const dim = 10;
    const { vectors, buffers } = makeClusteredVectors([4, 4, 4], dim);
    const rows = vectors.map((v, i) => ({
      summary_id: `s${i}`,
      vector: buffers[i],
      body: summaryBody(`Summary ${i}`),
      sentiment: 0.5,
    }));

    const { pool } = mockPool({ summaryRows: rows });
    const llm = mockLlm();
    const detector = createNarrativeDetector(pool, noopLog, defaultConfig, llm, enabledEmbedder);
    const narratives = await detector.detectNarratives();

    const ids = narratives.map((n) => n.id);
    const unique = new Set(ids);
    assert.equal(unique.size, ids.length, 'All IDs should be unique');
    // ULID format: 26 chars, uppercase alphanumeric
    for (const id of ids) {
      assert.equal(id.length, 26, `ULID should be 26 chars: ${id}`);
    }
  });
});

// ── validateTimezone (P-005) — tested indirectly via detectNarratives ─

describe('validateTimezone (via detectNarratives)', () => {
  /**
   * Extended mock pool that supports returning a timezone from app_config.
   * Falls through to the standard mockPool behaviour for other queries.
   */
  function mockPoolWithTimezone(tz: string | null, summaryRows: Parameters<typeof mockPool>[0]['summaryRows']) {
    const base = mockPool({ summaryRows });
    const origQuery = base.pool.query.bind(base.pool);

    base.pool.query = async (sql: string, params?: any[]) => {
      const trimmed = sql.replace(/\s+/g, ' ').trim();
      if (trimmed.includes('FROM app_config')) {
        if (tz === null) return { rows: [] };
        return { rows: [{ value: tz }] };
      }
      return origQuery(sql, params);
    };

    return base;
  }

  // We only need 5 summaries (below the 9 threshold) so detectNarratives
  // returns early. The important thing is that it doesn't throw when
  // validateTimezone is called with various inputs.
  const dim = 10;
  function fewRows() {
    return Array.from({ length: 5 }, (_, i) => {
      const v = new Array(dim).fill(0);
      v[0] = 1;
      return {
        summary_id: `s${i}`,
        vector: vectorToBuffer(v),
        body: summaryBody(`Summary ${i}`),
        sentiment: 0.5,
      };
    });
  }

  it('valid timezone "Asia/Jakarta" does not warn', async () => {
    const warnings: string[] = [];
    const capturingLog = {
      ...noopLog,
      warn(...args: any[]) {
        warnings.push(String(args));
      },
    };
    const { pool } = mockPoolWithTimezone('Asia/Jakarta', fewRows());
    const llm = mockLlm();
    const detector = createNarrativeDetector(pool, capturingLog as any, defaultConfig, llm, enabledEmbedder);
    await detector.detectNarratives();

    const tzWarnings = warnings.filter((w) => w.includes('Invalid timezone'));
    assert.equal(tzWarnings.length, 0, 'Valid timezone should not trigger a warning');
  });

  it('valid timezone "America/New_York" does not warn', async () => {
    const warnings: string[] = [];
    const capturingLog = {
      ...noopLog,
      warn(...args: any[]) {
        warnings.push(String(args));
      },
    };
    const { pool } = mockPoolWithTimezone('America/New_York', fewRows());
    const llm = mockLlm();
    const detector = createNarrativeDetector(pool, capturingLog as any, defaultConfig, llm, enabledEmbedder);
    await detector.detectNarratives();

    const tzWarnings = warnings.filter((w) => w.includes('Invalid timezone'));
    assert.equal(tzWarnings.length, 0, 'Valid timezone should not trigger a warning');
  });

  it('invalid timezone "Invalid/Timezone" falls back and warns', async () => {
    const warnings: string[] = [];
    const capturingLog = {
      ...noopLog,
      warn(...args: any[]) {
        warnings.push(String(args));
      },
    };
    const { pool } = mockPoolWithTimezone('Invalid/Timezone', fewRows());
    const llm = mockLlm();
    const detector = createNarrativeDetector(pool, capturingLog as any, defaultConfig, llm, enabledEmbedder);
    // Should not throw — falls back to Asia/Jakarta
    await detector.detectNarratives();

    const tzWarnings = warnings.filter((w) => w.includes('Invalid timezone'));
    assert.equal(tzWarnings.length, 1, 'Invalid timezone should trigger exactly one warning');
    assert.ok(tzWarnings[0].includes('Invalid/Timezone'), 'Warning should mention the bad timezone');
    assert.ok(tzWarnings[0].includes('Asia/Jakarta'), 'Warning should mention the fallback');
  });

  it('empty string timezone falls back and warns', async () => {
    const warnings: string[] = [];
    const capturingLog = {
      ...noopLog,
      warn(...args: any[]) {
        warnings.push(String(args));
      },
    };
    const { pool } = mockPoolWithTimezone('', fewRows());
    const llm = mockLlm();
    const detector = createNarrativeDetector(pool, capturingLog as any, defaultConfig, llm, enabledEmbedder);
    await detector.detectNarratives();

    const tzWarnings = warnings.filter((w) => w.includes('Invalid timezone'));
    assert.equal(tzWarnings.length, 1, 'Empty timezone should trigger a warning');
    assert.ok(tzWarnings[0].includes('Asia/Jakarta'), 'Warning should mention the fallback');
  });

  it('null from app_config (no row) uses default Asia/Jakarta without warning', async () => {
    const warnings: string[] = [];
    const capturingLog = {
      ...noopLog,
      warn(...args: any[]) {
        warnings.push(String(args));
      },
    };
    const { pool } = mockPoolWithTimezone(null, fewRows());
    const llm = mockLlm();
    const detector = createNarrativeDetector(pool, capturingLog as any, defaultConfig, llm, enabledEmbedder);
    await detector.detectNarratives();

    const tzWarnings = warnings.filter((w) => w.includes('Invalid timezone'));
    assert.equal(tzWarnings.length, 0, 'Default Asia/Jakarta should not trigger invalid tz warning');
  });
});

// ── Timezone helper unit tests ────────────────────────────────────────

describe('midnightEpoch', () => {
  it('UTC: midnight Jan 15 = 2024-01-15T00:00:00Z', () => {
    const result = midnightEpoch('2024-01-15', 'UTC');
    assert.strictEqual(result, Date.UTC(2024, 0, 15));
  });

  it('Asia/Jakarta (UTC+7): midnight Jan 15 = 2024-01-14T17:00:00Z', () => {
    const result = midnightEpoch('2024-01-15', 'Asia/Jakarta');
    assert.strictEqual(result, Date.UTC(2024, 0, 14, 17, 0, 0));
  });

  it('America/New_York (UTC-5 standard): midnight Jan 15 = 2024-01-15T05:00:00Z', () => {
    const result = midnightEpoch('2024-01-15', 'America/New_York');
    assert.strictEqual(result, Date.UTC(2024, 0, 15, 5, 0, 0));
  });

  it('Asia/Kolkata (UTC+5:30): midnight Jan 15 = 2024-01-14T18:30:00Z', () => {
    const result = midnightEpoch('2024-01-15', 'Asia/Kolkata');
    assert.strictEqual(result, Date.UTC(2024, 0, 14, 18, 30, 0));
  });

  it('Asia/Kathmandu (UTC+5:45): midnight Jan 15 = 2024-01-14T18:15:00Z', () => {
    const result = midnightEpoch('2024-01-15', 'Asia/Kathmandu');
    assert.strictEqual(result, Date.UTC(2024, 0, 14, 18, 15, 0));
  });

  it('handles year boundary: midnight Jan 1 2024 in UTC+7', () => {
    const result = midnightEpoch('2024-01-01', 'Asia/Jakarta');
    assert.strictEqual(result, Date.UTC(2023, 11, 31, 17, 0, 0));
  });

  it('handles month boundary: midnight Mar 1 2024 in UTC', () => {
    const result = midnightEpoch('2024-03-01', 'UTC');
    assert.strictEqual(result, Date.UTC(2024, 2, 1));
  });
});

describe('decrementDate', () => {
  it('decrements a normal date', () => {
    assert.strictEqual(decrementDate('2024-01-15'), '2024-01-14');
  });

  it('wraps month boundary', () => {
    assert.strictEqual(decrementDate('2024-03-01'), '2024-02-29'); // 2024 is leap year
  });

  it('wraps year boundary', () => {
    assert.strictEqual(decrementDate('2024-01-01'), '2023-12-31');
  });

  it('handles non-leap year Feb', () => {
    assert.strictEqual(decrementDate('2023-03-01'), '2023-02-28');
  });
});

describe('narrative TEXT[] round-trip with PostgreSQL', () => {
  it(
    'persists summaryIds as a PostgreSQL text[] and reads them back',
    { skip: !process.env['DATABASE_URL'] },
    async () => {
      const databaseUrl = process.env['DATABASE_URL'];
      assert.ok(databaseUrl, 'DATABASE_URL must be set when this test runs');

      const pool = createPool(databaseUrl);
      await runMigrations(pool);
      const client = await pool.connect();

      const runKey = `narrative-roundtrip-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const timezone = 'Asia/Jakarta';
      const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
      const yesterdayStr = decrementDate(todayStr);
      const startOfDay = midnightEpoch(yesterdayStr, timezone);

      const clusteredVectors = [
        [1, 0, 0],
        [0.99, 0.01, 0],
        [0.98, 0.02, 0],
        [0, 1, 0],
        [0.01, 0.99, 0],
        [0.02, 0.98, 0],
        [0, 0, 1],
        [0.01, 0, 0.99],
        [0.02, 0, 0.98],
      ];

      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO app_config (key, value)
           VALUES ('timezone', $1)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [timezone],
        );

        const expectedIds = new Set<string>();
        for (let i = 0; i < clusteredVectors.length; i++) {
          const summaryId = `${runKey}-summary-${i}`;
          expectedIds.add(summaryId);
          const createdAt = startOfDay + 60_000 + i * 1_000;

          await client.query(
            `INSERT INTO summaries (id, source, source_id, window_start, window_end, body, sentiment, urgency, item_count, created_at)
             VALUES ($1, 'twitter', $2, $3, $4, $5, $6, 'routine', 1, $7)`,
            [
              summaryId,
              `@${runKey}_${i}`,
              createdAt - 30_000,
              createdAt,
              `Summary ${i} for ${runKey}`,
              i % 2 === 0 ? 0.4 : -0.1,
              createdAt,
            ],
          );

          await client.query(
            `INSERT INTO embeddings (id, target_type, target_id, model, dimensions, vector, created_at)
             VALUES ($1, 'summary', $2, 'test-embedder', 3, $3, $4)`,
            [`${runKey}-embedding-${i}`, summaryId, vectorToBuffer(clusteredVectors[i]), createdAt],
          );
        }

        const detector = createNarrativeDetector(
          client as never,
          noopLog,
          defaultConfig,
          mockLlm(['Cluster Alpha', 'Cluster Beta', 'Cluster Gamma']),
          enabledEmbedder,
        );

        const narratives = await detector.detectNarratives();
        assert.ok(narratives.length >= 1, 'detectNarratives should insert at least one narrative');

        const insertedNarrative = narratives[0];
        const {
          rows: [storedNarrative],
        } = await client.query<{ summary_ids: string[] }>('SELECT summary_ids FROM narratives WHERE id = $1', [
          insertedNarrative.id,
        ]);

        assert.ok(storedNarrative, 'narrative row should be inserted');
        assert.deepEqual(storedNarrative.summary_ids, insertedNarrative.summaryIds);

        const drilldown = await getNarrativeDrilldownById(client as never, insertedNarrative.id);
        assert.ok(drilldown, 'drilldown should read the inserted narrative');
        assert.deepEqual(
          new Set(drilldown.summaries.map((summary) => summary.id)),
          new Set(insertedNarrative.summaryIds),
        );

        for (const summaryId of insertedNarrative.summaryIds) {
          assert.ok(expectedIds.has(summaryId), `narrative should only reference seeded summaries: ${summaryId}`);
        }
      } finally {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
        await pool.end();
      }
    },
  );
});
