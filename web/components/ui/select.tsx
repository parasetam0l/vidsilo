"use client";

import * as React from "react";
import { ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface Option {
  value: string;
  label: string;
  badges?: string[];
}

interface SelectProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Show a search/filter input inside the dropdown. Default: false */
  searchable?: boolean;
  /** Extra classes merged onto the trigger button (e.g. "h-8 w-[120px] text-xs") */
  className?: string;
}

export function Select({
  options,
  value,
  onChange,
  placeholder = "Select...",
  disabled = false,
  searchable = false,
  className,
}: SelectProps) {
  const [open, setOpen] = React.useState(false);

  const selectedOption = options.find((o) => o.value === value);

  return (
    <div className="relative">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={open}
              disabled={disabled}
              className={cn("w-full justify-between font-normal", className)}
            />
          }
        >
          <div className="flex items-center">
            <span className={cn(!selectedOption && "text-muted-foreground")}>
              {selectedOption?.label || placeholder}
            </span>
            {selectedOption?.badges && selectedOption.badges.length > 0 && (
              <span className="ml-2 flex items-center gap-1">
                {selectedOption.badges.map((b, i) => (
                  <Badge key={i} variant="outline" className="text-[10px] leading-none px-1.5 py-0.5 font-normal">
                    {b}
                  </Badge>
                ))}
              </span>
            )}
          </div>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </PopoverTrigger>
        <PopoverContent className="w-[var(--anchor-width)] gap-0 p-0">
          <Command>
            {searchable && <CommandInput placeholder="Search..." />}
            <CommandList>
              <CommandEmpty>No results found.</CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    keywords={[option.label, ...(option.badges ?? [])]}
                    data-checked={value === option.value ? true : undefined}
                    onSelect={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                  >
                    <span>{option.label}</span>
                    {option.badges && option.badges.length > 0 && (
                      <span className="ml-2 flex items-center gap-1">
                        {option.badges.map((b, i) => (
                          <Badge key={i} variant="outline" className="text-[10px] leading-none px-1.5 py-0.5 font-normal">
                            {b}
                          </Badge>
                        ))}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
