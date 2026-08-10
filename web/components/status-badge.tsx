"use client";

import { Badge } from "@/components/ui/badge";
import type { EntryStatus } from "@/lib/api";
import { useT, type MessageKey } from "@/lib/i18n";

const styles: Record<EntryStatus, string> = {
  uploading: "bg-blue-500/15 text-blue-500",
  probing: "bg-amber-500/15 text-amber-500",
  transcoding: "bg-amber-500/15 text-amber-500",
  ready: "bg-emerald-500/15 text-emerald-500",
  failed: "bg-red-500/15 text-red-500",
};

const labelKeys: Record<EntryStatus, MessageKey> = {
  uploading: "statusUploading",
  probing: "statusProbing",
  transcoding: "statusTranscoding",
  ready: "statusReady",
  failed: "statusFailed",
};

export function StatusBadge({ status }: { status: EntryStatus }) {
  const t = useT();
  return (
    <Badge variant="outline" className={styles[status]}>
      {t(labelKeys[status])}
    </Badge>
  );
}
