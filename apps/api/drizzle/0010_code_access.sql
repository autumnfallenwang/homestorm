ALTER TABLE "meetings" ADD COLUMN "code_access" text DEFAULT 'on' NOT NULL;--> statement-breakpoint
ALTER TABLE "seats" ADD COLUMN "code_access" text;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_code_access_valid" CHECK ("meetings"."code_access" IN ('off', 'on'));--> statement-breakpoint
ALTER TABLE "seats" ADD CONSTRAINT "seats_code_access_valid" CHECK ("seats"."code_access" IN ('off', 'on'));