CREATE TYPE "public"."case_status" AS ENUM('new', 'active', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('uploaded', 'processing', 'processed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."information_status" AS ENUM('ai_extracted', 'verified', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."patient_match" AS ENUM('pending', 'match', 'mismatch', 'uncertain');--> statement-breakpoint
CREATE TYPE "public"."task_kind" AS ENUM('upload', 'question', 'action');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('open', 'submitted', 'done', 'snoozed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('patient', 'aa');--> statement-breakpoint
CREATE TABLE "cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"template_id" uuid,
	"status" "case_status" DEFAULT 'new' NOT NULL,
	"procedure_name" text,
	"surgery_date" date,
	"aa_visit_at" timestamp with time zone,
	"blood_loss_ml" integer,
	"is_oncological" boolean DEFAULT false NOT NULL,
	"contact_id" uuid,
	"summary" text,
	"summary_points" jsonb,
	"summary_at" timestamp with time zone,
	"aa_seen_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"task_id" uuid,
	"uploaded_by" uuid NOT NULL,
	"file_path" text NOT NULL,
	"file_name" text,
	"mime_type" text NOT NULL,
	"sha256" text NOT NULL,
	"status" "document_status" DEFAULT 'uploaded' NOT NULL,
	"type" text,
	"issued_date" date,
	"page_label" text,
	"patient_match" "patient_match" DEFAULT 'pending' NOT NULL,
	"patient_match_note" text,
	"patient_match_checked_by" uuid,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ai_model" text,
	"ai_output" jsonb,
	"error" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "documents_case_sha256_key" UNIQUE("case_id","sha256")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"case_id" uuid NOT NULL,
	"actor_id" uuid,
	"type" text NOT NULL,
	"subject_id" uuid,
	"summary" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "information" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"type" text NOT NULL,
	"value" jsonb NOT NULL,
	"raw_text" text,
	"observed_date" date,
	"is_observed_date_estimated" boolean DEFAULT false NOT NULL,
	"document_id" uuid,
	"bbox" jsonb,
	"confidence" numeric,
	"status" "information_status" NOT NULL,
	"entered_by" uuid,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"note" text,
	"replaces_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "information_has_source" CHECK ("information"."entered_by" is not null or "information"."document_id" is not null),
	CONSTRAINT "information_verified_has_who" CHECK ("information"."status" = 'ai_extracted' or "information"."verified_by" is not null)
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "login_attempts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"birth_number" text,
	"external_id" text,
	"birth_date" date NOT NULL,
	"sex" text,
	CONSTRAINT "patients_birth_number_unique" UNIQUE("birth_number"),
	CONSTRAINT "patients_external_id_unique" UNIQUE("external_id"),
	CONSTRAINT "patients_birth_number_format" CHECK ("patients"."birth_number" ~ '^[0-9]{9,10}$'),
	CONSTRAINT "patients_has_identifier" CHECK ("patients"."birth_number" is not null or "patients"."external_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"template_task_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"assignee" "user_role" NOT NULL,
	"assignee_id" uuid,
	"kind" "task_kind" NOT NULL,
	"title" text NOT NULL,
	"instructions" text,
	"document_type" text,
	"information_type" text,
	"valid_for_days" integer,
	"is_required" boolean DEFAULT true NOT NULL,
	"due_date" date,
	"document_id" uuid,
	"information_id" uuid,
	"status" "task_status" DEFAULT 'open' NOT NULL,
	"status_note" text,
	"snoozed_until" timestamp with time zone,
	"process" text,
	"alert_key" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"evidence" jsonb,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_by" uuid,
	"completed_at" timestamp with time zone,
	CONSTRAINT "tasks_target" CHECK (("tasks"."kind" <> 'upload' or "tasks"."document_type" is not null or "tasks"."information_type" is not null)
    and ("tasks"."kind" <> 'question' or "tasks"."information_type" is not null)),
	CONSTRAINT "tasks_patient_action_approved" CHECK (not ("tasks"."assignee" = 'patient' and "tasks"."kind" = 'action') or "tasks"."approved_by" is not null),
	CONSTRAINT "tasks_note_required" CHECK ("tasks"."status" not in ('snoozed', 'cancelled') or "tasks"."status_note" is not null),
	CONSTRAINT "tasks_snooze_has_until" CHECK ("tasks"."status" <> 'snoozed' or "tasks"."snoozed_until" is not null)
);
--> statement-breakpoint
CREATE TABLE "template_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"assignee" "user_role" NOT NULL,
	"kind" "task_kind" NOT NULL,
	"title" text NOT NULL,
	"instructions" text,
	"document_type" text,
	"information_type" text,
	"valid_for_days" integer,
	"is_required" boolean DEFAULT true NOT NULL,
	"applies_from_age" integer,
	"due_days_before_surgery" integer,
	CONSTRAINT "template_tasks_target" CHECK (("template_tasks"."kind" <> 'upload' or "template_tasks"."document_type" is not null or "template_tasks"."information_type" is not null)
    and ("template_tasks"."kind" <> 'question' or "template_tasks"."information_type" is not null))
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"blood_loss_ml" integer,
	"owner_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" "user_role" NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"display_name" text NOT NULL,
	"email" text,
	"phone" text,
	"phone_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_patient_id_patients_user_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_contact_id_users_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_patient_match_checked_by_users_id_fk" FOREIGN KEY ("patient_match_checked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information" ADD CONSTRAINT "information_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information" ADD CONSTRAINT "information_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information" ADD CONSTRAINT "information_entered_by_users_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information" ADD CONSTRAINT "information_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information" ADD CONSTRAINT "information_replaces_id_information_id_fk" FOREIGN KEY ("replaces_id") REFERENCES "public"."information"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_template_task_id_template_tasks_id_fk" FOREIGN KEY ("template_task_id") REFERENCES "public"."template_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_information_id_information_id_fk" FOREIGN KEY ("information_id") REFERENCES "public"."information"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_tasks" ADD CONSTRAINT "template_tasks_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cases_patient_idx" ON "cases" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "documents_case_idx" ON "documents" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "events_case_idx" ON "events" USING btree ("case_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "information_case_type_idx" ON "information" USING btree ("case_id","type","observed_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "information_document_idx" ON "information" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "information_to_verify_idx" ON "information" USING btree ("case_id","document_id") WHERE "information"."status" = 'ai_extracted';--> statement-breakpoint
CREATE INDEX "login_attempts_key_idx" ON "login_attempts" USING btree ("key","created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "tasks_case_idx" ON "tasks" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "tasks_queue_idx" ON "tasks" USING btree ("assignee","status");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_open_alert_key" ON "tasks" USING btree ("case_id","alert_key") WHERE "tasks"."status" in ('open', 'snoozed') and "tasks"."alert_key" is not null;--> statement-breakpoint
CREATE INDEX "template_tasks_template_idx" ON "template_tasks" USING btree ("template_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree (lower("email"));