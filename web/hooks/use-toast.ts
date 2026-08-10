"use client";

import { toast } from "sonner";

type ToastType = "success" | "error" | "info";

export function useToast() {
  return {
    toast: (message: string, type: ToastType = "info") => {
      if (type === "success") toast.success(message);
      else if (type === "error") toast.error(message);
      else toast.info(message);
    },
    success: (message: string) => toast.success(message),
    error: (message: string) => toast.error(message),
    info: (message: string) => toast.info(message),
  };
}
