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
 * digestClaimedAt is set atomically before a send begins so that a concurrent
 * or restarted process skips users that are already being processed.
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
    /**
     * Atomically written before a digest send begins. If this timestamp is
     * recent (within CLAIM_TTL_MS), another process already owns the send and
     * this process must skip the user. Prevents duplicate emails on restart.
     */
    digestClaimedAt: timestamp("digest_claimed_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique("email_digest_preferences_user_idx").on(table.userId)],
);

export type EmailDigestPreference =
  typeof emailDigestPreferencesTable.$inferSelect;
