"use client";

import {
  CircleAlertIcon,
  CircleCheckIcon,
  ClapperboardIcon,
  ScanSearchIcon,
  UploadCloudIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { EntryStatus } from "@/lib/api";
import { useT, type MessageKey } from "@/lib/i18n";

// Jobs-style status badge: tinted background, matching border and an icon.
const config: Record<EntryStatus, { cls: string; icon: React.ReactNode; label: MessageKey }> = {
  uploading: {
    cls: "bg-blue-500/15 text-blue-500 border-blue-500/30",
    icon: <UploadCloudIcon className="size-3" />,
    label: "statusUploading",
  },
  probing: {
    cls: "bg-amber-500/15 text-amber-500 border-amber-500/30",
    icon: <ScanSearchIcon className="size-3" />,
    label: "statusProbing",
  },
  transcoding: {
    cls: "bg-violet-500/15 text-violet-500 border-violet-500/30",
    icon: <ClapperboardIcon className="size-3" />,
    label: "statusTranscoding",
  },
  ready: {
    cls: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
    icon: <CircleCheckIcon className="size-3" />,
    label: "statusReady",
  },
  failed: {
    cls: "bg-red-500/15 text-red-500 border-red-500/30",
    icon: <CircleAlertIcon className="size-3" />,
    label: "statusFailed",
  },
};

export function StatusBadge({ status }: { status: EntryStatus }) {
  const t = useT();
  const c = config[status];
  return (
    <Badge variant="outline" className={cn("gap-1.5 capitalize", c.cls)}>
      {c.icon}
      {t(c.label)}
    </Badge>
  );
}
