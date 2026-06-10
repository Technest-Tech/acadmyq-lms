import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <h2 className="text-xl font-semibold">404</h2>
      <Link href="/" className="text-primary underline underline-offset-4">
        Go home
      </Link>
    </div>
  );
}
