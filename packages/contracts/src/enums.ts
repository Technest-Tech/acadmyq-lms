/**
 * Canonical enums — mirror Master Spec §9 and the PHP backed enums in
 * apps/api/app/Enums/*. Values are the wire format the API emits/accepts.
 *
 * Each enum is a runtime `as const` tuple (for iteration/validation) plus a
 * derived union type (for compile-time safety). Keep in lockstep with PHP.
 */

export const SESSION_STATUS = [
  "SCHEDULED",
  "ATTENDED",
  "ABSENT_UNEXCUSED",
  "ABSENT_EXCUSED",
  "CANCELLED_BY_TEACHER",
  "CANCELLED_BY_STUDENT",
  "RESCHEDULED",
] as const;
export type SessionStatus = (typeof SESSION_STATUS)[number];

export const INVOICE_STATUS = [
  "OPEN",
  "CLOSED",
  "PAID",
  "PARTIALLY_PAID",
  "VOID",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUS)[number];

export const PAYMENT_METHOD = ["CASH", "BANK_TRANSFER", "GATEWAY", "OTHER"] as const;
export type PaymentMethod = (typeof PAYMENT_METHOD)[number];

export const ACADEMY_STATUS = ["ACTIVE", "SUSPENDED", "TRIAL"] as const;
export type AcademyStatus = (typeof ACADEMY_STATUS)[number];

export const SUBSCRIPTION_STATUS = ["ACTIVE", "PAUSED", "ENDED"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUS)[number];

export const REPORT_FIELD_TYPE = [
  "TEXT",
  "TEXTAREA",
  "NUMBER",
  "SELECT",
  "RATING",
] as const;
export type ReportFieldType = (typeof REPORT_FIELD_TYPE)[number];

export const APP_ROLE = ["SUPER_ADMIN", "ACADEMY_OWNER", "TEACHER"] as const;
export type AppRole = (typeof APP_ROLE)[number];

export const INVOICE_GROUPING = ["PER_GUARDIAN", "PER_STUDENT"] as const;
export type InvoiceGrouping = (typeof INVOICE_GROUPING)[number];
