CREATE TYPE "bookwise"."member_role" AS ENUM('owner', 'staff');--> statement-breakpoint
CREATE TYPE "bookwise"."organization_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TABLE "bookwise"."customer_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"phone" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"marketing_opt_in" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_profiles_locale_format" CHECK ("bookwise"."customer_profiles"."locale" ~ '^[a-z]{2}(-[A-Z]{2})?$')
);
--> statement-breakpoint
CREATE TABLE "bookwise"."organization_members" (
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "bookwise"."member_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_members_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "bookwise"."organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"timezone" text NOT NULL,
	"default_currency" char(3) DEFAULT 'CAD' NOT NULL,
	"status" "bookwise"."organization_status" DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug"),
	CONSTRAINT "organizations_name_length" CHECK (char_length("bookwise"."organizations"."name") between 2 and 100),
	CONSTRAINT "organizations_slug_format" CHECK ("bookwise"."organizations"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length("bookwise"."organizations"."slug") between 3 and 60),
	CONSTRAINT "organizations_currency_format" CHECK ("bookwise"."organizations"."default_currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "bookwise"."provider_profiles" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"description" text,
	"phone" text,
	"address" text,
	"city" text,
	"country" char(2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_profiles_description_length" CHECK (char_length("bookwise"."provider_profiles"."description") <= 2000),
	CONSTRAINT "provider_profiles_country_format" CHECK ("bookwise"."provider_profiles"."country" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "bookwise"."audit_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bookwise"."audit_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_user_id" uuid,
	"actor_role" text NOT NULL,
	"organization_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"ip_address" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookwise"."customer_profiles" ADD CONSTRAINT "customer_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "bookwise"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookwise"."organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "bookwise"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookwise"."organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "bookwise"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookwise"."organizations" ADD CONSTRAINT "organizations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "bookwise"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookwise"."provider_profiles" ADD CONSTRAINT "provider_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "bookwise"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organization_members_user_id_idx" ON "bookwise"."organization_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_organization_created_idx" ON "bookwise"."audit_logs" USING btree ("organization_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "audit_logs_actor_created_idx" ON "bookwise"."audit_logs" USING btree ("actor_user_id","created_at" desc);