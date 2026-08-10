"use client";

import * as React from "react";
import { FolderTree, Plus, Trash2 } from "lucide-react";

import { api, type Category } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function CategoriesPage() {
  const [tree, setTree] = React.useState<Category[]>([]);
  const [name, setName] = React.useState("");
  const [parent, setParent] = React.useState("");

  const load = React.useCallback(() => {
    api<Category[]>("/api/categories").then(setTree).catch(() => {});
  }, []);
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

  async function create() {
    await api<Category>("/api/categories", {
      method: "POST",
      body: JSON.stringify({ name, parentId: parent ? Number(parent) : null, position: 0 }),
    });
    setName("");
    setParent("");
    load();
  }

  async function update(c: Category, patch: Partial<Category>) {
    await api<Category>(`/api/categories/${c.id}`, {
      method: "PATCH",
      body: JSON.stringify({ ...c, ...patch }),
    });
    load();
  }

  async function remove(c: Category) {
    await api<void>(`/api/categories/${c.id}`, { method: "DELETE" });
    load();
  }

  const depthOf = (id: number) => {
    let d = 0;
    let cur = flat.find((c) => c.id === id);
    while (cur?.parentId) {
      d++;
      cur = flat.find((c) => c.id === cur!.parentId);
    }
    return d;
  };

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Categories</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tree structure for organizing entries
          </p>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Parent</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {flat.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    <span style={{ paddingLeft: depthOf(c.id) * 20 }} className="flex items-center gap-2">
                      <FolderTree className="size-4 text-muted-foreground" />
                      <Input
                        className="h-8 w-48"
                        defaultValue={c.name}
                        onBlur={(e) => {
                          if (e.target.value !== c.name) update(c, { name: e.target.value });
                        }}
                      />
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{c.slug}</TableCell>
                  <TableCell>
                    <Select
                      value={c.parentId ? String(c.parentId) : "none"}
                      onValueChange={(v) => update(c, { parentId: v === "none" ? null : Number(v) })}
                    >
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {flat
                          .filter((x) => x.id !== c.id)
                          .map((x) => (
                            <SelectItem key={x.id} value={String(x.id)}>
                              {x.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => remove(c)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium">New category</label>
          <Input
            className="w-56"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
          />
        </div>
        <Select value={parent} onValueChange={(v) => setParent(v ?? "")}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Parent (none)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">None</SelectItem>
            {flat.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={create}>
          <Plus className="size-4" />
        </Button>
      </div>
    </div>
  );
}
