const HTML_ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

function decodeHtmlEntities(value: string) {
  return value.replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (entity) => HTML_ENTITY_MAP[entity] || entity);
}

function formatKeyLabel(key: string) {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function isPrimitive(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function formatJsonLines(value: unknown, indent = 0, label?: string): string[] {
  const pad = "  ".repeat(indent);

  if (value === null || value === undefined) return [];

  if (isPrimitive(value)) {
    const text = String(value).trim();
    if (!text) return [];
    return [label ? `${pad}${label}: ${text}` : `${pad}${text}`];
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    const lines: string[] = [];
    const contentPad = `${pad}${label ? "  " : ""}`;
    if (label) lines.push(`${pad}${label}:`);

    value.forEach((item) => {
      if (item === null || item === undefined) return;
      if (isPrimitive(item)) {
        const text = String(item).trim();
        if (!text) return;
        lines.push(`${contentPad}- ${text}`);
        return;
      }

      const nested = formatJsonLines(item, 0);
      if (!nested.length) return;
      lines.push(`${contentPad}- ${nested[0].trim()}`);
      nested.slice(1).forEach((line) => {
        lines.push(`${contentPad}  ${line.trim()}`);
      });
    });
    return lines;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => {
      if (item === null || item === undefined) return false;
      if (typeof item === "string") return item.trim().length > 0;
      if (Array.isArray(item)) return item.length > 0;
      return true;
    });

    if (!entries.length) return [];

    const lines: string[] = [];
    if (label) lines.push(`${pad}${label}:`);
    const childIndent = indent + (label ? 1 : 0);

    entries.forEach(([key, item]) => {
      const nested = formatJsonLines(item, childIndent, formatKeyLabel(key));
      if (nested.length) lines.push(...nested);
    });

    return lines;
  }

  return [];
}

function looksLikeHtml(value: string) {
  return /<\s*\/?\s*[a-z][^>]*>/i.test(value);
}

function normalizeLineBreaks(value: string) {
  return value
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripHtmlToText(value: string) {
  let text = value;
  text = text.replace(/<script[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<h[1-6][^>]*>/gi, "\n## ");
  text = text.replace(/<li[^>]*>/gi, "\n- ");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/(?:p|div|section|article|h[1-6]|ul|ol|table|tr)>/gi, "\n");
  text = text.replace(/<[^>]+>/g, "");
  text = decodeHtmlEntities(text);
  return normalizeLineBreaks(text);
}

function parseJsonCandidate(candidate: string) {
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return null;
  }
}

export function extractJsonCandidate(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const trimmed = text.trim();
  if (!trimmed) return null;

  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    return trimmed;
  }

  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart !== -1 && objectEnd !== -1 && objectEnd > objectStart) {
    return trimmed.slice(objectStart, objectEnd + 1);
  }

  const arrayStart = trimmed.indexOf("[");
  const arrayEnd = trimmed.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd !== -1 && arrayEnd > arrayStart) {
    return trimmed.slice(arrayStart, arrayEnd + 1);
  }

  return null;
}

function extractPreferredTextField(value: Record<string, unknown>) {
  const preferredKeys = ["summary", "answer", "jobDescription", "reportSummary"];
  for (const key of preferredKeys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

export function normalizeAiGeneratedText(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  const directParsed = parseJsonCandidate(trimmed);
  if (directParsed !== null) {
    if (typeof directParsed === "string") return normalizeAiGeneratedText(directParsed);
    if (directParsed && typeof directParsed === "object" && !Array.isArray(directParsed)) {
      const extractedText = extractPreferredTextField(directParsed as Record<string, unknown>);
      if (extractedText) return normalizeAiGeneratedText(extractedText);
    }
    const formatted = normalizeLineBreaks(formatJsonLines(directParsed).join("\n"));
    if (formatted) return formatted;
  }

  const candidate = extractJsonCandidate(trimmed);
  if (candidate) {
    const parsed = parseJsonCandidate(candidate);
    if (parsed !== null) {
      if (typeof parsed === "string") return normalizeAiGeneratedText(parsed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const extractedText = extractPreferredTextField(parsed as Record<string, unknown>);
        if (extractedText) return normalizeAiGeneratedText(extractedText);
      }
      const formatted = normalizeLineBreaks(formatJsonLines(parsed).join("\n"));
      if (formatted) return formatted;
    }
  }

  if (looksLikeHtml(trimmed)) {
    return stripHtmlToText(trimmed);
  }

  return normalizeLineBreaks(trimmed);
}

export function normalizeAiInlineText(raw: string) {
  return normalizeAiGeneratedText(raw)
    .replace(/\s*\n+\s*/g, " ")
    .replace(/^\-\s+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
