ALTER TABLE "documents" DROP CONSTRAINT "documents_case_sha256_key";--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "removed_by" uuid;--> statement-breakpoint
ALTER TABLE "information" ADD COLUMN "task_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "information" ADD CONSTRAINT "information_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "documents_case_sha256_key" ON "documents" USING btree ("case_id","sha256") WHERE "documents"."removed_at" is null;