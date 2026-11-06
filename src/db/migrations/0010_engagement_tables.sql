CREATE TABLE "bookwise"."reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"rating" smallint NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"hidden_at" timestamp with time zone,
	"hidden_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reviews_booking_id_unique" UNIQUE("booking_id"),
	CONSTRAINT "reviews_rating" CHECK ("bookwise"."reviews"."rating" between 1 and 5),
	CONSTRAINT "reviews_comment_length" CHECK (char_length("bookwise"."reviews"."comment") <= 2000),
	CONSTRAINT "reviews_hidden_reason_length" CHECK (char_length("bookwise"."reviews"."hidden_reason") <= 500)
);
--> statement-breakpoint
CREATE TABLE "bookwise"."saved_listings" (
	"user_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_listings_user_id_listing_id_pk" PRIMARY KEY("user_id","listing_id")
);
--> statement-breakpoint
ALTER TABLE "bookwise"."reviews" ADD CONSTRAINT "reviews_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "bookwise"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookwise"."reviews" ADD CONSTRAINT "reviews_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "bookwise"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookwise"."saved_listings" ADD CONSTRAINT "saved_listings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "bookwise"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookwise"."saved_listings" ADD CONSTRAINT "saved_listings_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "bookwise"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reviews_listing_created_idx" ON "bookwise"."reviews" USING btree ("listing_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "reviews_customer_idx" ON "bookwise"."reviews" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "reviews_organization_idx" ON "bookwise"."reviews" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "saved_listings_user_created_idx" ON "bookwise"."saved_listings" USING btree ("user_id","created_at" desc);