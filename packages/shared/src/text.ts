/**
 * Remove a leading "[Name]:" a model writes despite the intro (ADR 0004). Only a bracketed tag at the very start is
 * removed; brackets later in the text are left alone.
 */
export function stripSpeakerTag(text: string): string {
  return text.replace(/^\s*\[[^\]\n]{1,80}\]:[ \t]*/, "");
}
