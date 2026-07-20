import { useState, useRef, useEffect } from "react";
import { useListOrgMembers } from "@workspace/api-client-react";
import { Check, ChevronsUpDown, User } from "lucide-react";
import { cn } from "@/lib/utils";
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

interface AssigneeComboboxProps {
  value: string;
  onChange: (value: string) => void;
  error?: string;
  onErrorChange?: (error: string) => void;
}

export function AssigneeCombobox({
  value,
  onChange,
  error,
  onErrorChange,
}: AssigneeComboboxProps) {
  const [open, setOpen] = useState(false);
  const { data: members = [] } = useListOrgMembers();

  const memberEmails = new Set(
    members.map((m) => m.email?.toLowerCase()).filter(Boolean)
  );

  const selectedMember = members.find(
    (m) => m.email?.toLowerCase() === value.toLowerCase()
  );

  const displayName = selectedMember
    ? [selectedMember.firstName, selectedMember.lastName]
        .filter(Boolean)
        .join(" ") || selectedMember.email || value
    : value || undefined;

  function handleSelect(email: string) {
    onChange(email);
    onErrorChange?.("");
    setOpen(false);
  }

  function handleInputChange(raw: string) {
    onChange(raw);
    // Clear error as user types if the current value becomes empty or matches a member
    if (!raw.trim() || memberEmails.has(raw.trim().toLowerCase())) {
      onErrorChange?.("");
    }
  }

  return (
    <div className="space-y-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              "w-full justify-between font-normal",
              !value && "text-muted-foreground",
              error && "border-destructive"
            )}
          >
            <span className="flex items-center gap-2 truncate">
              {selectedMember?.profileImageUrl ? (
                <img
                  src={selectedMember.profileImageUrl}
                  alt=""
                  className="h-5 w-5 rounded-full object-cover shrink-0"
                />
              ) : (
                <User className="h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">
                {displayName ?? "Unassigned"}
              </span>
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[320px] p-0" align="start">
          <Command>
            <CommandInput
              placeholder="Search name or type email…"
              value={value}
              onValueChange={handleInputChange}
            />
            <CommandList>
              <CommandEmpty>
                {value.trim() ? (
                  <div className="px-4 py-3 text-sm text-left space-y-1">
                    <p className="font-medium">Use "{value.trim()}" as assignee</p>
                    <p className="text-muted-foreground text-xs">
                      Must be an org member's email to submit.
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="mt-1 w-full"
                      onClick={() => {
                        onChange(value.trim());
                        setOpen(false);
                      }}
                    >
                      Use this email
                    </Button>
                  </div>
                ) : (
                  "No members found."
                )}
              </CommandEmpty>
              {members.length > 0 && (
                <CommandGroup heading="Org members">
                  <CommandItem
                    value="__unassigned__"
                    onSelect={() => handleSelect("")}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        !value ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span className="text-muted-foreground italic">
                      Unassigned
                    </span>
                  </CommandItem>
                  {members.map((member) => {
                    const email = member.email ?? "";
                    const fullName = [member.firstName, member.lastName]
                      .filter(Boolean)
                      .join(" ");
                    const isSelected =
                      value.toLowerCase() === email.toLowerCase();
                    return (
                      <CommandItem
                        key={member.userId}
                        value={`${fullName} ${email}`}
                        onSelect={() => handleSelect(email)}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            isSelected ? "opacity-100" : "opacity-0"
                          )}
                        />
                        <span className="flex items-center gap-2">
                          {member.profileImageUrl ? (
                            <img
                              src={member.profileImageUrl}
                              alt=""
                              className="h-5 w-5 rounded-full object-cover shrink-0"
                            />
                          ) : (
                            <User className="h-4 w-4 text-muted-foreground shrink-0" />
                          )}
                          <span className="flex flex-col">
                            {fullName && (
                              <span className="text-sm font-medium leading-tight">
                                {fullName}
                              </span>
                            )}
                            <span
                              className={cn(
                                "text-xs text-muted-foreground",
                                !fullName && "text-sm text-foreground"
                              )}
                            >
                              {email}
                            </span>
                          </span>
                        </span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

