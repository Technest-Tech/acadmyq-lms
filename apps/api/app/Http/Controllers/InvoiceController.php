<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Minimal invoice mutation endpoint to exercise the two-layer authorization contract this
 * sprint (full invoicing lands in Sprint 5). The capability check runs FIRST, before any
 * write, so a caller without `invoice.mark_paid` gets a 403 and the row is never touched
 * (TC-2.14/2.15, AC-2.5). RLS remains the backstop on the write itself.
 */
final class InvoiceController extends Controller
{
    /** POST /api/invoices/{id}/mark-paid — gated by invoice.mark_paid. */
    public function markPaid(string $id): JsonResponse
    {
        Gate::authorize('invoice.mark_paid');

        // CLOSED → PAID is the only legal transition (Sprint 1 immutability trigger).
        $affected = DB::table('invoices')
            ->where('id', $id)
            ->where('status', 'CLOSED')
            ->update([
                'status' => 'PAID',
                'paid_at' => now(),
                'payment_method' => 'CASH',
            ]);

        if ($affected === 0) {
            abort(404, 'Invoice not found or not payable.');
        }

        return response()->json(['ok' => true]);
    }
}
