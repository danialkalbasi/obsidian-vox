/**
 * Convert an Obsidian markdown note into clean prose for TTS.
 *
 * Design choices:
 *   - Strip anything that wouldn't make sense spoken aloud (code blocks,
 *     HTML comments, images, link URLs, tag sigils, frontmatter).
 *   - Keep the text inside [[wikilinks|alias]] and [text](url) so the
 *     meaning survives.
 *   - Preserve paragraph boundaries as newlines — downstream sentence
 *     segmentation (in player.ts) uses them as natural pause points.
 *   - Deliberately not using a full markdown AST parser (remark/marked)
 *     because the extra dependency and bundle size aren't worth it for
 *     a one-way lossy conversion.
 */
export function stripMarkdown(md: string): string {
  let t = md;

  t = t.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/m, "");

  t = t.replace(/```[\s\S]*?```/g, " ");

  t = t.replace(/`([^`]+)`/g, "$1");

  t = t.replace(/<!--[\s\S]*?-->/g, "");

  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  t = t.replace(/!\[\[[^\]]*\]\]/g, "");

  t = t.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2");
  t = t.replace(/\[\[([^\]]+)\]\]/g, "$1");

  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, "");

  t = t.replace(/(\*\*|__)(.*?)\1/g, "$2");
  t = t.replace(/(\*|_)(.*?)\1/g, "$2");
  t = t.replace(/~~(.*?)~~/g, "$1");

  t = t.replace(/^\s*>\s?/gm, "");

  t = t.replace(/^\s*[-*+]\s+/gm, "");
  t = t.replace(/^\s*\d+\.\s+/gm, "");

  t = t.replace(/(^|\s)#[\w/-]+/g, "$1");

  t = t.replace(/^\s*\|?([^|\n]*\|)+[^\n]*$/gm, (line) =>
    line.replace(/\|/g, " — "),
  );

  t = t.replace(/^\s*[-*_]{3,}\s*$/gm, "");

  t = t.replace(/[ \t]+/g, " ");
  t = t.replace(/\n{3,}/g, "\n\n");
  t = t.trim();

  return t;
}

/**
 * Split cleaned prose into sentence-ish chunks. Used by the player to
 * feed the TTS provider incrementally so streaming / first-audio latency
 * stays low, and so pause/skip has sensible granularity.
 *
 * Not a linguist-grade sentence splitter — handles the common cases
 * (., !, ?, newlines) and leaves edge cases like "Dr. Smith" alone.
 */
export function splitIntoSentences(text: string): string[] {
  const raw = text
    .split(/(?<=[.!?])\s+(?=[A-Z"'([])|\n\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const MAX = 300;
  const out: string[] = [];
  for (const s of raw) {
    if (s.length <= MAX) {
      out.push(s);
      continue;
    }
    // Fall back to comma splitting for very long single sentences so we
    // still stream them in a reasonable first-chunk size.
    let rest = s;
    while (rest.length > MAX) {
      const cut = rest.lastIndexOf(",", MAX);
      if (cut < 100) {
        out.push(rest.slice(0, MAX));
        rest = rest.slice(MAX);
      } else {
        out.push(rest.slice(0, cut + 1));
        rest = rest.slice(cut + 1).trim();
      }
    }
    if (rest) out.push(rest);
  }
  return out;
}
