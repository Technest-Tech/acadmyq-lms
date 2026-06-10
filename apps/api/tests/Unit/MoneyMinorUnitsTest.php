<?php

declare(strict_types=1);

use App\Values\MoneyMinorUnits;

it('constructs with integer amount and ISO currency', function (): void {
    // TC-0.1
    $money = new MoneyMinorUnits(1500, 'EGP');

    expect($money->amount)->toBe(1500)
        ->and($money->currency)->toBe('EGP');
});

it('rejects a float amount with a TypeError', function (): void {
    // TC-0.2 — strict_types makes float->int a TypeError at the call site.
    new MoneyMinorUnits(15.0, 'EGP'); // @phpstan-ignore-line
})->throws(TypeError::class);

it('rejects an invalid currency code', function (): void {
    new MoneyMinorUnits(1500, 'egp');
})->throws(InvalidArgumentException::class);

it('adds two amounts of the same currency', function (): void {
    // TC-0.3
    $sum = MoneyMinorUnits::add(
        new MoneyMinorUnits(1000, 'EGP'),
        new MoneyMinorUnits(500, 'EGP'),
    );

    expect($sum->amount)->toBe(1500)
        ->and($sum->currency)->toBe('EGP');
});

it('refuses to add across currencies', function (): void {
    // TC-0.4 (R-INV-7: no implicit FX)
    MoneyMinorUnits::add(
        new MoneyMinorUnits(1000, 'EGP'),
        new MoneyMinorUnits(500, 'USD'),
    );
})->throws(InvalidArgumentException::class);
