<?php

use Illuminate\Support\Facades\DB;

// Set SUPER_ADMIN role FIRST so RLS lets us read the academy, then scope to it.
DB::statement('select set_config(?,?,false)', ['app.current_role', 'SUPER_ADMIN']);
$acad = DB::selectOne('select id, name from academies limit 1');
DB::statement('select set_config(?,?,false)', ['app.current_academy_id', $acad->id]);

echo "Academy: {$acad->name}\n\n";

$autoBefore = DB::table('invoices')->where('kind', 'AUTO')->count();
echo "AUTO invoices before: {$autoBefore}\n";

DB::transaction(function () use ($acad) {
    $autoIds = DB::table('invoices')->where('kind', 'AUTO')->pluck('id');

    $lines = DB::table('invoice_line_items')->whereIn('invoice_id', $autoIds)->delete();
    echo sprintf("%-22s %d deleted\n", 'invoice_line_items', $lines);

    $inv = DB::table('invoices')->whereIn('id', $autoIds)->delete();
    echo sprintf("%-22s %d deleted\n", 'invoices (AUTO)', $inv);
});

echo "\n=== remaining ===\n";
printf("%-22s %d\n", 'invoices AUTO', DB::table('invoices')->where('kind', 'AUTO')->count());
printf("%-22s %d\n", 'invoices MANUAL', DB::table('invoices')->where('kind', 'MANUAL')->count());
printf("%-22s %d\n", 'invoice_line_items', DB::table('invoice_line_items')->count());
printf("%-22s %d\n", 'sessions', DB::table('sessions')->count());
printf("%-22s %d\n", 'students', DB::table('students')->count());
