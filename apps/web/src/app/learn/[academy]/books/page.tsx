"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { BookGrid, BookGridSkeleton, BookShelfEmpty } from "@/components/learn/book-card";
import { useLearn } from "@/components/learn/context";
import { Container, PageHero } from "@/components/learn/sections";
import { learnProducts, type LearnProductCard } from "@/lib/learn-api";
import { cn } from "@/lib/utils";

/**
 * The bookshop (docs/lms/11) — every published book, PDF and workbook this client sells.
 *
 * Filtering is client-side and deliberately so: a shop is tens of items, not thousands, and one
 * fetch means the facets can be derived from the ACTUAL catalogue (a client with only PDFs never
 * sees an "audiobook" filter) instead of being a fixed list that mostly returns nothing.
 */
export default function BooksPage() {
  const t = useTranslations("learn.books");
  const { academy } = useLearn();

  const [books, setBooks] = useState<LearnProductCard[] | null>(null);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<string>("all");
  const [price, setPrice] = useState<"all" | "free" | "paid">("all");

  useEffect(() => {
    learnProducts(academy)
      .then((r) => setBooks(r.products))
      .catch(() => setBooks([]));
  }, [academy]);

  const kinds = useMemo(() => {
    const seen = new Set((books ?? []).map((b) => b.kind));
    return [...seen];
  }, [books]);

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (books ?? []).filter((b) => {
      if (kind !== "all" && b.kind !== kind) return false;
      if (price === "free" && !b.is_free) return false;
      if (price === "paid" && b.is_free) return false;
      if (term === "") return true;
      return [b.title, b.subtitle, b.author, b.category]
        .filter((v): v is string => typeof v === "string")
        .some((v) => v.toLowerCase().includes(term));
    });
  }, [books, kind, price, search]);

  const filtering = search.trim() !== "" || kind !== "all" || price !== "all";

  return (
    <>
      <PageHero title={t("catalogTitle")} subtitle={t("catalogSubtitle")} />

      <Container className="py-8 sm:py-12">
        {books !== null && books.length > 0 && (
          <div className="mb-7 flex flex-wrap items-center gap-3">
            <div className="relative w-full sm:max-w-xs">
              <Search
                className="text-muted-foreground pointer-events-none absolute inset-y-0 start-3 my-auto size-4"
                aria-hidden
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("search")}
                aria-label={t("search")}
                className="border-border bg-card focus-visible:border-primary h-11 w-full rounded-xl border ps-9 pe-3 text-sm outline-none"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:ms-auto">
              <Chip active={price === "all"} onClick={() => setPrice("all")}>
                {t("filterAll")}
              </Chip>
              <Chip active={price === "free"} onClick={() => setPrice("free")}>
                {t("free")}
              </Chip>
              <Chip active={price === "paid"} onClick={() => setPrice("paid")}>
                {t("filterPaid")}
              </Chip>
              {/* Only worth a row of chips when the shelf actually holds more than one kind. */}
              {kinds.length > 1 &&
                kinds.map((k) => (
                  <Chip key={k} active={kind === k} onClick={() => setKind(kind === k ? "all" : k)}>
                    {t(`kind.${k}`)}
                  </Chip>
                ))}
            </div>
          </div>
        )}

        {books === null ? (
          <BookGridSkeleton />
        ) : shown.length === 0 ? (
          <BookShelfEmpty
            title={filtering ? t("noResults") : t("empty")}
            hint={filtering ? t("noResultsHint") : t("emptyHint")}
          />
        ) : (
          <BookGrid books={shown} />
        )}
      </Container>
    </>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "h-9 rounded-full border px-3.5 text-xs font-semibold transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border hover:border-primary/50 hover:text-primary",
      )}
    >
      {children}
    </button>
  );
}
