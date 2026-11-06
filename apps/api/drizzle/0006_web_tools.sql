ALTER TABLE "messages" DROP CONSTRAINT "messages_author_kind_valid";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "tool_calls" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "seats" ADD COLUMN "web_access" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_kind_valid" CHECK ("messages"."author_kind" IN ('chair', 'seat', 'event', 'brief', 'sources'));--> statement-breakpoint
ALTER TABLE "seats" ADD CONSTRAINT "seats_web_access_valid" CHECK ("seats"."web_access" IN ('off', 'on', 'must'));