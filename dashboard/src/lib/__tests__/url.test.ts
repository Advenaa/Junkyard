import { describe, it, expect } from 'vitest';
import { isSafeUrl } from '../url';

describe('isSafeUrl', () => {
  it('accepts HTTPS Discord CDN URLs', () => {
    expect(isSafeUrl('https://cdn.discordapp.com/attachments/123/456/image.png')).toBe(true);
  });

  it('accepts HTTPS media.discordapp.net URLs', () => {
    expect(isSafeUrl('https://media.discordapp.net/attachments/123/456/image.png')).toBe(true);
  });

  it('accepts HTTP URLs', () => {
    expect(isSafeUrl('http://example.com/image.png')).toBe(true);
  });

  it('accepts generic HTTPS URLs', () => {
    expect(isSafeUrl('https://example.com/page')).toBe(true);
  });

  it('rejects javascript: URLs', () => {
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
  });

  it('rejects data: URLs', () => {
    expect(isSafeUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  it('rejects file: URLs', () => {
    expect(isSafeUrl('file:///etc/passwd')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isSafeUrl('')).toBe(false);
  });

  it('returns false for malformed URLs', () => {
    expect(isSafeUrl('not-a-url')).toBe(false);
  });
});
