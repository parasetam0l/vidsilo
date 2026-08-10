"use client";

import * as React from "react";
import { FolderTreeIcon, PencilIcon, Trash2 } from "lucide-react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  const [tree, setTree] = React.useState<Category[]>([]);

  const load = React.useCallback(() => {
    api<Category[]>("/api/categories")
      .then(setTree)
      .catch((e) => toast.error(e.message));
  }, [toast]);
  React.useEffect(load, [load]);

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
      onConfirm: async () => {
        try {
          await api<void>(`/api/categories/${c.id}`, { method: "DELETE" });
          toast.success(t("deleted"));
          load();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : t("error"));
          throw err; // keep the dialog open
        }
      },
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
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
              {flat.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    <span
                      style={{ paddingLeft: depthOf(c.id) * 20 }}
                      className="flex items-center gap-2"
                    >
                      <FolderTreeIcon className="size-4 text-muted-foreground" />
                      {c.name}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{c.slug}</TableCell>
                  <TableCell className="text-muted-foreground">
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
              ))}
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
  const [categories, setCategories] = React.useState<Category[]>([]);
  React.useEffect(() => {
    api<Category[]>("/api/categories").then(setCategories).catch(() => {});
  }, []);
  const editing = !!initial;
  const [name, setName] = React.useState(initial?.name ?? "");
  const [parent, setParent] = React.useState(
    initial?.parentId ? String(initial.parentId) : "",
  );
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<FieldErrors>({});

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
    setBusy(true);
    try {
      const body = {
        name,
        parentId: parent ? Number(parent) : null,
        position: initial?.position ?? 0,
      };
      if (editing) {
        await api<Category>(`/api/categories/${initial.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        toast.success(t("categoryUpdated"));
      } else {
        await api<Category>("/api/categories", {
          method: "POST",
          body: JSON.stringify(body),
        });
        toast.success(t("categoryCreated"));
      }
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      <h2 className="text-lg font-semibold tracking-tight">
        {editing ? t("editCategoryTitle") : t("newCategory")}
      </h2>
      <div className="flex flex-col gap-1.5">
        <Label>{t("colName")}</Label>
        <Input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setErrors((prev) => ({ ...prev, name: "" }));
          }}
        />
        <FormError message={errors.name} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>{t("colParent")}</Label>
        <Select value={parent} onValueChange={(v) => setParent(v ?? "")}>
          <SelectTrigger>
            <SelectValue placeholder={t("parentNone")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">{t("none")}</SelectItem>
            {categories
              .filter((c) => c.id !== initial?.id)
              .map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? t("loading") : t("save")}
        </Button>
      </div>
    </form>
  );
}
