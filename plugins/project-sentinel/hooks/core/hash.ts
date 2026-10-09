/**
 * A short, stable fingerprint of a text (FNV-1a, 32 bits, as 8 hex digits): enough to tell whether
 * two prompts, two tool lists or two policy sections are the same, never to recover what they say.
 * Diagnostics keep fingerprints only, so no prompt text is ever stored or shown.
 */
export function fingerprint(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
