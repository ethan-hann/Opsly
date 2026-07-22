import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(dateString: string | null | undefined, locale?: string) {
  if (!dateString) return "N/A";
  // ISO date-only strings (YYYY-MM-DD) are parsed as UTC midnight by the Date
  // constructor, which shifts them back a day for timezones west of UTC.
  // Parse them as local midnight instead.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dateString);
  const date = dateOnly
    ? new Date(`${dateString}T00:00:00`)
    : new Date(dateString);
  return new Intl.DateTimeFormat(locale ?? "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function formatTimeAgo(dateString: string, locale?: string) {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  return formatDate(dateString, locale);
}
