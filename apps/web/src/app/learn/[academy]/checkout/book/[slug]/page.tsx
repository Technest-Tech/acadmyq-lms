import { CheckoutScreen } from "@/components/learn/checkout-screen";

/**
 * Buying a book (docs/lms/11). The literal `book` segment beats the sibling `[slug]`, so
 * `/checkout/book/<slug>` never collides with a course whose slug happens to be "book".
 */
export default function BookCheckoutPage() {
  return <CheckoutScreen kind="book" />;
}
