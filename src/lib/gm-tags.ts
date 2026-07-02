// In-text GM redaction tag: <GM approved="player1,player2">secret text</GM>
// Wrap any span of a text field in this tag to hide it from players who are
// not named in "approved" (a comma-separated list of player usernames).
// Anonymous/public viewers never match and always have the tag stripped.
// This runs server-side, before text ever reaches a page, so unapproved
// content is never present in the HTML sent to the browser - not just
// hidden with CSS.

const GM_TAG_RE = /<GM(?:\s+approved="([^"]*)")?\s*>([\s\S]*?)<\/GM>/g;

export function resolveGmTags(
  text: string | null | undefined,
  viewerUsername: string | null
): string {
  if (!text) return text ?? "";
  return text.replace(GM_TAG_RE, (_match, approvedAttr: string | undefined, inner: string) => {
    const approved = (approvedAttr ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (viewerUsername && approved.includes(viewerUsername)) {
      return inner;
    }
    return "";
  });
}

// Applies resolveGmTags across every string field of a plain object, for a
// given viewer. Leaves non-string fields untouched. Used by the public query
// layer so every text column on every entity gets the same treatment without
// having to hand-list field names per table.
export function resolveGmTagsOnFields<T extends Record<string, any>>(
  obj: T,
  viewerUsername: string | null,
  fields: (keyof T)[]
): T {
  const clone: any = { ...obj };
  for (const field of fields) {
    if (typeof clone[field] === "string") {
      clone[field] = resolveGmTags(clone[field], viewerUsername);
    }
  }
  return clone;
}

// For the admin editor: GM tags are shown verbatim (raw markup, unresolved)
// so Aviv can see and edit the tags themselves.
export function rawForAdmin(text: string | null | undefined): string {
  return text ?? "";
}
