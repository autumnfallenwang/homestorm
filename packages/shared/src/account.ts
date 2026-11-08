// The admin's own login (ADR 0011), changed in Settings → Profile (ADR 0018).
import { z } from "zod";

/** Your name, or the email you sign in with. Better Auth keeps emails in lower case, so this does too. */
export const UpdateMeInput = z
  .object({
    name: z.string().trim().min(1, "Enter a name.").max(80),
    email: z.string().trim().toLowerCase().email("Enter an email address.").max(254),
  })
  .partial()
  .refine((v) => v.name !== undefined || v.email !== undefined, { message: "Nothing to change." });
export type UpdateMeInput = z.infer<typeof UpdateMeInput>;
