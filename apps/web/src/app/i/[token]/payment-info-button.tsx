'use client';

import { useState } from 'react';
import { formatMoney } from '@/lib/money';

interface PaymentInfoButtonProps {
  currency: string;
  totalMinor: number;
}

export function PaymentInfoButton({ currency, totalMinor }: PaymentInfoButtonProps) {
  const [open, setOpen] = useState(false);

  const formattedEn = formatMoney({ amount: totalMinor, currency }, 'en');
  const formattedAr = formatMoney({ amount: totalMinor, currency }, 'ar');

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-xl bg-indigo-600 px-6 py-3 text-base font-semibold text-white shadow-sm hover:bg-indigo-500 active:bg-indigo-700 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
      >
        <span className="ltr:inline rtl:hidden">Pay Now</span>
        <span className="rtl:inline ltr:hidden">ادفع الآن</span>
        <span className="mx-2 opacity-60">·</span>
        <span className="ltr:inline rtl:hidden">{formattedEn}</span>
        <span className="rtl:inline ltr:hidden">{formattedAr}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="payment-dialog-title"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
          />

          {/* Dialog panel */}
          <div className="relative w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h2
              id="payment-dialog-title"
              className="text-lg font-semibold text-gray-900 mb-1"
            >
              <span className="ltr:block rtl:hidden">Payment Information</span>
              <span className="rtl:block ltr:hidden">معلومات الدفع</span>
            </h2>

            <p className="text-sm text-gray-600 mt-3 leading-relaxed">
              <span className="ltr:block rtl:hidden">
                Payment is arranged directly with the academy. Please contact
                your academy to complete the payment.
              </span>
              <span className="rtl:block ltr:hidden">
                يتم الدفع مباشرة مع الأكاديمية. يرجى التواصل مع الأكاديمية
                لإتمام عملية الدفع.
              </span>
            </p>

            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors"
              >
                <span className="ltr:inline rtl:hidden">Close</span>
                <span className="rtl:inline ltr:hidden">إغلاق</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
