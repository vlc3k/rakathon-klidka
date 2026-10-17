ALTER TYPE "public"."user_role" ADD VALUE 'helper';--> statement-breakpoint
CREATE TABLE "helpers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"user_id" uuid,
	"display_name" text NOT NULL,
	"relation" text NOT NULL,
	"invite_token_hash" text NOT NULL,
	"invite_expires_at" timestamp with time zone NOT NULL,
	"consent_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"joined_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "helpers_relation" CHECK ("helpers"."relation" in ('daughter', 'son', 'partner', 'other'))
);
--> statement-breakpoint
ALTER TABLE "helpers" ADD CONSTRAINT "helpers_patient_id_patients_user_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helpers" ADD CONSTRAINT "helpers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helpers" ADD CONSTRAINT "helpers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "helpers_patient_idx" ON "helpers" USING btree ("patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "helpers_invite_token_key" ON "helpers" USING btree ("invite_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "helpers_user_key" ON "helpers" USING btree ("user_id");