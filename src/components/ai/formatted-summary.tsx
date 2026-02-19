"use client";

import { useMemo } from "react";

import { normalizeAiGeneratedText } from "@/lib/ai-text-format";
import { cn } from "@/lib/utils";

type FormattedSummaryProps = {
  content: string;
  className?: string;
};

function isHeadingLine(value: string) {
  if (/^#{1,6}\s+/.test(value)) return true;
  if (value.endsWith(":") && value.length <= 90) return true;
  return false;
}

function cleanHeading(value: string) {
  return value.replace(/^#{1,6}\s+/, "").replace(/:\s*$/, "").trim();
}

function isUnorderedItem(value: string) {
  return /^[-*]\s+/.test(value);
}

function isOrderedItem(value: string) {
  return /^\d+\.\s+/.test(value);
}

function cleanListItem(value: string) {
  return value.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "").trim();
}

export function FormattedSummary({ content, className }: FormattedSummaryProps) {
  const normalized = useMemo(() => normalizeAiGeneratedText(content), [content]);

  const renderedBlocks = useMemo(() => {
    const lines = normalized.split("\n");
    const nodes: JSX.Element[] = [];

    let index = 0;
    let key = 0;

    while (index < lines.length) {
      const current = lines[index].trim();
      if (!current) {
        index += 1;
        continue;
      }

      if (isUnorderedItem(current)) {
        const items: string[] = [];
        while (index < lines.length) {
          const line = lines[index].trim();
          if (!isUnorderedItem(line)) break;
          const text = cleanListItem(line);
          if (text) items.push(text);
          index += 1;
        }
        if (items.length > 0) {
          nodes.push(
            <ul key={`ul-${key++}`} className="list-disc space-y-1 pl-5 text-sm leading-6 text-foreground/90">
              {items.map((item, itemIndex) => (
                <li key={`ul-item-${itemIndex}`}>{item}</li>
              ))}
            </ul>
          );
        }
        continue;
      }

      if (isOrderedItem(current)) {
        const items: string[] = [];
        while (index < lines.length) {
          const line = lines[index].trim();
          if (!isOrderedItem(line)) break;
          const text = cleanListItem(line);
          if (text) items.push(text);
          index += 1;
        }
        if (items.length > 0) {
          nodes.push(
            <ol
              key={`ol-${key++}`}
              className="list-decimal space-y-1 pl-5 text-sm leading-6 text-foreground/90"
            >
              {items.map((item, itemIndex) => (
                <li key={`ol-item-${itemIndex}`}>{item}</li>
              ))}
            </ol>
          );
        }
        continue;
      }

      if (isHeadingLine(current)) {
        nodes.push(
          <h4 key={`heading-${key++}`} className="pt-1 text-sm font-semibold text-foreground">
            {cleanHeading(current)}
          </h4>
        );
        index += 1;
        continue;
      }

      const paragraphLines = [current];
      index += 1;
      while (index < lines.length) {
        const line = lines[index].trim();
        if (!line || isHeadingLine(line) || isUnorderedItem(line) || isOrderedItem(line)) break;
        paragraphLines.push(line);
        index += 1;
      }

      nodes.push(
        <p key={`paragraph-${key++}`} className="text-sm leading-6 text-foreground/90">
          {paragraphLines.join(" ")}
        </p>
      );
    }

    return nodes;
  }, [normalized]);

  if (!normalized) {
    return (
      <div className={cn("rounded-md border border-border/50 bg-muted/20 p-4", className)}>
        <p className="text-sm text-muted-foreground">No summary available.</p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-3 rounded-md border border-border/50 bg-muted/20 p-4", className)}>
      {renderedBlocks}
    </div>
  );
}
