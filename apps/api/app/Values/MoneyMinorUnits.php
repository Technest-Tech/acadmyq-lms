<?php

declare(strict_types=1);

namespace App\Values;

use InvalidArgumentException;

/**
 * Money as integer minor units (e.g. piastres/cents) + ISO 4217 currency code.
 *
 * Master Spec §6.3: money is NEVER a float. The constructor's `int` type, under
 * `declare(strict_types=1)`, rejects float input with a TypeError at the call
 * site — there is no float path into this object. Cross-currency arithmetic is
 * forbidden (no implicit FX — R-INV-7).
 */
final readonly class MoneyMinorUnits
{
    public function __construct(
        public int $amount,
        public string $currency,
    ) {
        if (! preg_match('/^[A-Z]{3}$/', $currency)) {
            throw new InvalidArgumentException(
                "Currency must be a 3-letter uppercase ISO 4217 code, got: {$currency}"
            );
        }
    }

    public static function of(int $amount, string $currency): self
    {
        return new self($amount, $currency);
    }

    public static function add(self $a, self $b): self
    {
        self::assertSameCurrency($a, $b);

        return new self($a->amount + $b->amount, $a->currency);
    }

    public static function subtract(self $a, self $b): self
    {
        self::assertSameCurrency($a, $b);

        return new self($a->amount - $b->amount, $a->currency);
    }

    public function equals(self $other): bool
    {
        return $this->amount === $other->amount
            && $this->currency === $other->currency;
    }

    /** Serialize for API responses: { amount, currency }. */
    public function toArray(): array
    {
        return [
            'amount' => $this->amount,
            'currency' => $this->currency,
        ];
    }

    private static function assertSameCurrency(self $a, self $b): void
    {
        if ($a->currency !== $b->currency) {
            throw new InvalidArgumentException(
                "Cannot operate across currencies: {$a->currency} vs {$b->currency} (no FX in MVP, R-INV-7)."
            );
        }
    }
}
