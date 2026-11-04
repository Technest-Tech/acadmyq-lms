<?php

declare(strict_types=1);

namespace App\Services;

use Illuminate\Http\JsonResponse;
use Illuminate\Validation\ValidationException;

/**
 * A sale held by the family's pay-first policy ({@see RenewalPolicy}): a 422 like any refusal, with
 * `code: "PAY_FIRST"` beside `message` / `errors` so the desk's form can offer the override, and the
 * unpaid bill named at the top level. Still a ValidationException, so a transaction rolls back the
 * same way and a caller that only knows 422s sees one.
 */
final class PayFirstRefusal extends ValidationException
{
    public static function of(string $message, string $invoiceId, string $subscriptionId): self
    {
        $e = self::withMessages(['student_id' => [$message], 'unpaid_invoice_id' => [$invoiceId], 'unpaid_subscription_id' => [$subscriptionId]]);
        $self = new self($e->validator);
        $self->unpaidInvoiceId = $invoiceId;
        $self->unpaidSubscriptionId = $subscriptionId;

        return $self;
    }

    public string $unpaidInvoiceId = '';

    public string $unpaidSubscriptionId = '';

    public function render(): JsonResponse
    {
        return response()->json([
            'message' => $this->getMessage(),
            'errors' => $this->errors(),
            'code' => 'PAY_FIRST',
            'pay_first' => true,
            'unpaid_invoice_id' => $this->unpaidInvoiceId,
            'unpaid_subscription_id' => $this->unpaidSubscriptionId,
        ], 422);
    }
}
