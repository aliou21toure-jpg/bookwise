CREATE TYPE "bookwise"."listing_category" AS ENUM('service', 'activity', 'accommodation');--> statement-breakpoint
CREATE TYPE "bookwise"."listing_status" AS ENUM('draft', 'published', 'under_review', 'rejected');--> statement-breakpoint
CREATE TYPE "bookwise"."service_pricing" AS ENUM('per_booking', 'per_participant');--> statement-breakpoint
CREATE TYPE "bookwise"."slot_status" AS ENUM('open', 'blocked');--> statement-breakpoint
CREATE TABLE "bookwise"."listing_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"bytes" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"alt_text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listing_images_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "listing_images_content_type" CHECK ("bookwise"."listing_images"."content_type" in ('image/jpeg', 'image/png', 'image/webp')),
	CONSTRAINT "listing_images_bytes" CHECK ("bookwise"."listing_images"."bytes" between 1 and 5242880),
	CONSTRAINT "listing_images_dimensions" CHECK ("bookwise"."listing_images"."width" between 1 and 4000 and "bookwise"."listing_images"."height" between 1 and 4000),
	CONSTRAINT "listing_images_alt_length" CHECK (char_length("bookwise"."listing_images"."alt_text") <= 200)
);
--> statement-breakpoint
CREATE TABLE "bookwise"."listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"category" "bookwise"."listing_category" NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"city" text NOT NULL,
	"status" "bookwise"."listing_status" DEFAULT 'draft' NOT NULL,
	"archived_at" timestamp with time zone,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce("bookwise"."listings"."title", '')), 'A') ||
        setweight(to_tsvector('simple', coalesce("bookwise"."listings"."city", '')), 'B') ||
        setweight(to_tsvector('simple', coalesce("bookwise"."listings"."description", '')), 'C')) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listings_id_organization_key" UNIQUE("id","organization_id"),
	CONSTRAINT "listings_title_length" CHECK (char_length("bookwise"."listings"."title") between 3 and 120),
	CONSTRAINT "listings_description_length" CHECK (char_length("bookwise"."listings"."description") <= 5000),
	CONSTRAINT "listings_city_length" CHECK (char_length("bookwise"."listings"."city") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "bookwise"."services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"duration_minutes" integer NOT NULL,
	"price_minor" integer NOT NULL,
	"currency" char(3) NOT NULL,
	"pricing" "bookwise"."service_pricing" DEFAULT 'per_booking' NOT NULL,
	"capacity" integer DEFAULT 1 NOT NULL,
	"max_per_booking" integer DEFAULT 1 NOT NULL,
	"requires_approval" boolean DEFAULT false NOT NULL,
	"cancellation_window_hours" integer DEFAULT 24 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_id_organization_key" UNIQUE("id","organization_id"),
	CONSTRAINT "services_name_length" CHECK (char_length("bookwise"."services"."name") between 2 and 120),
	CONSTRAINT "services_description_length" CHECK (char_length("bookwise"."services"."description") <= 2000),
	CONSTRAINT "services_duration" CHECK ("bookwise"."services"."duration_minutes" between 5 and 1440),
	CONSTRAINT "services_price" CHECK ("bookwise"."services"."price_minor" between 0 and 100000000),
	CONSTRAINT "services_currency_format" CHECK ("bookwise"."services"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "services_capacity" CHECK ("bookwise"."services"."capacity" between 1 and 1000),
	CONSTRAINT "services_max_per_booking" CHECK ("bookwise"."services"."max_per_booking" between 1 and "bookwise"."services"."capacity"),
	CONSTRAINT "services_cancellation_window" CHECK ("bookwise"."services"."cancellation_window_hours" between 0 and 720)
);
--> statement-breakpoint
CREATE TABLE "bookwise"."availability_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_local" time NOT NULL,
	"end_local" time NOT NULL,
	"slot_interval_minutes" integer NOT NULL,
	"valid_from" date NOT NULL,
	"valid_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_rules_weekday" CHECK ("bookwise"."availability_rules"."weekday" between 0 and 6),
	CONSTRAINT "availability_rules_times" CHECK ("bookwise"."availability_rules"."end_local" > "bookwise"."availability_rules"."start_local"),
	CONSTRAINT "availability_rules_interval" CHECK ("bookwise"."availability_rules"."slot_interval_minutes" between 5 and 1440),
	CONSTRAINT "availability_rules_validity" CHECK ("bookwise"."availability_rules"."valid_until" is null or "bookwise"."availability_rules"."valid_until" >= "bookwise"."availability_rules"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "bookwise"."availability_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"capacity" integer NOT NULL,
	"reserved_count" integer DEFAULT 0 NOT NULL,
	"status" "bookwise"."slot_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_slots_service_start_key" UNIQUE("service_id","starts_at"),
	CONSTRAINT "availability_slots_reserved" CHECK ("bookwise"."availability_slots"."reserved_count" >= 0 and "bookwise"."availability_slots"."reserved_count" <= "bookwise"."availability_slots"."capacity"),
	CONSTRAINT "availability_slots_capacity" CHECK ("bookwise"."availability_slots"."capacity" >= 1),
	CONSTRAINT "availability_slots_range" CHECK ("bookwise"."availability_slots"."ends_at" > "bookwise"."availability_slots"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "bookwise"."unavailable_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"service_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unavailable_periods_range" CHECK ("bookwise"."unavailable_periods"."ends_at" > "bookwise"."unavailable_periods"."starts_at"),
	CONSTRAINT "unavailable_periods_reason_length" CHECK (char_length("bookwise"."unavailable_periods"."reason") <= 200)
);
--> statement-breakpoint
ALTER TABLE "bookwise"."listing_images" ADD CONSTRAINT "listing_images_listing_id_organization_id_listings_id_organization_id_fk" FOREIGN KEY ("listing_id","organization_id") REFERENCES "bookwise"."listings"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookwise"."listings" ADD CONSTRAINT "listings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "bookwise"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookwise"."services" ADD CONSTRAINT "services_listing_id_organization_id_listings_id_organization_id_fk" FOREIGN KEY ("listing_id","organization_id") REFERENCES "bookwise"."listings"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookwise"."availability_rules" ADD CONSTRAINT "availability_rules_service_id_organization_id_services_id_organization_id_fk" FOREIGN KEY ("service_id","organization_id") REFERENCES "bookwise"."services"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookwise"."availability_slots" ADD CONSTRAINT "availability_slots_service_id_organization_id_services_id_organization_id_fk" FOREIGN KEY ("service_id","organization_id") REFERENCES "bookwise"."services"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookwise"."unavailable_periods" ADD CONSTRAINT "unavailable_periods_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "bookwise"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookwise"."unavailable_periods" ADD CONSTRAINT "unavailable_periods_service_id_organization_id_services_id_organization_id_fk" FOREIGN KEY ("service_id","organization_id") REFERENCES "bookwise"."services"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listing_images_listing_idx" ON "bookwise"."listing_images" USING btree ("listing_id","position");--> statement-breakpoint
CREATE INDEX "listings_search_idx" ON "bookwise"."listings" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "listings_browse_idx" ON "bookwise"."listings" USING btree ("status","category",lower("city"));--> statement-breakpoint
CREATE INDEX "listings_organization_idx" ON "bookwise"."listings" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "services_listing_idx" ON "bookwise"."services" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "availability_rules_service_idx" ON "bookwise"."availability_rules" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "unavailable_periods_org_range_idx" ON "bookwise"."unavailable_periods" USING btree ("organization_id","starts_at","ends_at");