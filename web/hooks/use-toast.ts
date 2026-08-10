"use client";

import * as React from "react";
import { toast } from "sonner";

type ToastType = "success" | "error" | "info";

export function useToast() {
  const show = React.useCallback((message: string, type: ToastType = "info") => {
    if (type === "success") toast.success(message);
    else if (type === "error") toast.error(message);
    else toast.info(message);
  }, []);

  return React.useMemo(
    () => ({
      toast: show,
      success: (message: string) => show(message, "success"),
      error: (message: string) => show(message, "error"),
      info: (message: string) => show(message, "info"),
    }),
    [show],
  );
}
