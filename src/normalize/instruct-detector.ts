/**
 * Prompt injection detection and content sanitization.
 *
 * Sanitizes input (NFKC normalization, strip zero-width/direction chars)
 * then scans for known prompt-injection patterns via regex heuristics.
 */

// ── Pattern definitions ─────────────────────────────────────────────

interface InjectionPattern {
  name: string;
  regex: RegExp;
}

const PATTERNS: readonly InjectionPattern[] = [
  {
    name: "ignore-previous",
    regex: /ignore\s+(all\s+)?previous|ignore\s+above/i,
  },
  {
    name: "role-assumption",
    regex: /you\s+are\s+(now|a)\b/i,
  },
  {
    name: "system-prefix",
    regex: /^system:/im,
  },
  {
    name: "xml-closing-tag",
    regex: /<\/[a-z_]+>/i,
  },
  {
    name: "llama-inst-marker",
    regex: /\[\/?\s*INST\s*\]/i,
  },
  {
    name: "chatml-marker",
    regex: /<\|im_(?:start|end)\|>/i,
  },
  {
    name: "claude-role-marker",
    regex: /^(?:Human|Assistant):/im,
  },
] as const;

// ── Detection result ─────────────────────────────────────────────────

interface DetectionResult {
  detected: boolean;
  pattern?: string;
}

// ── Sanitization ─────────────────────────────────────────────────────

/**
 * Zero-width characters to strip.
 * U+200B  ZERO WIDTH SPACE
 * U+200C  ZERO WIDTH NON-JOINER
 * U+200D  ZERO WIDTH JOINER
 * U+FEFF  BYTE ORDER MARK / ZERO WIDTH NO-BREAK SPACE
 * U+2060  WORD JOINER
 */
const ZERO_WIDTH_RE = /[\u200B\u200C\u200D\uFEFF\u2060]/g;

/**
 * Bidirectional override / isolate characters to strip.
 * U+202A–U+202E  LRE, RLE, PDF, LRO, RLO
 * U+2066–U+2069  LRI, RLI, FSI, PDI
 */
const BIDI_RE = /[\u202A-\u202E\u2066-\u2069]/g;

/**
 * Strip combining diacritical marks so accented characters become their
 * ASCII base letter. E.g. "ignoré" → "ignore", "IgnÖre" → "IgnOre".
 *
 * Works by decomposing to NFD (which separates base + combining mark)
 * then removing all characters in the Combining Diacritical Marks block.
 */
function stripDiacritics(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Sanitise raw content before injection scanning.
 *
 * 1. NFKC Unicode normalization (collapses compatibility codepoints)
 * 2. Strip zero-width characters
 * 3. Strip RTL/LTR overrides and isolates
 * 4. Strip diacritical marks (so accented chars match ASCII patterns)
 */
export function sanitizeContent(content: string): string {
  let s = content.normalize("NFKC");
  s = s.replace(ZERO_WIDTH_RE, "");
  s = s.replace(BIDI_RE, "");
  s = stripDiacritics(s);
  return s;
}

// ── Detection ────────────────────────────────────────────────────────

/**
 * Detect prompt injection patterns in `content`.
 *
 * The input is sanitised (NFKC + strip invisible chars) before scanning
 * so that obfuscation via Unicode trickery is neutralised.
 *
 * Returns `{ detected: true, pattern: "<name>" }` on first match,
 * or `{ detected: false }` if clean.
 */
export function detectInjection(content: string): DetectionResult {
  const sanitized = sanitizeContent(content);

  for (const { name, regex } of PATTERNS) {
    if (regex.test(sanitized)) {
      return { detected: true, pattern: name };
    }
  }

  return { detected: false };
}
