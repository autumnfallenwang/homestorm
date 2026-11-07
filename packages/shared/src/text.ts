/**
 * Remove a leading "[Name]:" a model writes despite the intro (ADR 0004). Only a bracketed tag at the very start is
 * removed; brackets later in the text are left alone.
 */
export function stripSpeakerTag(text: string): string {
  return text.replace(/^\s*\[[^\]\n]{1,80}\]:[ \t]*/, "");
}

/**
 * Punctuation from Chinese, Japanese and Korean text, which a link never contains raw. Link parsers only stop at
 * whitespace, and this writing uses none, so a link runs on into the sentence after it.
 */
const CJK_PUNCTUATION =
  /[\u2014\u2018-\u201d\u2026\u3000-\u303f\uff01-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65]/;

/** The link in `text`, which starts with one, without the sentence that runs on after it. */
export function cutAtCjkPunctuation(text: string): string {
  const at = text.search(CJK_PUNCTUATION);
  return at === -1 ? text : text.slice(0, at);
}
