<?php

declare(strict_types=1);

namespace App\Support;

use RuntimeException;

/**
 * Carries a preview's result out of the transaction it rolls back: the work runs for real, then
 * this is thrown so nothing it wrote is kept (Admin\ClientDeletedController).
 */
final class PreviewRolledBack extends RuntimeException
{
    /** @param array<string, mixed> $report */
    public function __construct(public readonly array $report)
    {
        parent::__construct('preview');
    }
}
