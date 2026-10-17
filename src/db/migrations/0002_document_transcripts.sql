CREATE TYPE "public"."transcript_status" AS ENUM('processing', 'processed', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "document_transcripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"status" "transcript_status" DEFAULT 'processing' NOT NULL,
	"document_type" text,
	"issued_date" date,
	"page_count" integer NOT NULL,
	"transcript_text" text,
	"output" jsonb,
	"model" text,
	"prompt_version" text,
	"schema_version" integer,
	"usage" jsonb,
	"duration_ms" integer,
	"attempts" integer,
	"error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "transcript" jsonb;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "transcript_text" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "ai_meta" jsonb;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "transcript_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "page_number" integer;--> statement-breakpoint
ALTER TABLE "information" ADD COLUMN "transcript_id" uuid;--> statement-breakpoint
ALTER TABLE "document_transcripts" ADD CONSTRAINT "document_transcripts_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_transcripts" ADD CONSTRAINT "document_transcripts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_transcripts_case_idx" ON "document_transcripts" USING btree ("case_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_transcript_id_document_transcripts_id_fk" FOREIGN KEY ("transcript_id") REFERENCES "public"."document_transcripts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information" ADD CONSTRAINT "information_transcript_id_document_transcripts_id_fk" FOREIGN KEY ("transcript_id") REFERENCES "public"."document_transcripts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_transcript_idx" ON "documents" USING btree ("transcript_id");