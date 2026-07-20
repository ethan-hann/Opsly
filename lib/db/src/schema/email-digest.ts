import {
  pgTable,
  serial,
  timestamp,
  varchar,
  pgEnum,
  unique,
} from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export const emailDigestFrequencyEnum = pgEnum("email_digest_frequency", [
  "none",
  "daily",
  "weekly",
]);

export type EmailDigestFrequency =
  (typeof emailDigestFrequencyEnum.enumValues)[number];

/**
 * Per-user preference for email notification digests.
 * One row per user — frequency defaults to "none" (opt-in model).
 * lastSentAt tracks the last digest delivery so the mailer can avoid duplicates.
 */
export const emailDigestPreferencesTable = pgTable(
  "email_digest_preferences",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    frequency: emailDigestFrequencyEnum("frequency").notNull().default("none"),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique("email_digest_preferences_user_idx").on(table.userId)],
);

export type EmailDigestPreference =
  typeof emailDigestPreferencesTable.$inferSelect;
