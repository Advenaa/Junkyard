/**
 * Cycle-92 structural regression tests for normalize pipeline fixes.
 *
 * NP-020: translated flag only set on successful translation
 * NP-011: content hash recomputed after translation
 * NP-014: DNS pinning on redirect hops in URL expansion
 *
 * These are source-level pattern tests — they read the TypeScript source
 * and assert structural invariants. No runtime imports of the modules.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const normalizeSrc = readFileSync(new URL('../../src/normalize/index.ts', import.meta.url), 'utf-8');
const urlExpandSrc = readFileSync(new URL('../../src/normalize/url-expand.ts', import.meta.url), 'utf-8');

describe('NP-020 — translated flag only set on successful translation', () => {
  it('translated = true appears after item.content = cleaned (in else branch)', () => {
    const ifCheckIdx = normalizeSrc.indexOf('cleaned.length < 20');
    const contentAssignIdx = normalizeSrc.indexOf('item.content = cleaned', ifCheckIdx);
    const translatedTrueIdx = normalizeSrc.indexOf('translated = true', ifCheckIdx);

    assert.ok(ifCheckIdx > -1, 'should find cleaned.length < 20 check');
    assert.ok(contentAssignIdx > -1, 'should find item.content = cleaned');
    assert.ok(translatedTrueIdx > -1, 'should find translated = true');
    assert.ok(
      translatedTrueIdx > contentAssignIdx,
      'translated = true must appear AFTER item.content = cleaned (inside else branch)',
    );
  });

  it('translated = true does NOT appear between the < 20 check and the else', () => {
    const ifCheckIdx = normalizeSrc.indexOf('cleaned.length < 20');
    const elseIdx = normalizeSrc.indexOf('} else {', ifCheckIdx);
    const between = normalizeSrc.slice(ifCheckIdx, elseIdx);

    assert.ok(elseIdx > ifCheckIdx, 'should find else block after the < 20 check');
    assert.ok(
      !between.includes('translated = true'),
      'translated = true must NOT appear between the if (cleaned.length < 20) and the else',
    );
  });
});

describe('NP-011 — content hash recomputed after translation', () => {
  it('contentHash is declared with let (not const)', () => {
    // Match the main hash declaration (not the injection-block const)
    const hashDeclMatch = normalizeSrc.match(/let\s+contentHash\s*=\s*sha256\(/);
    assert.ok(hashDeclMatch, 'contentHash should be declared with "let contentHash = sha256(" to allow reassignment');
  });

  it('contentHash is reassigned after item.content = cleaned in the else branch', () => {
    const ifCheckIdx = normalizeSrc.indexOf('cleaned.length < 20');
    const contentAssignIdx = normalizeSrc.indexOf('item.content = cleaned', ifCheckIdx);
    const hashReassignIdx = normalizeSrc.indexOf('contentHash = sha256(', contentAssignIdx);

    assert.ok(contentAssignIdx > -1, 'should find item.content = cleaned');
    assert.ok(hashReassignIdx > -1, 'should find contentHash = sha256( after content assignment');
    assert.ok(hashReassignIdx > contentAssignIdx, 'contentHash reassignment must follow item.content = cleaned');
  });
});

describe('NP-014 — DNS pinning on redirect hops in URL expansion', () => {
  it('imports net from node:net', () => {
    assert.ok(urlExpandSrc.includes("import net from 'node:net'"), 'url-expand.ts must import net from node:net');
  });

  it('declares pinnedFetchUrl and pinnedHost variables', () => {
    assert.ok(urlExpandSrc.includes('pinnedFetchUrl'), 'should declare pinnedFetchUrl variable');
    assert.ok(urlExpandSrc.includes('pinnedHost'), 'should declare pinnedHost variable');
  });

  it('uses validation.resolvedIp after validateUrl succeeds', () => {
    const validateCallIdx = urlExpandSrc.indexOf('validateUrl(');
    const resolvedIpIdx = urlExpandSrc.indexOf('validation.resolvedIp', validateCallIdx);

    assert.ok(validateCallIdx > -1, 'should call validateUrl');
    assert.ok(resolvedIpIdx > -1, 'should reference validation.resolvedIp');
    assert.ok(resolvedIpIdx > validateCallIdx, 'validation.resolvedIp usage must come after validateUrl call');
  });

  it('calls net.isIPv6 for IPv6 bracket handling', () => {
    assert.ok(urlExpandSrc.includes('net.isIPv6('), 'should call net.isIPv6 for IPv6 bracket wrapping');
  });

  it('sets Host header from pinnedHost', () => {
    assert.match(urlExpandSrc, /['"]Host['"]\]\s*=\s*pinnedHost/, 'should set Host header from pinnedHost');
  });
});
