ALTER TABLE "messages" ADD COLUMN "view_tokens" integer;--> statement-breakpoint
ALTER TABLE "seats" ADD COLUMN "context_budget" text;--> statement-breakpoint
ALTER TABLE "seats" ADD CONSTRAINT "seats_context_budget_valid" CHECK ("seats"."context_budget" IN ('small', 'standard', 'large', 'full'));