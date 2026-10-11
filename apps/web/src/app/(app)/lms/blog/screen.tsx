"use client";

import { Newspaper } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth-provider";
import { BlogManager } from "@/components/courses/blog-manager";
import { EmptyState } from "@/components/courses/lms-ui";

/**
 * The Blog page of the LMS workspace (docs/lms/12) — articles on the client's public course site.
 * RBAC gate only; the plan gate renders as the nav lock + a 402 server-side, same as Courses.
 */
export function BlogScreen() {
  const t = useTranslations("blog");
  const { can } = useAuth();

  if (!can("course.read")) {
    return (
      <div className="bg-card rounded-2xl shadow-sm ring-1 ring-foreground/[0.06]">
        <EmptyState Icon={Newspaper} color="slate" title={t("noAccess")} />
      </div>
    );
  }

  return <BlogManager />;
}
