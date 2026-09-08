"use client";

import { BookMarked, Download, Eye } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useLearnHref } from "@/components/learn/context";
import { CourseThumb, Pill } from "@/components/learn/course-bits";
import type { LearnProductCard } from "@/lib/learn-api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * A book on the storefront (docs/lms/11).
 *
 * Two things earn their pixels here that a course card does not need. The **cover** is taller
 * (3:4 — a book is a portrait object, and a 16:9 crop of a book cover looks like a mistake), and the
 * **free-sample badge** is pinned to it, because "you can read a bit before paying" is the single
 * strongest reason a stranger clicks through to a book they have never heard of.
 */
export function BookCard({ book }: { book: LearnProductCard }) {
  const t = useTranslations("learn.books");
  const locale = useLocale();
  const href = useLearnHref();
  const hasPreview = (book.preview_count ?? 0) > 0;

  return (
    <Link
      href={href(`/b/${book.slug}`)}
      className="group bg-card focus-visible:ring-ring/60 flex flex-col overflow-hidden rounded-2xl border shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg focus-visible:ring-2 focus-visible:outline-none"
    >
      <CourseThumb src={book.cover_image_path} className="aspect-[3/4]" iconClassName="size-10">
        {hasPreview && (
          <div className="pointer-events-none absolute inset-x-2.5 top-2.5">
            <Pill className="bg-emerald-600/95 text-white shadow-sm">
              <Eye className="size-3" aria-hidden />
              {t("sampleBadge")}
            </Pill>
          </div>
        )}
      </CourseThumb>

      <div className="flex min-w-0 flex-1 flex-col gap-2 p-4">
        <h3
          dir="auto"
          className="group-hover:text-primary line-clamp-2 text-sm leading-snug font-bold transition-colors"
        >
          {book.title}
        </h3>
        {/* One derived fact, and only when it means something: a multi-file bundle is worth saying
            out loud, a single PDF is not. Everything else the client never typed. */}
        {book.file_count !== null && book.file_count > 1 && (
          <p className="text-muted-foreground inline-flex items-center gap-1 text-xs">
            <Download className="size-3.5" aria-hidden />
            {t("files", { count: book.file_count })}
          </p>
        )}

        <div className="mt-auto pt-2">
          {book.is_free ? (
            <Pill className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              {t("free")}
            </Pill>
          ) : (
            <span className="text-base font-bold tabular-nums">
              {formatMoney(
                { amount: book.price_minor, currency: book.currency },
                locale,
                { trimZeroDecimals: true },
              )}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

export function BookGrid({
  books,
  className,
}: {
  books: LearnProductCard[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 sm:gap-5",
        className,
      )}
    >
      {books.map((b) => (
        <BookCard key={b.id} book={b} />
      ))}
    </div>
  );
}

export function BookGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-card overflow-hidden rounded-2xl border shadow-sm">
          <div className="bg-muted aspect-[3/4] animate-pulse" />
          <div className="space-y-2 p-4">
            <div className="bg-muted h-4 w-3/4 animate-pulse rounded" />
            <div className="bg-muted h-3 w-1/2 animate-pulse rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** The empty shelf — used by the catalogue and by "my library". */
export function BookShelfEmpty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-dashed py-16 text-center">
      <BookMarked className="text-muted-foreground/40 mx-auto size-10" aria-hidden />
      <p className="mt-4 font-semibold">{title}</p>
      {hint && <p className="text-muted-foreground mt-1 text-sm">{hint}</p>}
    </div>
  );
}
