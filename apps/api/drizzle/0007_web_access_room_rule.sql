ALTER TABLE "seats" ALTER COLUMN "web_access" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "seats" ALTER COLUMN "web_access" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "meetings" ADD COLUMN "web_access" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_web_access_valid" CHECK ("meetings"."web_access" IN ('off', 'on', 'must'));--> statement-breakpoint
-- ADR 0017: seats that had web tools off now follow the room rule, which starts as off, so nothing changes for them.
-- Seats that had them on keep that as their own setting.
UPDATE "seats" SET "web_access" = NULL WHERE "web_access" = 'off';
