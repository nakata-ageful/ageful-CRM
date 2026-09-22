# Final preflight — 2026-09-22

Production was read only. All database writes described below were made to the temporary verification project or an isolated local restore.

## Billing-detail operations

The current normal application screen completed and reloaded: future invoice creation, plan change, invoice issue, payment, reasoned correction, manual direct-debit creation, and successful debit result. Supabase Auth and the guarded runtime path were used. Prior staging checks already proved anonymous denial, other-actor denial, append-only audit data, atomic rollback on an injected final write failure, and retry behavior.

## Access control

Access control is accepted for cutover preparation:

- A real authenticated staging session can read and write only through the intended runtime path.
- Anonymous source-table access is denied in staging.
- A different authenticated actor is denied owner-scoped runtime access.
- Ledger and audit tables expose authenticated `SELECT` only; mutation grants are absent and writes occur through guarded `SECURITY DEFINER` RPCs.
- Production Auth login was previously verified in auth-only mode without mounting or reading the application.

## Future schedule disposition

All 87 production projects are assigned to an explicit near-term disposition for the three-month operational view:

- 2 projects have visible, unsaved near-term actions.
- 56 projects remain visibly marked for configuration review: 30 no-method/no-amount candidates, 17 amount present but method missing, 6 amount present but schedule missing, and 3 with multiple or missing contracts.
- 29 projects have no action due in that near-term view.

The original three-month result was an operational-view check, not proof of perpetual future coverage. A defect was subsequently found: a saved row on the expected date whose amount, method or recipient differed was classified internally as `review` but omitted from this visible list. The display filter has been corrected so both unsaved and mismatched rows remain visible. The counts above are retained as the pre-fix baseline and must not be used by themselves to authorize cutover. Guessed dates, amounts, methods, or automatic creation remain prohibited.

The corrected code was then run read-only against the committed migrated clone for 24 months from September 2026. All 87 projects were classified: 56 configuration-review projects and 31 projects with expected schedules. It found 398 candidate occurrences (1 exact saved match, 397 unsaved future candidates, 0 saved-content mismatches). No `review` candidate was hidden. This is a bounded operational verification, not proof of perpetual schedule coverage and not permission to create all 397 candidates automatically.

## Latest backup and restore

- GET-only application capture was performed twice and both reads matched.
- A custom-format PostgreSQL dump was created from production and its archive catalog was readable.
- The `public` application schema was restored to local PostgreSQL 18. Supabase-host-specific extensions were intentionally excluded from this portable restore test.
- Restored values matched the latest application capture for all 8 source tables: 84 customers, 87 projects, 90 contracts, 26 annual records, 96 maintenance responses, 221 periodic-maintenance records, 14 prospects, and 0 attachments.

## Migration rehearsal

The pinned 17 SQL files were applied to an isolated new-database clone while a separate old-database clone was left untouched. A complete migration was committed to the new clone: 31 source-derived billing units totaling 4,177,465 yen, one direct-debit-failure-to-invoice occurrence, the confirmed Kakogawa round-one mapping, one Kakogawa round-two planned unit for 165,000 yen, the Amakusa individual service period, and acceptance for all 87 projects. The new clone therefore contains 32 units in total. After commit, all 8 source tables in both clones still matched the latest capture. The old clone has no new billing tables and the new runtime remains disabled.

`productionCutoverReady` remains false because the hosted new Supabase project has not received the final production clone and the new URL has not been authorized for use. The corrected 24-month review and separated-database migration/cutback rehearsal now pass. Near-term visibility alone is not a cutover gate.
