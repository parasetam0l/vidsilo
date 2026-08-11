"use client";

import * as React from "react";
import { Check, Copy, Code2Icon, Link2Icon } from "lucide-react";

import { useT } from "@/lib/i18n";
import { useDialog } from "@/hooks/use-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmbedPreview } from "@/components/embed-preview";

export function useEmbedDialog() {
  const dialog = useDialog();
  return React.useCallback(
    (publicId: string) => {
      dialog.open({
        content: (close) => <EmbedDialogContent publicId={publicId} onClose={close} />,
        size: "xl",
        className: "p-4 sm:max-w-[640px] max-h-[85vh] flex flex-col overflow-y-auto rounded-2xl border border-border/80 bg-background",
        dismissible: true,
        showCloseButton: true,
      });
    },
    [dialog],
  );
}

function EmbedDialogContent({ publicId, onClose }: { publicId: string; onClose: () => void }) {
  const t = useT();
  const [copiedDirect, setCopiedDirect] = React.useState(false);
  const [copiedSnippet, setCopiedSnippet] = React.useState(false);

  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost:8080";
  const directUrl = `${origin}/embed/${publicId}`;
  const snippet = `<iframe src="${directUrl}" width="640" height="360" frameborder="0" allowfullscreen></iframe>`;

  const handleCopyDirect = () => {
    navigator.clipboard.writeText(directUrl);
    setCopiedDirect(true);
    setTimeout(() => setCopiedDirect(false), 2000);
  };

  const handleCopySnippet = () => {
    navigator.clipboard.writeText(snippet);
    setCopiedSnippet(true);
    setTimeout(() => setCopiedSnippet(false), 2000);
  };

  return (
    <div className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{t("embedTitle")}</DialogTitle>
        <DialogDescription>
          Share this video via direct URL link or embed iframe into your application.
        </DialogDescription>
      </DialogHeader>

      {/* Embedded Video Player Preview */}
      <EmbedPreview publicId={publicId} maxH="max-h-56" />

      {/* Gray Area 1: Direct Link */}
      <div className="flex flex-col gap-2.5 rounded-xl border border-border/60 bg-muted/40 p-4 shrink-0">
        <div className="flex items-center gap-2">
          <Link2Icon className="size-4 text-primary shrink-0" />
          <span className="text-xs font-semibold text-foreground">Direct Link</span>
        </div>
        <Input
          readOnly
          value={directUrl}
          className="font-mono text-xs bg-background rounded-lg border shadow-2xs selection:bg-primary/20"
          onFocus={(e) => e.target.select()}
        />
        <div className="flex justify-start">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyDirect}
            className="h-8"
          >
            {copiedDirect ? (
              <>
                <Check className="size-3.5 text-emerald-500" />
                <span className="text-emerald-600 dark:text-emerald-400">{t("copied")}</span>
              </>
            ) : (
              <>
                <Copy className="size-3.5" />
                <span>Copy Direct Link</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Gray Area 2: Embed Code */}
      <div className="flex flex-col gap-2.5 rounded-xl border border-border/60 bg-muted/40 p-4 shrink-0">
        <div className="flex items-center gap-2">
          <Code2Icon className="size-4 text-primary shrink-0" />
          <span className="text-xs font-semibold text-foreground">Embed Code</span>
        </div>
        <Textarea
          readOnly
          rows={3}
          value={snippet}
          className="font-mono text-xs bg-background resize-none rounded-lg border shadow-2xs selection:bg-primary/20"
          onFocus={(e) => e.target.select()}
        />
        <div className="flex justify-start">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopySnippet}
            className="h-8"
          >
            {copiedSnippet ? (
              <>
                <Check className="size-3.5 text-emerald-500" />
                <span className="text-emerald-600 dark:text-emerald-400">{t("copied")}</span>
              </>
            ) : (
              <>
                <Copy className="size-3.5" />
                <span>Copy Embed Code</span>
              </>
            )}
          </Button>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t("close")}
        </Button>
      </DialogFooter>
    </div>
  );
}
