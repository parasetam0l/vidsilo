"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderTreeIcon, PencilIcon, Trash2 } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

import { api, type Category } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useDialog } from "@/hooks/use-dialog";
import { useToast } from "@/hooks/use-toast";
import { categorySchema, fieldErrors, type FieldErrors } from "@/lib/validators";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/empty-state";
import { SummaryStrip } from "@/components/summary-strip";
import { Skeleton } from "@/components/ui/skeleton";
import { DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// App-bar action: opens the create-category dialog (wired by the admin layout).
export function useCreateCategoryAction() {
  const { open } = useDialog();
  return React.useCallback(() => {
    open({
      content: (close) => <CategoryFormContent onClose={close} />,
      size: "sm",
      dismissible: false,
      showCloseButton: false,
    });
  }, [open]);
}

export default function CategoriesPage() {
  const t = useT();
  const { open, confirm } = useDialog();
  const toast = useToast();
  const queryClient = useQueryClient();

  const { data: tree = [], isLoading } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api<Category[]>("/api/categories"),
  });

  const removeCategory = useMutation({
    mutationFn: (id: number) =>
      api<void>(`/api/categories/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success(t("deleted"));
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function openEdit(c: Category) {
    open({
      content: (close) => (
        <CategoryFormContent onClose={close} initial={c} />
      ),
      size: "sm",
      dismissible: false,
      showCloseButton: false,
    });
  }

  function askRemove(c: Category) {
    confirm({
      title: t("deleteCategoryTitle"),
      description: t("deleteCategoryDesc"),
      variant: "destructive",
      confirmLabel: t("delete"),
      cancelLabel: t("cancel"),
      onConfirm: () => removeCategory.mutateAsync(c.id),
      onError: (err: unknown) =>
        toast.error(err instanceof Error ? err.message : t("error")),
    });
  }

  const flat = React.useMemo(() => {
    const out: Category[] = [];
    const walk = (nodes: Category[]) => {
      for (const n of nodes) {
        out.push(n);
        if (n.children) walk(n.children);
      }
    };
    walk(tree);
    return out;
  }, [tree]);

  const depthOf = (id: number) => {
    let d = 0;
    let cur = flat.find((c) => c.id === id);
    while (cur?.parentId) {
      d++;
      cur = flat.find((c) => c.id === cur!.parentId);
    }
    return d;
  };

  const rootCount = flat.filter((c) => !c.parentId).length;
  const childCount = flat.length - rootCount;

  return (
    <div className="flex flex-1 flex-col gap-4 px-4 pb-4 pt-0">
      {/* Top summary strip */}
      <SummaryStrip
        items={[
          { label: t("sumTotalCategories"), value: flat.length },
          { label: t("sumRootCategories"), value: rootCount },
          ...(childCount > 0
            ? [{ label: t("sumSubcategories"), value: childCount }]
            : []),
        ]}
      />

      <Card className="overflow-hidden py-0 ">
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="hover:bg-transparent">
                <TableHead>{t("colName")}</TableHead>
                <TableHead>{t("colSlug")}</TableHead>
                <TableHead>{t("colParent")}</TableHead>
                <TableHead className="text-right">{t("colActions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i} className="hover:bg-transparent">
                    <TableCell colSpan={4}>
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : null}
              {!isLoading && flat.map((c) => {
                const depth = depthOf(c.id);
                return (
                  <TableRow
                    key={c.id}
                    tabIndex={0}
                    role="button"
                    aria-label={`${t("edit")} ${c.name}`}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openEdit(c);
                      }
                    }}
                    className="cursor-pointer transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    onClick={() => openEdit(c)}
                  >
                    <TableCell className="font-medium">
                      <span
                        style={{ paddingLeft: depth * 24 }}
                        className="flex items-center gap-3"
                      >
                        <Avatar className="size-7 rounded-lg">
                          <AvatarFallback
                            className={`rounded-lg ${
                              depth === 0
                                ? "bg-primary/10 text-primary"
                                : "bg-violet-500/10 text-violet-500"
                            }`}
                          >
                            <FolderTreeIcon className="size-3.5" />
                          </AvatarFallback>
                        </Avatar>
                        <span className="font-semibold text-foreground">{c.name}</span>
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-xs text-muted-foreground">
                        {c.slug}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs font-medium">
                      {flat.find((x) => x.id === c.parentId)?.name ?? "—"}
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" aria-label={`${t("edit")} ${c.name}`} onClick={() => openEdit(c)}>
                        <PencilIcon className="size-4" />
                      </Button>
                      <Button variant="ghost" size="icon" aria-label={`${t("delete")} ${c.name}`} onClick={() => askRemove(c)}>
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!isLoading && flat.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={4}>
                    <EmptyState
                      icon={FolderTreeIcon}
                      title={t("navCategories")}
                      description={t("dashEmpty")}
                    />
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function CategoryFormContent({
  onClose,
  initial,
}: {
  onClose: () => void;
  initial?: Category;
}) {
  const t = useT();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: () => api<Category[]>("/api/categories"),
  });
  const editing = !!initial;
  const [name, setName] = React.useState(initial?.name ?? "");
  const [parent, setParent] = React.useState(
    initial?.parentId ? String(initial.parentId) : "",
  );
  const [errors, setErrors] = React.useState<FieldErrors>({});

  const saveCategory = useMutation({
    mutationFn: () => {
      const body = {
        name,
        parentId: parent ? Number(parent) : null,
        position: initial?.position ?? 0,
      };
      return editing
        ? api<Category>(`/api/categories/${initial.id}`, {
            method: "PATCH",
            body: JSON.stringify(body),
          })
        : api<Category>("/api/categories", {
            method: "POST",
            body: JSON.stringify(body),
          });
    },
    onSuccess: () => {
      toast.success(editing ? t("categoryUpdated") : t("categoryCreated"));
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs = fieldErrors(categorySchema, {
      name,
      parentId: parent ? Number(parent) : null,
    });
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setErrors({});
    saveCategory.mutate();
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <DialogHeader>
        <DialogTitle>{editing ? t("editCategoryTitle") : t("newCategory")}</DialogTitle>
      </DialogHeader>
      <div className="flex flex-col gap-4 px-5">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-medium">{t("colName")}</Label>
          <Input
            className="rounded-lg"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setErrors((prev) => ({ ...prev, name: "" }));
            }}
          />
          <FormError message={errors.name} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-medium">{t("colParent")}</Label>
          <Select
            className="rounded-lg"
            options={[
              { value: "", label: t("none") },
              ...categories
                .filter((c) => c.id !== initial?.id)
                .map((c) => ({ value: String(c.id), label: c.name })),
            ]}
            value={parent}
            onChange={(v) => setParent(v ?? "")}
            placeholder={t("parentNone")}
          />
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={saveCategory.isPending}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={saveCategory.isPending}>
          {saveCategory.isPending ? t("loading") : t("save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
