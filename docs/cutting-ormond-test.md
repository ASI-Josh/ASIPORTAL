# Ormond Plotter Smoke Test — Cutting Workflow Phase 0

This is the live-fire test for the HPGL output module on the Summa S One
D160 in Ormond. The library has been verified geometrically; this confirms
it produces a clean cut on the real plotter.

## Pre-flight

1. Plotter powered on, blade fitted, scrap roll loaded (any vinyl ≥ 100mm wide).
2. Plotter connected via Ethernet (preferred) or USB (fallback).
3. Sender machine: a laptop on the same network as the plotter, running the
   Summa control app or any HPGL-streaming utility.

## One-time admin setup

Sign in to the portal as an admin, then run the cutting seed once.
This creates Manu's invite and the default APEAX PPF/WPF profiles.

```bash
curl -X POST https://asiportal.live/api/admin/seed-cutting \
  -H "Authorization: Bearer $(firebase auth:print-access-token)"
```

Expected response (idempotent — safe to re-run):

```json
{
  "ok": true,
  "manu": { "status": "created", "inviteId": "..." },
  "profiles": [
    { "name": "APEAX PPF Standard", "status": "created", "id": "..." },
    { "name": "APEAX WPF Standard", "status": "created", "id": "..." }
  ]
}
```

After this, Manu signs in once at https://asiportal.live with his Google
account `monu@washd.com.au` — the invite redeems automatically and he
lands as an admin tagged `jvPartner: true, jvPartnerOrg: "Wash'd"`.

## Test 1 — Known-good geometry (rounded rectangle)

Smallest possible test — proves coordinates, force, speed, and the cut
path render correctly on the plotter.

1. In the portal: `/cutting` → **New Cutting Job**.
2. Set vehicle: `Test / Smoke / 2026 / TEST-001`.
3. Pattern source: `Custom`. Pattern reference: `Smoke test rectangle`.
4. Material profile: `APEAX PPF Standard`.
5. Save.
6. Save the test SVG below as `smoke-test.svg`:

   ```xml
   <?xml version="1.0" standalone="no"?>
   <svg xmlns="http://www.w3.org/2000/svg" width="60mm" height="40mm" viewBox="0 0 60 40">
     <rect x="0" y="0" width="60" height="40" rx="5" ry="5" fill="none" stroke="black" />
   </svg>
   ```

7. In the cutting job: **Upload pattern SVG** → pick `smoke-test.svg`.
8. Click **Generate & download .plt** — file `CUT-2026-####.plt` downloads.
9. Send the `.plt` to the plotter (Summa app, or `lpr -P plotter file.plt`).
10. Expected: 60mm × 40mm rounded rectangle (5mm corner radius) cut cleanly,
    one pass, on the loaded scrap. Total cut length ≈ 191.4mm.

**Pass criteria:**
- Geometry matches expected dimensions (±0.5mm on each axis).
- Corners are smooth, not faceted.
- Blade pressure looks right for the film — no over-cut into the liner,
  no missed sections.
- Plotter parks at origin and stops cleanly at end of job.

If geometry is wrong → check the material profile units (force in grams,
speed in mm/s). The library converts to plotter-native (cm/s for Summa)
internally. If facets show on corners → drop `flattenToleranceMm` from
0.1 to 0.05 in the API call (param: `flattenToleranceMm`).

## Test 2 — Real 3M Marketplace pattern

Once Test 1 is clean:

1. Download a pattern from 3M Pattern Marketplace as SVG (or convert from
   their native format using GoSign's SVG export).
2. Create a new cutting job in the portal — populate vehicle accurately.
3. Pattern source: `3M Pattern Marketplace`, paste the marketplace URL
   into Pattern URL.
4. Material profile: pick the right APEAX film.
5. Roll consumed (metres): leave blank — it auto-fills from the .plt
   estimated cut length when you generate.
6. Upload the SVG, generate .plt, send to plotter.
7. Cut, weed, install. Photograph before / in-progress / after — upload
   each into the cutting job.
8. When happy: **Mark QC pass + decrement stock.**
9. Verify in `/dashboard/procurement` → Stock Register that the linked
   APEAX SKU has dropped by the consumed metres.

## Verifying multi-tenant isolation

When Manu logs in:
- He should see `/cutting` in the sidebar.
- The list page shows only Wash'd-tagged cutting jobs (currently same
  tenant `asi`; once `tenantId: "washd"` is enforced for his account,
  he'll see his own).
- He can create cutting jobs but not edit ASI's existing ones.

To switch a tenant later, set `jvPartnerOrg: "washd"` on his User doc and
update the cutting routes' tenant resolution accordingly. The schema is
already in place — no migration required.

## Failure paths to watch

- **EPERM during portal build on Windows**: known cosmetic issue with
  `node_modules` file locks during page-data collection. Compile and
  type check still succeed. Restart the dev server if it persists.
- **`/cutting` page loads but list is empty**: confirm Firestore rules
  allow read on `cuttingJobs` for the calling user.
- **`.plt` generation fails with "SVG content required"**: SVG body
  shorter than 30 chars — usually means the file picker grabbed a
  thumbnail, not the source. Re-export from the marketplace.
- **Plotter cuts the wrong way up**: shouldn't happen — the emitter
  Y-flips. If it does, the SVG has a non-default coordinate transform
  that the parser doesn't see. Open it in Illustrator/Inkscape and
  re-save without transforms.
- **Stock decrement didn't run on QC pass**: the cutting job needs a
  `filmStockItemId` linking to a Stock Register doc and a positive
  `rollConsumedMetres`. Both are required.

## Commit

When the test passes cleanly on the Summa, send DIRECTOR (Josh) a
short note with the .plt file, a photo of the cut, and the cutting job
number. That closes Phase 0.
