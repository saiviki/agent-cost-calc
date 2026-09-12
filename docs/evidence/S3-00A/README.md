# S3-00A evidence — the auth hardening commit, not the S3-00 build

These artifacts belong to `dd483e4` (fail-closed shared-secret guard on both telemetry
endpoints), captured 2026-09-10 ~18:27, roughly two hours after the S3-00 build commit.

`red.out` is the red run for the AUTH fix: it was produced by stubbing
`requireTelemetrySecret` back to its pre-fix behaviour (return null, endpoint open) and
running `auth.test.ts`, which fails 5 of 6. It is NOT S3-00's red run.

**S3-00 itself has no red-run evidence.** The builder did not write failing tests before
implementing the store. Do not read anything in this directory as covering that gap.
