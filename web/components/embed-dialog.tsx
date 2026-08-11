"use client";

import * as React from "react";
import { Copy } from "lucide-react";

import { useT } from "@/lib/i18n";
import { useDialog } from "@/hooks/use-dialog";
import { Button } from "@/components/ui/button";

export function useEmbedDialog() {
  const dialog = useDialog();
  return React.useCallback(
    (publicId: string) => {
      dialog.open({
        content: () => <EmbedDialogContent publicId={publicId} />,
        size: "sm",
        dismissible: false,
        showCloseButton: true,
      });
    },
    [dialog],
  );
}

function EmbedDialogContent({ publicId }: { publicId: string }) {
  const t = useT();
  const [copied, setCopied] = React.useState(false);

  const embedUrl = `https://${typeof window !== "undefined" ? window.location.host : "localhost"}/embed/${publicId}`;
  const snippet = `<iframe src="${embedUrl}" width="640" height="360" frameborder="0" allowfullscreen></iframe>`;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold tracking-tight">
          {t("embedTitle")}
        </h2>
        <p className="text-xs text-muted-foreground">{embedUrl}</p>
      </div>
      <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 text-xs">
        {snippet}
      </pre>
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            navigator.clipboard.writeText(snippet);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          <Copy className="size-3.5" /> {copied ? t("copied") : t("copy")}
        </Button>
      </div>
    </div>
  );
}
