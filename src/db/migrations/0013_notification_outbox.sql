CREATE TYPE "bookwise"."notification_status" AS ENUM('pending', 'sending', 'sent', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "bookwise"."notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"booking_id" uuid,
	"organization_id" uuid,
	"recipient_user_id" uuid NOT NULL,
	"recipient_email" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "bookwise"."notification_status" DEFAULT 'pending' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_dedupe_key_unique" UNIQUE("dedupe_key"),
	CONSTRAINT "notifications_kind_format" CHECK ("bookwise"."notifications"."kind" ~ '^[a-z0-9-]{3,60}$'),
	CONSTRAINT "notifications_last_error_length" CHECK (char_length("bookwise"."notifications"."last_error") <= 1000)
);
--> statement-breakpoint
ALTER TABLE "bookwise"."notifications" ADD CONSTRAINT "notifications_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "bookwise"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookwise"."notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "bookwise"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_due_idx" ON "bookwise"."notifications" USING btree ("next_attempt_at") WHERE "bookwise"."notifications"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "notifications_stuck_idx" ON "bookwise"."notifications" USING btree ("locked_until") WHERE "bookwise"."notifications"."status" = 'sending';--> statement-breakpoint
CREATE INDEX "notifications_booking_idx" ON "bookwise"."notifications" USING btree ("booking_id");