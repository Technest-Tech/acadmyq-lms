<?php

declare(strict_types=1);

namespace App\Support;

use RuntimeException;

/**
 * Thrown to unwind a finished dry run out of the transaction it ran in.
 *
 * A dry run that skipped the writes would only prove the plan parses. Doing the whole thing for
 * real and then throwing this puts every foreign key, CHECK and unique index in the way first,
 * so a dry run that reports clean means the real run will land — and nothing is kept.
 */
final class DryRunComplete extends RuntimeException {}
