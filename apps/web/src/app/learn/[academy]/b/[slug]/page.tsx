"use client";

import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  Check,
  Download,
  Eye,
  FileText,
  Loader2,
  Lock,
  Sparkles,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useLearn, useLearnHref } from "@/components/learn/context";
import { CourseThumb, Pill } from "@/components/learn/course-bits";
import { Container, CtaButton } from "@/components/learn/sections";
import {
  learnClaimProduct,
  learnProduct,
  learnProductAccess,
  type LearnProductDetail,
  type LearnProductFile,
} from "@/lib/learn-api";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * A book's sales page (docs/lms/11).
 *
 * The whole design turns on one asymmetry: the visitor may see the table of contents in full but
 * may only OPEN the file marked as a free sample. That is the shop's honest bargain, so the file
 * list shows every title with an unmistakable lock or a Read-sample button — never a greyed-out row
 * that leaves you guessing what you would get.
 *
 * The CTA is computed from real facts in this order, so it is never a button that cannot work:
 *   owned          → Download
 *   free           → Get it free (signed in) / Sign in
 *   sells_online   → Buy
 *   otherwise      → nothing for sale here; the contact page is the fallback.
 */
export default function BookPage() {
  const t = useTranslations("learn");
  const locale = useLocale();
  const href = useLearnHref();
  const router = useRouter();
  const { academy, learner, openAuth } = useLearn();
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [data, setData] = useState<LearnProductDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [owned, setOwned] = useState(false);
  const [ownedFiles, setOwnedFiles] = useState<LearnProductFile[]>([]);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    learnProduct(academy, slug)
      .then(setData)
      .catch(() => setNotFound(true));
  }, [academy, slug]);

  // Ownership is a separate, authenticated question — the sales page itself is public, so it can be
  // rendered (and cached, and shared) without knowing who is looking at it.
  const loadAccess = useCallback(() => {
    if (learner === null) {
      setOwned(false);
      setOwnedFiles([]);
      return;
    }
    learnProductAccess(academy, slug)
      .then((r) => {
        setOwned(r.owned);
        setOwnedFiles(r.files);
      })
      .catch(() => {});
  }, [academy, slug, learner]);

  useEffect(loadAccess, [loadAccess]);

  async function claim() {
    if (learner === null) {
      openAuth("register");
      return;
    }
    setClaiming(true);
    setError(null);
    try {
      await learnClaimProduct(academy, slug);
      loadAccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("books.claimFailed"));
    } finally {
      setClaiming(false);
    }
  }

  if (notFound) {
    return (
      <Container className="py-24 text-center">
        <p className="font-semibold">{t("books.notFound")}</p>
        <CtaButton variant="outline" className="mt-6" href={href("/books")}>
          {t("books.backToShop")}
        </CtaButton>
      </Container>
    );
  }

  if (data === null) {
    return (
      <Container className="py-16">
        <div className="bg-muted h-72 animate-pulse rounded-2xl" />
      </Container>
    );
  }

  const book = data.product;
  // Once owned, every file resolves; before that, only the samples do.
  const files: LearnProductFile[] = owned && ownedFiles.length > 0 ? ownedFiles : data.files;
  const samples = files.filter((f) => f.is_preview);

  return (
    <>
      {/* ── the pitch ─────────────────────────────────────────────────────── */}
      <section className="relative isolate overflow-hidden border-b">
        <div
          className="absolute inset-0 -z-10"
          style={{ background: "linear-gradient(160deg, var(--brand-soft), transparent 70%)" }}
        />
        <Container className="py-10 sm:py-14">
          <Link
            href={href("/books")}
            className="text-muted-foreground hover:text-primary inline-flex items-center gap-1 text-sm font-medium"
          >
            <ArrowRight className="size-4 rotate-180 rtl:rotate-0" aria-hidden />
            {t("books.backToShop")}
          </Link>

          <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-12">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Pill className="bg-background/80 text-foreground border">
                  {t(`books.kind.${book.kind}`)}
                </Pill>
                {book.category !== null && book.category !== "" && (
                  <Pill className="bg-background/80 text-muted-foreground border" dir="auto">
                    {book.category}
                  </Pill>
                )}
                {samples.length > 0 && (
                  <Pill className="bg-emerald-600 text-white">
                    <Eye className="size-3" aria-hidden />
                    {t("books.sampleBadge")}
                  </Pill>
                )}
              </div>

              <h1
                dir="auto"
                className="mt-4 text-3xl font-bold tracking-tight text-balance sm:text-4xl"
              >
                {book.title}
              </h1>
              {book.subtitle !== null && book.subtitle !== "" && (
                <p dir="auto" className="text-muted-foreground mt-3 text-lg leading-relaxed">
                  {book.subtitle}
                </p>
              )}

              <div className="text-muted-foreground mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                {book.author !== null && book.author !== "" && (
                  <span dir="auto" className="inline-flex items-center gap-1.5">
                    <BadgeCheck className="size-4" aria-hidden />
                    {book.author}
                  </span>
                )}
                {book.page_count !== null && (
                  <span className="inline-flex items-center gap-1.5">
                    <FileText className="size-4" aria-hidden />
                    {t("books.pages", { count: book.page_count })}
                  </span>
                )}
                {book.language !== null && book.language !== "" && (
                  <span dir="auto" className="inline-flex items-center gap-1.5">
                    <BookOpen className="size-4" aria-hidden />
                    {book.language}
                  </span>
                )}
                {/* Real social proof only — a brand-new book reads as new rather than as unwanted. */}
                {book.owner_count > 0 && (
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="size-4" aria-hidden />
                    {t("books.owners", { count: book.owner_count })}
                  </span>
                )}
              </div>
            </div>

            {/* ── the buy card ──────────────────────────────────────────── */}
            <aside className="lg:sticky lg:top-24 lg:self-start">
              <div className="bg-card overflow-hidden rounded-2xl border shadow-sm">
                <CourseThumb
                  src={book.cover_image_path}
                  className="aspect-[3/4]"
                  loading="eager"
                  iconClassName="size-12"
                />
                <div className="space-y-4 p-5">
                  <div className="flex items-baseline justify-between gap-3">
                    {book.is_free ? (
                      <span className="inline-flex items-center gap-1.5 text-xl font-bold text-emerald-600">
                        <Sparkles className="size-5" aria-hidden />
                        {t("books.free")}
                      </span>
                    ) : (
                      <span className="text-2xl font-bold tabular-nums">
                        {formatMoney(
                          { amount: book.price_minor, currency: book.currency },
                          locale,
                          { trimZeroDecimals: true },
                        )}
                      </span>
                    )}
                  </div>

                  {owned ? (
                    <>
                      <p className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                        <Check className="size-4 shrink-0" aria-hidden />
                        {t("books.youOwnIt")}
                      </p>
                      <CtaButton
                        className="w-full"
                        onClick={() => {
                          document
                            .getElementById("book-files")
                            ?.scrollIntoView({ behavior: "smooth", block: "start" });
                        }}
                      >
                        <Download className="size-4" aria-hidden />
                        {t("books.download")}
                      </CtaButton>
                    </>
                  ) : book.is_free ? (
                    <CtaButton className="w-full" loading={claiming} onClick={() => void claim()}>
                      {claiming ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                      ) : (
                        <Download className="size-4" aria-hidden />
                      )}
                      {learner === null ? t("books.signInToGet") : t("books.getFree")}
                    </CtaButton>
                  ) : book.sells_online ? (
                    <CtaButton
                      className="w-full"
                      onClick={() => {
                        if (learner === null) {
                          openAuth("register");
                          return;
                        }
                        router.push(href(`/checkout/book/${slug}`));
                      }}
                    >
                      <Lock className="size-4" aria-hidden />
                      {t("books.buy")}
                    </CtaButton>
                  ) : (
                    // Priced, but there is nowhere to send the money — say so and point at the one
                    // channel that does work rather than showing a button that dead-ends.
                    <>
                      <p className="text-muted-foreground text-sm">{t("books.notSold")}</p>
                      <CtaButton variant="outline" className="w-full" href={href("/contact")}>
                        {t("books.contactUs")}
                      </CtaButton>
                    </>
                  )}

                  {samples.length > 0 && !owned && (
                    <a
                      href={samples[0]?.url ?? undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary flex w-full items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-semibold transition-colors hover:bg-[var(--brand-soft)]"
                    >
                      <Eye className="size-4" aria-hidden />
                      {t("books.readSample")}
                    </a>
                  )}

                  {error !== null && <p className="text-destructive text-sm">{error}</p>}
                </div>
              </div>
            </aside>
          </div>
        </Container>
      </section>

      {/* ── what's inside ─────────────────────────────────────────────────── */}
      <Container className="py-10 sm:py-14">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-12">
          <div className="min-w-0 space-y-10">
            {book.description !== null && book.description !== "" && (
              <section>
                <h2 className="text-xl font-bold">{t("books.about")}</h2>
                <p
                  dir="auto"
                  className="text-muted-foreground mt-3 leading-relaxed whitespace-pre-line"
                >
                  {book.description}
                </p>
              </section>
            )}

            {book.highlights.length > 0 && (
              <section>
                <h2 className="text-xl font-bold">{t("books.highlights")}</h2>
                <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                  {book.highlights.map((line, i) => (
                    <li key={i} className="flex gap-2.5 text-sm leading-relaxed">
                      <Check className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
                      <span dir="auto">{line}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {book.audience.length > 0 && (
              <section>
                <h2 className="text-xl font-bold">{t("books.audience")}</h2>
                <ul className="mt-4 space-y-2.5">
                  {book.audience.map((line, i) => (
                    <li key={i} className="flex gap-2.5 text-sm leading-relaxed">
                      <Users className="text-primary mt-0.5 size-4 shrink-0" aria-hidden />
                      <span dir="auto">{line}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section id="book-files" className="scroll-mt-24">
              <h2 className="text-xl font-bold">{t("books.contents")}</h2>
              <p className="text-muted-foreground mt-1 text-sm">
                {owned ? t("books.contentsOwned") : t("books.contentsHint")}
              </p>

              <ul className="mt-4 divide-y overflow-hidden rounded-2xl border">
                {files.map((file) => (
                  <FileRow key={file.id} file={file} owned={owned} />
                ))}
              </ul>
            </section>
          </div>
          <div aria-hidden className="hidden lg:block" />
        </div>
      </Container>
    </>
  );
}

/**
 * One row of the table of contents. A locked row still prints its title, size and page count —
 * telling someone WHAT they cannot open yet is the point of a contents list; hiding it would just
 * make the book look empty.
 */
function FileRow({ file, owned }: { file: LearnProductFile; owned: boolean }) {
  const t = useTranslations("learn.books");
  const openable = file.url !== null && (owned || file.is_preview);

  const meta = [
    file.format,
    file.page_count !== null ? t("pages", { count: file.page_count }) : null,
    file.size_bytes !== null && file.size_bytes > 0
      ? `${Math.max(1, Math.round(file.size_bytes / 1048576))} MB`
      : null,
  ].filter(Boolean);

  const body = (
    <>
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-xl text-[10px] font-bold",
          file.is_preview
            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
            : "bg-muted text-muted-foreground",
        )}
      >
        {file.format ?? <FileText className="size-4" aria-hidden />}
      </span>
      <span className="min-w-0 flex-1">
        <span dir="auto" className="block truncate text-sm font-semibold">
          {file.title}
        </span>
        {meta.length > 0 && (
          <span className="text-muted-foreground block truncate text-xs">{meta.join(" · ")}</span>
        )}
      </span>
      {openable ? (
        <span className="text-primary inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold">
          {owned ? <Download className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
          {owned ? t("downloadFile") : t("readSample")}
        </span>
      ) : (
        <span className="text-muted-foreground inline-flex shrink-0 items-center gap-1.5 text-xs">
          <Lock className="size-3.5" aria-hidden />
          {t("locked")}
        </span>
      )}
    </>
  );

  return (
    <li>
      {openable ? (
        <a
          href={file.url ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:bg-muted/50 flex items-center gap-3 p-4 transition-colors"
        >
          {body}
        </a>
      ) : (
        <div className="flex items-center gap-3 p-4">{body}</div>
      )}
    </li>
  );
}
