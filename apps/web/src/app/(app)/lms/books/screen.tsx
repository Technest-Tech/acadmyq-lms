"use client";

import { Library } from "lucide-react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth-provider";
import { BooksManager } from "@/components/courses/books-manager";
import { EmptyState } from "@/components/courses/lms-ui";

/**
 * The Books page of the LMS workspace (docs/lms/11) — digital products sold alongside the courses.
 * RBAC gate only; the plan gate renders as the nav lock + a 402 server-side, same as Courses.
 */
export function BooksScreen() {
  const t = useTranslations("books");
  const { can } = useAuth();

  if (!can("course.read")) {
    return (
      <div className="bg-card rounded-2xl shadow-sm ring-1 ring-foreground/[0.06]">
        <EmptyState Icon={Library} color="slate" title={t("noAccess")} />
      </div>
    );
  }

  return <BooksManager />;
}
