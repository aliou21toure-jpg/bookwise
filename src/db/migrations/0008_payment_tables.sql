CREATE TYPE "bookwise"."capture_method" AS ENUM('automatic', 'manual');--> statement-breakpoint
CREATE TYPE "bookwise"."payment_provider" AS ENUM('stripe', 'fake');--> statement-breakpoint
CREATE TYPE "bookwise"."payment_status" AS ENUM('requires_payment', 'authorized', 'succeeded', 'failed', 'canceled');--> statement-breakpoint
CREATE TYPE "bookwise"."refund_status" AS ENUM('pending', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "bookwise"."payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid,
	"provider" "bookwise"."payment_provider" NOT NULL,
	"provider_event_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"outcome" text,
	"note" text,
	CONSTRAINT "payment_events_provider_event_id_unique" UNIQUE("provider_event_id")
);
--> statement-breakpoint
CREATE TABLE "bookwise"."payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider" "bookwise"."payment_provider" NOT NULL,
	"provider_payment_id" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" char(3) NOT NULL,
	"capture_method" "bookwise"."capture_method" NOT NULL,
	"status" "bookwise"."payment_status" DEFAULT 'requires_payment' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_booking_id_unique" UNIQUE("booking_id"),
	CONSTRAINT "payments_provider_payment_id_unique" UNIQUE("provider_payment_id"),
	CONSTRAINT "payments_amount" CHECK ("bookwise"."payments"."amount_minor" > 0),
	CONSTRAINT "payments_currency_format" CHECK ("bookwise"."payments"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "bookwise"."refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"provider_refund_id" text,
	"amount_minor" integer NOT NULL,
	"reason" text NOT NULL,
	"status" "bookwise"."refund_status" DEFAULT 'pending' NOT NULL,
	"requested_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_provider_refund_id_unique" UNIQUE("provider_refund_id"),
	CONSTRAINT "refunds_amount" CHECK ("bookwise"."refunds"."amount_minor" > 0)
);
--> statement-breakpoint
ALTER TABLE "bookwise"."payment_events" ADD CONSTRAINT "payment_events_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "bookwise"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookwise"."payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "bookwise"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookwise"."refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "bookwise"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookwise"."refunds" ADD CONSTRAINT "refunds_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "bookwise"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_events_payment_idx" ON "bookwise"."payment_events" USING btree ("payment_id","received_at");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "bookwise"."payments" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_one_active_per_payment" ON "bookwise"."refunds" USING btree ("payment_id") WHERE "bookwise"."refunds"."status" <> 'failed';--> statement-breakpoint
CREATE INDEX "refunds_status_idx" ON "bookwise"."refunds" USING btree ("status");