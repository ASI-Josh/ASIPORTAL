"use client";

import * as React from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type DateFieldProps = {
  value?: Date;
  onChange: (date: Date | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
};

// iOS Safari has long-standing issues with touch events inside a Radix Popover
// Portal wrapping react-day-picker — the Calendar becomes completely unresponsive.
// On touch devices we fall back to the native <input type="date"> which invokes
// the OS date picker (works reliably on iOS and Android).
function isTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "ontouchstart" in window ||
    (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0)
  );
}

function toInputValue(date?: Date): string {
  if (!date) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function fromInputValue(value: string): Date | undefined {
  if (!value) return undefined;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
}

export const DateField = React.forwardRef<HTMLButtonElement, DateFieldProps>(
  ({ value, onChange, placeholder = "Select date", disabled, className, id }, ref) => {
    const [isTouch, setIsTouch] = React.useState(false);

    React.useEffect(() => {
      setIsTouch(isTouchDevice());
    }, []);

    if (isTouch) {
      return (
        <div className={cn("relative", className)}>
          <CalendarIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            id={id}
            type="date"
            disabled={disabled}
            value={toInputValue(value)}
            onChange={(e) => onChange(fromInputValue(e.target.value))}
            className={cn(
              "flex h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
              !value && "text-muted-foreground",
            )}
          />
        </div>
      );
    }

    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button
            ref={ref}
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn(
              "w-full justify-start text-left font-normal",
              !value && "text-muted-foreground",
              className,
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {value ? format(value, "PPP") : placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={value}
            onSelect={(date) => onChange(date ?? undefined)}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    );
  },
);
DateField.displayName = "DateField";
