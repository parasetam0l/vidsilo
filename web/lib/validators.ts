// Client-side form validation (zod) mirroring the server-side rules.
// No HTML5 `required` reliance — every form validates here before submit,
// and the server re-validates anyway.
import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Email is required")
  // Loosely validated so single-label hosts like the seeded admin@localhost
  // pass; the server performs its own checks on real accounts.
  .regex(/^[^\s@]+@[^\s@]+$/, "Enter a valid email address");

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters");

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: passwordSchema,
    confirm: z.string().min(1, "Please confirm the new password"),
  })
  .refine((v) => v.newPassword === v.confirm, {
    message: "New passwords do not match",
    path: ["confirm"],
  });

export const userSchema = z.object({
  email: emailSchema,
  nameSurname: z.string().trim().max(120, "Name is too long").optional(),
  password: passwordSchema,
  role: z.enum(["admin", "editor", "uploader", "viewer"]),
});

export const userEditSchema = z.object({
  email: emailSchema,
  nameSurname: z.string().trim().max(120, "Name is too long").optional(),
  password: z.string().optional(),
  role: z.enum(["admin", "editor", "uploader", "viewer"]),
  disabled: z.boolean(),
});

export const categorySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Name is too long"),
  parentId: z.number().nullable().optional(),
});

export const flavorSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  label: z.string().trim().max(60).optional(),
  codec: z.enum(["h264", "h265"]),
  height: z.number().int().min(1, "Height must be at least 1"),
  videoMode: z.enum(["crf", "bitrate"]),
  crf: z.number().min(0).max(51).nullable().optional(),
  videoBitrate: z.number().int().positive().nullable().optional(),
  audioBitrate: z.number().int().positive(),
  preset: z.string().min(1),
});

export type FieldErrors = Record<string, string>;

// fieldErrors maps each failing field to its first validation message.
export function fieldErrors(
  schema: z.ZodTypeAny,
  data: unknown,
): FieldErrors {
  const res = schema.safeParse(data);
  if (res.success) return {};
  const out: FieldErrors = {};
  for (const issue of res.error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
