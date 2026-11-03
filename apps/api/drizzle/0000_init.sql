CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"id_token" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"default_mode" text DEFAULT 'blind' NOT NULL,
	"answer_length" text DEFAULT 'concise' NOT NULL,
	"clock" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meetings_default_mode_valid" CHECK ("meetings"."default_mode" IN ('blind', 'in_turn')),
	CONSTRAINT "meetings_answer_length_valid" CHECK ("meetings"."answer_length" IN ('concise', 'detailed'))
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"seq" integer GENERATED ALWAYS AS IDENTITY (sequence name "messages_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"author_kind" text NOT NULL,
	"seat_id" uuid,
	"round_id" uuid,
	"reply_to_id" uuid,
	"content" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"error" jsonb,
	"send_mode" text,
	"target_seat_ids" jsonb,
	"wrap_kind" text,
	"hidden_from_seats" boolean DEFAULT false NOT NULL,
	"visible_seq" integer,
	"cutoff_seq" integer,
	"model" text,
	"owned_by" text,
	"reasoning_effort" text,
	"usage" jsonb,
	"cost_usd" double precision,
	"llmgw_req_id" text,
	"request_id" text,
	"trimmed_count" integer DEFAULT 0 NOT NULL,
	"stopped_early" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "messages_author_kind_valid" CHECK ("messages"."author_kind" IN ('chair', 'seat', 'event')),
	CONSTRAINT "messages_status_valid" CHECK ("messages"."status" IN ('queued', 'streaming', 'done', 'stopped', 'error', 'skipped')),
	CONSTRAINT "messages_seat_has_seat" CHECK ("messages"."author_kind" <> 'seat' OR "messages"."seat_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"mode" text NOT NULL,
	"seat_ids" jsonb NOT NULL,
	"prompt_message_id" uuid,
	"reply_to_id" uuid,
	"wrap_kind" text,
	"status" text DEFAULT 'running' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "rounds_mode_valid" CHECK ("rounds"."mode" IN ('blind', 'in_turn', 'single', 'wrap_up')),
	CONSTRAINT "rounds_status_valid" CHECK ("rounds"."status" IN ('running', 'done', 'stopped'))
);
--> statement-breakpoint
CREATE TABLE "seats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid NOT NULL,
	"model" text NOT NULL,
	"owned_by" text NOT NULL,
	"display_name" text NOT NULL,
	"persona" text,
	"position" integer NOT NULL,
	"muted" boolean DEFAULT false NOT NULL,
	"reasoning_effort" text DEFAULT 'low' NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seats_owned_by_valid" CHECK ("seats"."owned_by" IN ('anthropic', 'openai-codex', 'deepseek')),
	CONSTRAINT "seats_reasoning_effort_valid" CHECK ("seats"."reasoning_effort" IN ('low', 'medium', 'high'))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_seat_id_seats_id_fk" FOREIGN KEY ("seat_id") REFERENCES "public"."seats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seats" ADD CONSTRAINT "seats_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_meeting_seq_idx" ON "messages" USING btree ("meeting_id","seq");--> statement-breakpoint
CREATE INDEX "messages_round_idx" ON "messages" USING btree ("round_id");--> statement-breakpoint
CREATE INDEX "rounds_meeting_idx" ON "rounds" USING btree ("meeting_id","number");--> statement-breakpoint
CREATE INDEX "seats_meeting_idx" ON "seats" USING btree ("meeting_id","position");