CREATE TYPE "bookwise"."booking_status" AS ENUM('PENDING_PAYMENT', 'AWAITING_APPROVAL', 'CONFIRMED', 'CANCELLED', 'EXPIRED', 'COMPLETED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "bookwise"."hold_status" AS ENUM('active', 'converted', 'released');--> statement-breakpoint
CREATE TABLE "bookwise"."booking_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"slot_id" uuid NOT NULL,
	"quantity" smallint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" "bookwise"."hold_status" DEFAULT 'active' NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_holds_booking_id_unique" UNIQUE("booking_id"),
	CONSTRAINT "booking_holds_quantity" CHECK ("bookwise"."booking_holds"."quantity" >= 1)
);
--> statement-breakpoint
CREATE TABLE "bookwise"."booking_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"slot_id" uuid NOT NULL,
	"quantity" smallint NOT NULL,
	"unit_price_minor" integer NOT NULL,
	CONSTRAINT "booking_items_quantity" CHECK ("bookwise"."booking_items"."quantity" >= 1)
);
--> statement-breakpoint
CREATE TABLE "bookwise"."bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"status" "bookwise"."booking_status" DEFAULT 'PENDING_PAYMENT' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"quantity" smallint NOT NULL,
	"unit_price_minor" integer NOT NULL,
	"total_minor" integer NOT NULL,
	"currency" char(3) NOT NULL,
	"customer_note" text DEFAULT '' NOT NULL,
	"cancellation_reason" text,
	"cancelled_by" text,
	"approval_deadline" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_reference_unique" UNIQUE("reference"),
	CONSTRAINT "bookings_quantity" CHECK ("bookwise"."bookings"."quantity" between 1 and 1000),
	CONSTRAINT "bookings_money" CHECK ("bookwise"."bookings"."unit_price_minor" >= 0 and "bookwise"."bookings"."total_minor" >= 0),
	CONSTRAINT "bookings_currency_format" CHECK ("bookwise"."bookings"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "bookings_range" CHECK ("bookwise"."bookings"."ends_at" > "bookwise"."bookings"."starts_at"),
	CONSTRAINT "bookings_note_length" CHECK (char_length("bookwise"."bookings"."customer_note") <= 1000),
	CONSTRAINT "bookings_reason_length" CHECK (char_length("bookwise"."bookings"."cancellation_reason") <= 500)
);
--> statement-breakpoint
CREATE TABLE "bookwise"."idempotency_keys" (
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"scope" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" smallint,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_keys_user_id_key_pk" PRIMARY KEY("user_id","key"),
	CONSTRAINT "idempotency_keys_key_length" CHECK (char_length("bookwise"."idempotency_keys"."key") between 8 and 100)
);
--> statement-breakpoint
ALTER TABLE "bookwise"."booking_holds" ADD CONSTRAINT "booking_holds_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "bookwise"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookwise"."booking_holds" ADD CONSTRAINT "booking_holds_slot_id_availability_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "bookwise"."availability_slots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookwise"."booking_items" ADD CONSTRAINT "booking_items_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "bookwise"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookwise"."booking_items" ADD CONSTRAINT "booking_items_slot_id_availability_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "bookwise"."availability_slots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookwise"."bookings" ADD CONSTRAINT "bookings_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "bookwise"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookwise"."bookings" ADD CONSTRAINT "bookings_service_id_organization_id_services_id_organization_id_fk" FOREIGN KEY ("service_id","organization_id") REFERENCES "bookwise"."services"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookwise"."idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "bookwise"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_holds_active_slot_idx" ON "bookwise"."booking_holds" USING btree ("slot_id") WHERE "bookwise"."booking_holds"."status" = 'active';--> statement-breakpoint
CREATE INDEX "booking_holds_active_expiry_idx" ON "bookwise"."booking_holds" USING btree ("expires_at") WHERE "bookwise"."booking_holds"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "booking_items_booking_slot_key" ON "bookwise"."booking_items" USING btree ("booking_id","slot_id");--> statement-breakpoint
CREATE INDEX "booking_items_slot_idx" ON "bookwise"."booking_items" USING btree ("slot_id");--> statement-breakpoint
CREATE INDEX "bookings_customer_starts_idx" ON "bookwise"."bookings" USING btree ("customer_id","starts_at" desc);--> statement-breakpoint
CREATE INDEX "bookings_organization_starts_idx" ON "bookwise"."bookings" USING btree ("organization_id","starts_at");--> statement-breakpoint
CREATE INDEX "bookings_status_starts_idx" ON "bookwise"."bookings" USING btree ("status","starts_at");--> statement-breakpoint
CREATE INDEX "idempotency_keys_expires_idx" ON "bookwise"."idempotency_keys" USING btree ("expires_at");