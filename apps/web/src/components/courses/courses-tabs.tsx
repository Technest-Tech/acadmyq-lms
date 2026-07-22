"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth-provider";
import { cn } from "@/lib/utils";

/** The sub-navigation across the LMS dashboard: Courses · Access codes · Learners. */
export function CoursesTabs() {
  const t = useTranslations("courses.tabs");
  const pathname = usePathname();
  const { can } = useAuth();

  const tabs = [
    { key: "courses", href: "/courses", show: true },
    { key: "codes", href: "/courses/codes", show: can("access_code.manage") },
    { key: "learners", href: "/courses/learners", show: can("learner.read") },
  ].filter((tab) => tab.show);

  return (
    <nav className="flex gap-1 border-b">
      {tabs.map((tab) => {
        const active =
          tab.href === "/courses"
            ? pathname === "/courses"
            : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.key}
            href={tab.href}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
              active
                ? "border-primary text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {t(tab.key)}
          </Link>
        );
      })}
    </nav>
  );
}
