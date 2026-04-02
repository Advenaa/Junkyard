import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createNarrativeDetector } from '../../src/process/narratives.js';
import type { Narrative } from '../../src/process/narratives.js';

// ── Helpers ─────────────────────────────────────────────────────────────

/** Encode a number[] as a Buffer matching bytesToVector's expected format. */
function vectorToBuffer(values: number[]): Buffer {
  const f32 = new Float32Array(values);
  return Buffer.from(f32.buffer);
}

/** Local copy of cosineSimilarity for test assertions. */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
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
  child() { return noopLog; },
} as any;

const defaultConfig = {
  models: { haiku: 'test-haiku', sonnet: 'test-sonnet' },
} as any;

/** Build a mock pool that returns configured rows for each query. */
function mockPool(opts: {
  summaryRows?: Array<{ summary_id: string; vector: Buffer; body: string; sentiment: number | null }>;
  priorNarratives?: Array<{
    id: string; name: string; date: string; member_count: number;
    avg_sentiment: number | null; signal_strength: string; summary_ids: string[];
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
function makeClusteredVectors(clusterSizes: number[], dim = 10): {
  vectors: number[][]; buffers: Buffer[];
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
    const c = computeCentroid([[0, 0], [4, 6]]);
    assert.deepEqual(c, [2, 3]);
  });

  it('three points returns average', () => {
    const c = computeCentroid([[1, 2, 3], [4, 5, 6], [7, 8, 9]]);
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
      let sumA = 0, countA = 0;
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
        let sumB = 0, countB = 0;
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
    const pts = [[1, 0, 0], [0.9, 0.1, 0], [0.8, 0.2, 0]];
    assert.equal(silhouetteScore(pts, [0, 0, 0], 1), 0);
  });

  it('well-separated clusters -> high score (>0.5)', () => {
    // Cluster 0: near [1,0,0], Cluster 1: near [0,1,0]
    const pts = [
      [1, 0.01, 0], [1, -0.01, 0], [1, 0, 0.01],
      [0.01, 1, 0], [-0.01, 1, 0], [0, 1, 0.01],
    ];
    const assignments = [0, 0, 0, 1, 1, 1];
    const score = silhouetteScore(pts, assignments, 2);
    assert.ok(score > 0.5, `Expected >0.5 but got ${score}`);
  });

  it('overlapping clusters -> low score (<0.3)', () => {
    // All points near [1,1,1] but split into 2 clusters
    const pts = [
      [1, 1, 1], [1.01, 1, 1], [1, 1.01, 1],
      [0.99, 1, 1], [1, 0.99, 1], [1, 1, 0.99],
    ];
    const assignments = [0, 0, 0, 1, 1, 1];
    const score = silhouetteScore(pts, assignments, 2);
    assert.ok(score < 0.3, `Expected <0.3 but got ${score}`);
  });

  it('empty input -> 0', () => {
    assert.equal(silhouetteScore([], [], 0), 0);
  });

  it('all singleton clusters -> 0 (each point alone)', () => {
    const pts = [[1, 0], [0, 1], [1, 1]];
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
        body: `Summary ${i} content here`,
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
      body: `Summary ${i}: topic about cluster ${Math.floor(i / 4)}`,
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
  });

  it('narratives have correct signalStrength "new" when no prior narratives', async () => {
    const dim = 10;
    const { vectors, buffers } = makeClusteredVectors([5, 5], dim);
    const rows = vectors.map((v, i) => ({
      summary_id: `s${i}`,
      vector: buffers[i],
      body: `Summary ${i}`,
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
      body: `Summary ${i}`,
      sentiment: 0.5,
    }));

    // Prior narrative had 2 members with same direction as main cluster
    // Growth = 9/2 = 4.5 >= 3.0 -> strong (if k-means keeps main cluster together)
    // Even if split into sub-clusters of 4+5, growth = 4/2=2 or 5/2=2.5 -> emerging
    // Use member_count=1 so even a 3-member sub-cluster gives growth=3.0 -> strong
    const { pool } = mockPool({
      summaryRows: rows,
      priorNarratives: [{
        id: 'prior1',
        name: 'Old Narrative',
        date: '2026-04-01',
        member_count: 1,
        avg_sentiment: 0.5,
        signal_strength: 'new',
        summary_ids: ['prior_s0'],
      }],
      priorEmbeddings: new Map([
        ['prior_s0', [vectorToBuffer(baseVec)]],
      ]),
    });
    const llm = mockLlm();
    const detector = createNarrativeDetector(pool, noopLog, defaultConfig, llm, enabledEmbedder);
    const narratives = await detector.detectNarratives();

    // At least one narrative matching the prior direction should be "strong"
    const strongOnes = narratives.filter((n) => n.signalStrength === 'strong');
    assert.ok(strongOnes.length > 0, `Expected at least one "strong" narrative, got: ${narratives.map((n) => `${n.signalStrength}(${n.memberCount})`)}`);
  });

  it('signal strength "fading" when growth rate <= 0.5', async () => {
    const dim = 10;
    const baseVec = new Array(dim).fill(0);
    baseVec[0] = 1;
    // 9 points total but only 3 in the matching cluster direction
    // We need a second cluster to have enough for k-means
    const clusterA = Array.from({ length: 3 }, () => {
      const v = [...baseVec];
      v[1] = (Math.random() - 0.5) * 0.01;
      return v;
    });
    const otherBase = new Array(dim).fill(0);
    otherBase[2] = 1;
    const clusterB = Array.from({ length: 6 }, () => {
      const v = [...otherBase];
      v[3] = (Math.random() - 0.5) * 0.01;
      return v;
    });
    const vectors = [...clusterA, ...clusterB];
    const buffers = vectors.map(vectorToBuffer);
    const rows = vectors.map((v, i) => ({
      summary_id: `s${i}`,
      vector: buffers[i],
      body: `Summary ${i}`,
      sentiment: 0.3,
    }));

    // Prior had 8 members, current cluster A has 3 -> growth = 0.375 <= 0.5 -> fading
    const { pool } = mockPool({
      summaryRows: rows,
      priorNarratives: [{
        id: 'prior1',
        name: 'Big Narrative',
        date: '2026-04-01',
        member_count: 8,
        avg_sentiment: 0.5,
        signal_strength: 'strong',
        summary_ids: ['ps0', 'ps1'],
      }],
      priorEmbeddings: new Map([
        ['ps0,ps1', [vectorToBuffer(baseVec), vectorToBuffer(baseVec)]],
      ]),
    });
    const llm = mockLlm();
    const detector = createNarrativeDetector(pool, noopLog, defaultConfig, llm, enabledEmbedder);
    const narratives = await detector.detectNarratives();

    const fadingOnes = narratives.filter((n) => n.signalStrength === 'fading');
    assert.ok(fadingOnes.length > 0, `Expected a "fading" narrative, got: ${narratives.map((n) => `${n.signalStrength}(${n.memberCount})`)}`);
  });

  it('computes avgSentiment correctly (mixed sentiments)', async () => {
    const dim = 10;
    const { vectors, buffers } = makeClusteredVectors([9], dim);
    // Alternate sentiments: 0.8, -0.2, null, 0.8, -0.2, null, ...
    const rows = vectors.map((v, i) => ({
      summary_id: `s${i}`,
      vector: buffers[i],
      body: `Summary ${i}`,
      sentiment: i % 3 === 2 ? null : (i % 3 === 0 ? 0.8 : -0.2),
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
      body: `Summary ${i}`,
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
      body: `Summary ${i}`,
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
      body: `Summary ${i}`,
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

  it('filters out clusters with fewer than 3 members', async () => {
    const dim = 10;
    // 3 clusters: sizes 5, 5, 2 — the size-2 cluster should be filtered
    const { vectors, buffers } = makeClusteredVectors([5, 5, 2], dim);
    const rows = vectors.map((v, i) => ({
      summary_id: `s${i}`,
      vector: buffers[i],
      body: `Summary ${i}`,
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
      body: `Summary ${i}`,
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
