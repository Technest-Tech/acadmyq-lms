import { ArrowLeft, ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { BlogEmpty, FeaturedPost, PostGrid } from "@/components/learn/blog-bits";
import { Container, PageHero } from "@/components/learn/sections";
import { resolveSiteName } from "@/lib/learn-brand";
import { fetchLearnPosts, fetchLearnSite } from "@/lib/learn-server";
import { cn } from "@/lib/utils";

/**
 * The blog's index (docs/lms/12). A SERVER page on purpose: a blog exists to be found, and an
 * article list that only appears after a browser fetch is an empty page to a search engine. The
 * newest post on page one gets the full width; the rest are a grid, twelve to a page.
 */

type Props = {
  params: Promise<{ academy: string }>;
  searchParams: Promise<{ page?: string }>;
};

function pageOf(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "1", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { academy } = await params;
  const page = pageOf((await searchParams).page);
  const t = await getTranslations("learn");
  const { site, academy: info } = await fetchLearnSite(academy).catch(() => ({
    site: null,
    academy: { name: "", url: null },
  }));

  const name = resolveSiteName(site?.brand.name ?? "", info.name) ?? t("brand.fallbackName");
  const title = `${t("blog.metaTitle")} — ${name}`;
  const description = t("blog.metaDescription", { name });
  const base = info.url && info.url.startsWith("http") ? `${info.url}/blog` : null;

  return {
    title,
    description,
    // The layout's canonical points at the site root; a blog page must claim its own address or
    // every article list reads to a search engine as a duplicate of the home page.
    ...(base ? { alternates: { canonical: page > 1 ? `${base}?page=${page}` : base } } : {}),
    openGraph: {
      title,
      description,
      siteName: name,
      type: "website",
      ...(base ? { url: base } : {}),
    },
  };
}

export default async function BlogIndexPage({ params, searchParams }: Props) {
  const { academy } = await params;
  const page = pageOf((await searchParams).page);
  const t = await getTranslations("learn.blog");
  const locale = await getLocale();
  const data = await fetchLearnPosts(academy, page);

  const posts = data?.posts ?? [];
  const featured = page === 1 ? (posts[0] ?? null) : null;
  const rest = featured ? posts.slice(1) : posts;
  const lastPage = data?.meta.last_page ?? 1;
  const Prev = locale.startsWith("ar") ? ArrowRight : ArrowLeft;
  const Next = locale.startsWith("ar") ? ArrowLeft : ArrowRight;

  return (
    <>
      <PageHero title={t("title")} subtitle={t("subtitle")} />

      <Container className="space-y-10 py-8 sm:py-12">
        {data === null ? (
          <BlogEmpty title={t("unavailable")} hint={t("unavailableHint")} />
        ) : posts.length === 0 ? (
          <BlogEmpty title={t("empty")} hint={t("emptyHint")} />
        ) : (
          <>
            {featured && <FeaturedPost post={featured} />}
            {rest.length > 0 && <PostGrid posts={rest} />}
          </>
        )}

        {lastPage > 1 && (
          <nav className="flex items-center justify-center gap-3" aria-label={t("pagination")}>
            <PageLink academy={academy} page={page - 1} disabled={page <= 1}>
              <Prev className="size-4" aria-hidden /> {t("newer")}
            </PageLink>
            <span className="text-muted-foreground text-sm tabular-nums">
              {t("pageOf", { page, total: lastPage })}
            </span>
            <PageLink academy={academy} page={page + 1} disabled={page >= lastPage}>
              {t("older")} <Next className="size-4" aria-hidden />
            </PageLink>
          </nav>
        )}
      </Container>
    </>
  );
}

function PageLink({
  academy,
  page,
  disabled,
  children,
}: {
  academy: string;
  page: number;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const className = cn(
    "border-border inline-flex h-10 items-center gap-1.5 rounded-xl border px-4 text-sm font-semibold transition-colors",
    disabled ? "pointer-events-none opacity-40" : "hover:border-primary/50 hover:text-primary",
  );

  return disabled ? (
    <span className={className} aria-disabled>
      {children}
    </span>
  ) : (
    <Link href={`/learn/${academy}/blog${page > 1 ? `?page=${page}` : ""}`} className={className}>
      {children}
    </Link>
  );
}
