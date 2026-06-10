<?php

declare(strict_types=1);

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    /**
     * The schema uses Postgres ENUM types and VIEWs-like objects; tell RefreshDatabase's
     * migrate:fresh to drop them too, so the persistent test database re-migrates cleanly
     * across runs (otherwise `create type ...` fails on a second run).
     */
    protected bool $dropViews = true;

    protected bool $dropTypes = true;
}
