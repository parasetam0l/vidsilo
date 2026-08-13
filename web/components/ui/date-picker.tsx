"use client";

import * as React from "react";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { type DateAfter, type DateBefore } from "react-day-picker";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// DatePicker: a shadcn-style popover calendar. The value is an ISO date
// string (YYYY-MM-DD) — the same format the URL/API use.
export function DatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  min,
  max,
  className,
  ariaLabel,
}: {
  value: string;
  onChange: (iso: string) => void;
  placeholder?: string;
  min?: string;
  max?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const selected = value ? new Date(`${value}T00:00:00Z`) : undefined;
  const disabled: (DateBefore | DateAfter)[] = [];
  if (min) disabled.push({ before: new Date(`${min}T00:00:00Z`) });
  if (max) disabled.push({ after: new Date(`${max}T00:00:00Z`) });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            aria-label={ariaLabel}
            className={cn(
              "h-8 w-auto justify-start gap-1.5 rounded-lg text-xs font-normal text-muted-foreground",
              selected && "text-foreground",
              className,
            )}
          />
        }
      >
        <CalendarIcon className="size-3.5" />
        {selected ? format(selected, "MMM d, yyyy") : <span>{placeholder}</span>}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          disabled={disabled}
          onSelect={(d) => {
            if (d) {
              onChange(format(d, "yyyy-MM-dd"));
              setOpen(false);
            }
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
