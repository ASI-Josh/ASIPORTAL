export const MENTION_REGEX = /@([A-Za-z0-9._@-]+(?:\s+[A-Za-z0-9._@-]+){0,3})/g;

export const extractMentions = (text: string) => {
  if (!text) return [];
  const matches: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = MENTION_REGEX.exec(text)) !== null) {
    if (match[1]) {
      matches.push(match[1].trim());
    }
  }
  return Array.from(new Set(matches));
};

export const normalizeMention = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, "");

export const mentionMatches = (mention: string, target: string) => {
  const left = normalizeMention(mention);
  const right = normalizeMention(target);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
};
