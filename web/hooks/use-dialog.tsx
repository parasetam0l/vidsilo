"use client";

import * as React from "react";
import { createContext, useContext, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";

// Provider-based dialog manager: useDialog() gives you open/close/closeAll
// and confirm(), with stacked dialogs and per-dialog sizing.

type DialogSize = "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl" | "5xl" | "full" | "fullscreen";

const sizeClasses: Record<DialogSize, string> = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  lg: "sm:max-w-lg",
  xl: "sm:max-w-xl",
  "2xl": "sm:max-w-2xl",
  "3xl": "sm:max-w-3xl",
  "4xl": "sm:max-w-4xl",
  "5xl": "sm:max-w-5xl",
  full: "overflow-hidden md:max-w-[900px] lg:max-w-[1000px] md:h-[600px]",
  fullscreen: "overflow-hidden !max-w-[95vw] !w-[95vw] !h-[90vh] !max-h-[90vh]",
};

interface DialogEntry {
  id: string;
  content: React.ReactNode;
  dismissible: boolean;
  size: DialogSize;
  className?: string;
  showCloseButton?: boolean;
}

interface ConfirmOptions {
  title: string;
  description?: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "destructive";
  size?: DialogSize;
  onConfirm: () => void | Promise<void>;
  onError?: (err: unknown) => void;
}

interface OpenDialogOptions {
  content: React.ReactNode | ((close: () => void) => React.ReactNode);
  dismissible?: boolean;
  size?: DialogSize;
  className?: string;
  showCloseButton?: boolean;
}

interface DialogContextValue {
  open: (options: OpenDialogOptions) => string;
  close: (id?: string) => void;
  closeAll: () => void;
  confirm: (options: ConfirmOptions) => void;
}

const DialogContext = createContext<DialogContextValue | null>(null);

let nextId = 0;
function genId() {
  return `dlg-${++nextId}`;
}

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [dialogs, setDialogs] = useState<DialogEntry[]>([]);

  const closeDialog = useCallback((id?: string) => {
    setDialogs((prev) => {
      if (!id) {
        return prev.slice(0, -1);
      }
      return prev.filter((d) => d.id !== id);
    });
  }, []);

  const closeAll = useCallback(() => {
    setDialogs([]);
  }, []);

  const openDialog = useCallback(
    (options: OpenDialogOptions): string => {
      const id = genId();
      const closeSelf = () => closeDialog(id);
      const content =
        typeof options.content === "function"
          ? options.content(closeSelf)
          : options.content;

      const entry: DialogEntry = {
        id,
        content,
        dismissible: options.dismissible ?? false,
        size: options.size ?? "sm",
        className: options.className,
        showCloseButton: options.showCloseButton,
      };
      setDialogs((prev) => [...prev, entry]);
      return id;
    },
    [closeDialog],
  );

  const confirm = useCallback(
    (options: ConfirmOptions) => {
      const id = genId();
      const closeSelf = () => closeDialog(id);

      const entry: DialogEntry = {
        id,
        dismissible: false,
        size: options.size ?? "sm",
        content: <ConfirmDialogContent {...options} onClose={closeSelf} />,
      };
      setDialogs((prev) => [...prev, entry]);
    },
    [closeDialog],
  );

  const ctx: DialogContextValue = React.useMemo(
    () => ({ open: openDialog, close: closeDialog, closeAll, confirm }),
    [openDialog, closeDialog, closeAll, confirm],
  );

  return (
    <DialogContext.Provider value={ctx}>
      {children}
      {dialogs.map((entry) => (
        <Dialog
          key={entry.id}
          open
          modal
          disablePointerDismissal={!entry.dismissible}
          onOpenChange={(open) => {
            if (!open) closeDialog(entry.id);
          }}
        >
          <DialogContent
            className={cn(sizeClasses[entry.size], entry.className)}
            showCloseButton={entry.showCloseButton}
          >
            {entry.content}
          </DialogContent>
        </Dialog>
      ))}
    </DialogContext.Provider>
  );
}

function ConfirmDialogContent({
  title,
  description,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  onConfirm,
  onError,
  onClose,
}: ConfirmOptions & { onClose: () => void }) {
  const [isPending, setIsPending] = useState(false);

  const handleConfirm = async () => {
    setIsPending(true);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      onError?.(err);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className={variant === "destructive" ? "text-destructive" : ""}>
          {title}
        </DialogTitle>
        {description && <DialogDescription>{description}</DialogDescription>}
      </DialogHeader>
      {body}
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={isPending}>
          {cancelLabel}
        </Button>
        <Button variant={variant} onClick={handleConfirm} disabled={isPending}>
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {confirmLabel}
        </Button>
      </DialogFooter>
    </>
  );
}

export function useDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useDialog must be used within <DialogProvider>");
  return ctx;
}
