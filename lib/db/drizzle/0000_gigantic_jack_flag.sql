CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'declined');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('task_assigned', 'task_updated', 'comment_added', 'sla_breached', 'mention', 'export_ready');--> statement-breakpoint
CREATE TYPE "public"."email_digest_frequency" AS ENUM('none', 'daily', 'weekly');--> statement-breakpoint
CREATE TYPE "public"."export_job_status" AS ENUM('pending', 'complete', 'expired');--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"is_instance_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"name" varchar(200) NOT NULL,
	"key_prefix" varchar(16) NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"scopes" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" varchar NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"invited_email" text,
	"invited_user_id" varchar,
	"invited_by_id" varchar NOT NULL,
	"token" varchar NOT NULL,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "org_members" (
	"org_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"role_id" text NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_members_org_id_user_id_pk" PRIMARY KEY("org_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"is_disabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"name" text NOT NULL,
	"is_built_in" boolean DEFAULT false NOT NULL,
	"is_owner" boolean DEFAULT false NOT NULL,
	"permissions" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" varchar,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'planning' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"due_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" varchar,
	"project_id" integer,
	"org_task_number" integer DEFAULT 0 NOT NULL,
	"source_webhook_id" integer,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'todo' NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"assignee" text,
	"due_date" date,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sla_breached_at" timestamp with time zone,
	"sla_warning_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"task_id" integer NOT NULL,
	"content" text NOT NULL,
	"author" text,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" varchar,
	"created_by" varchar,
	"title" text DEFAULT 'Untitled Note' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"visibility" varchar DEFAULT 'private' NOT NULL,
	"project_id" integer,
	"task_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbound_webhooks" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"project_id" integer,
	"created_by" varchar,
	"name" text NOT NULL,
	"token" varchar(64) NOT NULL,
	"task_template" json DEFAULT '{}'::json NOT NULL,
	"visibility" varchar DEFAULT 'private' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"rate_limit_per_minute" integer DEFAULT 60 NOT NULL,
	"task_template_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbound_webhooks_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "outbound_webhook_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"webhook_id" integer NOT NULL,
	"event" text NOT NULL,
	"url" text NOT NULL,
	"status_code" integer,
	"success" boolean NOT NULL,
	"duration_ms" integer NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbound_webhooks" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"project_id" integer,
	"created_by" varchar,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"secret" varchar(64) NOT NULL,
	"events" json DEFAULT '[]'::json NOT NULL,
	"visibility" varchar DEFAULT 'private' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_field_definitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"options" jsonb,
	"position" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"task_id" integer NOT NULL,
	"org_id" varchar NOT NULL,
	"actor_id" text,
	"actor_name" text,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"created_by" text NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_org_wide" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sla_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"project_id" integer,
	"priority" varchar(16) NOT NULL,
	"response_minutes" integer,
	"resolution_minutes" integer,
	"warning_threshold_percent" integer DEFAULT 80,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"created_by" text NOT NULL,
	"name" text NOT NULL,
	"default_title" text DEFAULT '' NOT NULL,
	"default_priority" varchar(16) DEFAULT 'medium' NOT NULL,
	"default_category" varchar(32) DEFAULT 'other' NOT NULL,
	"default_description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_stages" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"name" text NOT NULL,
	"color" varchar(7) DEFAULT '#6b7280' NOT NULL,
	"type" text DEFAULT 'open' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"org_id" varchar NOT NULL,
	"event_type" "notification_type" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"actor_id" varchar,
	"actor_name" text,
	"type" "notification_type" NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"message" text NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_watchers" (
	"task_id" integer NOT NULL,
	"user_id" varchar NOT NULL,
	"org_id" varchar NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_watchers_task_id_user_id_pk" PRIMARY KEY("task_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "instance_audit_log" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_features" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"feature" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"feature_state" text DEFAULT 'enabled' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_features_org_id_feature_uniq" UNIQUE("org_id","feature")
);
--> statement-breakpoint
CREATE TABLE "email_digest_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"frequency" "email_digest_frequency" DEFAULT 'none' NOT NULL,
	"last_sent_at" timestamp with time zone,
	"digest_claimed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_digest_preferences_user_idx" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "project_sla_policy_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" varchar NOT NULL,
	"project_id" integer NOT NULL,
	"actor_id" text,
	"actor_name" text,
	"previous_policies" jsonb NOT NULL,
	"new_policies" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "export_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"token" varchar(64) NOT NULL,
	"object_key" text NOT NULL,
	"status" "export_job_status" DEFAULT 'pending' NOT NULL,
	"filename" varchar(255) NOT NULL,
	"content_type" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_terminology" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" varchar NOT NULL,
	"term_key" text NOT NULL,
	"custom_label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_user_id_users_id_fk" FOREIGN KEY ("invited_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_id_users_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_webhooks" ADD CONSTRAINT "inbound_webhooks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_webhooks" ADD CONSTRAINT "inbound_webhooks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbound_webhooks" ADD CONSTRAINT "inbound_webhooks_task_template_id_task_templates_id_fk" FOREIGN KEY ("task_template_id") REFERENCES "public"."task_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_webhook_deliveries" ADD CONSTRAINT "outbound_webhook_deliveries_webhook_id_outbound_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."outbound_webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_webhooks" ADD CONSTRAINT "outbound_webhooks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_webhooks" ADD CONSTRAINT "outbound_webhooks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_policies" ADD CONSTRAINT "sla_policies_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sla_policies" ADD CONSTRAINT "sla_policies_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_stages" ADD CONSTRAINT "workflow_stages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_watchers" ADD CONSTRAINT "task_watchers_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_watchers" ADD CONSTRAINT "task_watchers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_watchers" ADD CONSTRAINT "task_watchers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_features" ADD CONSTRAINT "org_features_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_digest_preferences" ADD CONSTRAINT "email_digest_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_sla_policy_audit" ADD CONSTRAINT "project_sla_policy_audit_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_sla_policy_audit" ADD CONSTRAINT "project_sla_policy_audit_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_terminology" ADD CONSTRAINT "org_terminology_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_key_hash_idx" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "task_events_task_id_org_id_idx" ON "task_events" USING btree ("task_id","org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preferences_user_org_type_idx" ON "notification_preferences" USING btree ("user_id","org_id","event_type");--> statement-breakpoint
CREATE INDEX "task_watchers_task_id_idx" ON "task_watchers" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_watchers_user_org_idx" ON "task_watchers" USING btree ("user_id","org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "export_jobs_token_idx" ON "export_jobs" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "export_jobs_user_org_active_idx" ON "export_jobs" USING btree ("user_id","org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_terminology_org_key_idx" ON "org_terminology" USING btree ("org_id","term_key");