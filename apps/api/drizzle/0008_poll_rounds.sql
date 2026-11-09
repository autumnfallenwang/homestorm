ALTER TABLE "rounds" DROP CONSTRAINT "rounds_mode_valid";--> statement-breakpoint
ALTER TABLE "rounds" ADD COLUMN "poll" jsonb;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_mode_valid" CHECK ("rounds"."mode" IN ('blind', 'in_turn', 'single', 'wrap_up', 'poll'));