"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderIcon, FolderTreeIcon, PencilIcon, Trash2, FolderGit2Icon } from "lucide-react";
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

  const { data: tree = [] } = useQuery({
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
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-xl border bg-card px-3.5 py-2 shadow-2xs">
          <FolderTreeIcon className="size-4 text-primary" />
          <span className="text-xs text-muted-foreground">Total Categories:</span>
          <span className="text-sm font-bold text-foreground tabular-nums">{flat.length}</span>
        </div>
        <div className="flex items-center gap-2 rounded-xl border bg-blue-500/10 border-blue-500/20 px-3.5 py-2 shadow-2xs">
          <FolderIcon className="size-4 text-blue-500" />
          <span className="text-xs text-blue-700 dark:text-blue-300 font-medium">Root Categories:</span>
          <span className="text-sm font-bold text-blue-600 dark:text-blue-400 tabular-nums">{rootCount}</span>
        </div>
        {childCount > 0 ? (
          <div className="flex items-center gap-2 rounded-xl border bg-violet-500/10 border-violet-500/20 px-3.5 py-2 shadow-2xs">
            <FolderGit2Icon className="size-4 text-violet-500" />
            <span className="text-xs text-violet-700 dark:text-violet-300 font-medium">Subcategories:</span>
            <span className="text-sm font-bold text-violet-600 dark:text-violet-400 tabular-nums">{childCount}</span>
          </div>
        ) : null}
      </div>

      <Card className="overflow-hidden py-0 shadow-sm">
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
              {flat.map((c) => {
                const depth = depthOf(c.id);
                return (
                  <TableRow key={c.id} className="transition-colors hover:bg-muted/40">
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
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(c)}>
                        <PencilIcon className="size-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => askRemove(c)}>
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {flat.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={4}>
                    <EmptyState
                      icon={FolderTreeIcon}
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
      <h2 className="text-lg font-semibold tracking-tight">
        {editing ? t("editCategoryTitle") : t("newCategory")}
      </h2>
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
      <div className="flex justify-end gap-2 border-t pt-3">
        <Button type="button" variant="outline" className="rounded-lg text-xs" onClick={onClose} disabled={saveCategory.isPending}>
          {t("cancel")}
        </Button>
        <Button type="submit" className="rounded-lg text-xs" disabled={saveCategory.isPending}>
          {saveCategory.isPending ? t("loading") : t("save")}
        </Button>
      </div>
    </form>
  );
}
