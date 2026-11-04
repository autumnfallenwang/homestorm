ALTER TABLE "seats" ADD COLUMN "answer_length" text;--> statement-breakpoint
ALTER TABLE "seats" ADD CONSTRAINT "seats_answer_length_valid" CHECK ("seats"."answer_length" IN ('concise', 'detailed'));