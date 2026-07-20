"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { EntityKind } from "@/lib/types";
import { apiSend } from "./client-api";
import { TagBadge, TagDot } from "./tag-badge";

interface TagPickerProps {
  entityType: EntityKind;
  entityId: string;
  assigned: { id: string; name: string; color: string }[];
}

interface TagRow {
  id: string;
  name: string;
  color: string;
}

/** Assigned-tag badges with remove buttons plus an “add tag” combobox. */
export function TagPicker({ entityType, entityId, assigned }: TagPickerProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const { data: allTags = [] } = useQuery({
    queryKey: ["tags"],
    queryFn: () => apiSend<TagRow[]>("/api/tags", "GET"),
    enabled: open,
  });

  const done = (message: string) => {
    toast.success(message);
    void queryClient.invalidateQueries({ queryKey: ["tags"] });
    router.refresh();
  };

  const assign = useMutation({
    mutationFn: (tagId: string) => apiSend("/api/tags/assign", "POST", { tagId, entityType, entityId }),
    onSuccess: () => done("Tag added"),
    onError: (err) => toast.error(err.message),
  });

  const unassign = useMutation({
    mutationFn: (tagId: string) => apiSend("/api/tags/assign", "DELETE", { tagId, entityType, entityId }),
    onSuccess: () => done("Tag removed"),
    onError: (err) => toast.error(err.message),
  });

  const createAndAssign = useMutation({
    mutationFn: async (name: string) => {
      const tag = await apiSend<TagRow>("/api/tags", "POST", { name, color: "gray" });
      await apiSend("/api/tags/assign", "POST", { tagId: tag.id, entityType, entityId });
    },
    onSuccess: () => done("Tag created and added"),
    onError: (err) => toast.error(err.message),
  });

  const assignedIds = new Set(assigned.map((t) => t.id));
  const available = allTags.filter((t) => !assignedIds.has(t.id));
  const trimmed = search.trim();
  const exactExists = allTags.some((t) => t.name.toLowerCase() === trimmed.toLowerCase());

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {assigned.map((tag) => (
        <TagBadge key={tag.id} name={tag.name} color={tag.color}>
          <button
            type="button"
            aria-label={`Remove tag ${tag.name}`}
            className="-mr-0.5 ml-0.5 rounded-sm opacity-60 transition-opacity hover:opacity-100"
            onClick={() => unassign.mutate(tag.id)}
          >
            <X className="size-3" />
          </button>
        </TagBadge>
      ))}
      <Popover
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setSearch("");
        }}
      >
        <PopoverTrigger asChild>
          <Button variant="outline" size="xs" className="text-muted-foreground">
            <Plus />
            Add tag
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search tags…" value={search} onValueChange={setSearch} />
            <CommandList>
              <CommandEmpty>No tags found.</CommandEmpty>
              <CommandGroup>
                {available.map((tag) => (
                  <CommandItem
                    key={tag.id}
                    value={tag.name}
                    onSelect={() => {
                      assign.mutate(tag.id);
                      setOpen(false);
                    }}
                  >
                    <TagDot color={tag.color} />
                    {tag.name}
                  </CommandItem>
                ))}
                {trimmed.length > 0 && !exactExists && (
                  <CommandItem
                    value={`create:${trimmed}`}
                    onSelect={() => {
                      createAndAssign.mutate(trimmed);
                      setOpen(false);
                    }}
                  >
                    <Plus />
                    Create “{trimmed}”
                  </CommandItem>
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
