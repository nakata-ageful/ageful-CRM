# Production backup and restore procedure — 2026-09-22

The backup artifacts are private and are not committed to Git. The repository contains only this procedure and verification code.

## Backup set

- A GET-only JSON capture of all application rows in `customers`, `projects`, `contracts`, `annual_records`, `maintenance_responses`, `periodic_maintenance`, `prospects`, and `attachments`. Two complete reads must match before the capture is accepted.
- A PostgreSQL custom-format dump created with `pg_dump --format=custom --no-owner --no-privileges`.
- A private manifest containing both hashes, table counts, and rehearsal results.

## Verify before use

1. Verify the dump SHA-256 against the private manifest.
2. Run `pg_restore --list` and require a readable archive catalog.
3. Restore into a newly created, isolated PostgreSQL database. Never restore over production for a test.
4. For a portable workstation test, restore `--schema=public`; Supabase-host-only extensions are intentionally not required locally.
5. Run `private-backups/verify-production-dump.mjs` against the paired JSON capture. All 8 application tables must match by canonical value, not only by row count.

## Rehearse migration

1. Apply the 17 files pinned in `PRODUCTION_CUTOVER_MANIFEST_2026-09-21.json` to the isolated restore only.
2. Re-run the 8-table comparison; DDL must not alter source values.
3. Run `tests/restored-production-migration.cjs`. It wraps the data migration in one transaction and ends with `ROLLBACK`.
4. Require 31 billing units, 4,177,465 yen actual total, 87 accepted projects, and one direct-debit-failure-to-invoice occurrence for the 2026-09-22 source capture.
5. After rollback, require every new ledger/event/acceptance table to contain zero rows and re-run the source comparison.

## Actual recovery

Recovery is a controlled incident operation, not the legacy in-app restore button.

1. Stop application writes and record the incident time.
2. Create a new recovery project/database or an isolated recovery database; do not overwrite the damaged target first.
3. Restore the custom dump with the provider-supported extensions available. If a portable local restore is used for inspection, restore `public` only.
4. Compare the restored 8 application tables with the paired JSON capture.
5. Verify Auth access and RLS using a test user before switching the application URL/key.
6. Switch only after row/value reconciliation and a smoke test. Keep the damaged environment untouched until acceptance.

The old CSV/name-based application restore remains disabled for production because it cannot reproduce IDs, schema, RLS, Auth, or an exact point-in-time database state.
