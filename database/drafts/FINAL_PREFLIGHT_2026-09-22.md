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

This verification means there is no silent category in the operational view. It does **not** authorize guessed dates, amounts, methods, or automatic creation. The 56 review items stay visible after cutover and are intentionally not filled automatically.

## Latest backup and restore

- GET-only application capture was performed twice and both reads matched.
- A custom-format PostgreSQL dump was created from production and its archive catalog was readable.
- The `public` application schema was restored to local PostgreSQL 18. Supabase-host-specific extensions were intentionally excluded from this portable restore test.
- Restored values matched the latest application capture for all 8 source tables: 84 customers, 87 projects, 90 contracts, 26 annual records, 96 maintenance responses, 221 periodic-maintenance records, 14 prospects, and 0 attachments.

## Migration rehearsal

The pinned 17 SQL files were applied to the isolated restore. The 8 source tables still matched before migration. A complete migration rehearsal then produced 31 billing units totaling 4,177,465 yen, including one direct-debit-failure-to-invoice occurrence, and accepted all 87 projects. The rehearsal transaction was rolled back. After rollback, all new ledger/event/acceptance tables had zero rows and all 8 source tables still matched the latest capture.

`productionCutoverReady` remains false only because production application/deployment authorization and the actual coordinated cutover have not occurred. It is no longer blocked by the staging access check, portable restore test, migration rehearsal, or near-term schedule classification.
