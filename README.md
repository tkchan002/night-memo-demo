# Night Memo — GitHub Pages + Supabase demo

This is a static GitHub Pages rewrite of the former Node.js / JSON Night Memo application. The ward workflow keeps the original six major sections while replacing the local Node server and JSON persistence with Supabase Authentication, PostgreSQL, Row Level Security and the Supabase Data API.

## Included demo wards

| Ward | Phone | Fax | Empty-bed gender mode | Initial beds |
|---|---:|---:|---|---:|
| C10 | 6397 | 3129 | Male | 40 |
| E10 | 9358 | 2921 | Male | 40 |
| G2 | 8072 | 4846 | Male | 36 |
| F10 | 8973 | 7432 | Male | 40 |
| E6 | 2372 | 9476 | Male | 36 |
| C6 | 5333 | 1137 | Male | 40 |
| G10 | 5834 | 1153 | Male | 40 |
| G11 | 6624 | 4882 | Dynamic | 40 |
| B10 | 4662 | 8510 | Male | 40 |
| H6 | 1075 | 2810 | Dynamic | 36 |

All phone/fax values are fictional four-digit demo values and are stored in the `wards` database table by `supabase/seed.sql`.

## Main pages

- `login.html` — three login choices: Ward Login, Patrol Night Login, Night Memo Maintenance.
- `ward.html` — ward-specific report entry, history, previous-data copy, ward staff database, travel/free-text nurse entry and printing.
- `manager.html` — opens directly to the nightly table, includes print, infection/device table and click-through to each full ward report.
- `maintenance.html` — wards and operating periods, effective-dated capacity changes, Supabase Auth account administration, staff, report-item configuration and audit log.

## Local demo mode

The project automatically uses an in-browser demo database while `config.js` still contains placeholder Supabase credentials.

Demo password: `demo`

- Ward accounts: `c10@nightmemo.local`, `e10@nightmemo.local`, `g2@nightmemo.local`, `f10@nightmemo.local`, `e6@nightmemo.local`, `c6@nightmemo.local`, `g10@nightmemo.local`, `g11@nightmemo.local`, `b10@nightmemo.local`, `h6@nightmemo.local`
- Manager: `patrolnight@nightmemo.local`
- Maintenance: `nightmaintenance@nightmemo.local`

The account entered on `login.html` is used exactly as entered as the Supabase Auth email/identifier. The application does **not** append a domain, convert a ward code, or perform any hidden account mapping.

The local demo is only for interface testing. It uses `localStorage` and is not a secure or shared database.

## Supabase setup — browser-only

1. Create a Supabase project.
2. In **SQL Editor**, run `supabase/schema.sql`.
3. Run `supabase/seed.sql`.
4. In **Authentication → Users**, create the ward, manager and maintenance users using the full accounts you want staff to type, for example `c10@nightmemo.local`. Mark the accounts confirmed when creating them administratively.
5. For each Auth user, copy its UUID and create the matching row in `user_access` using **Table Editor**. Put the same full Auth account in `login_id`. Ward accounts must also have the appropriate `ward_id`; manager and maintenance accounts leave `ward_id` blank.
6. In **Edge Functions**, create a function named `admin-users` using the Dashboard editor. Replace its contents with `supabase/functions/admin-users/index.ts` and deploy it. No extra login-domain secret is required.
7. Edit `config.js` and set `SUPABASE_URL` and the browser-safe Supabase **publishable key**. Never put a service-role/secret key in `config.js` or GitHub Pages.
8. Upload the static project files to GitHub and enable GitHub Pages from the repository settings.

`maintenance.html` also uses the full account directly. Creating or renaming an account sends exactly the entered value to Supabase Auth; no account transformation occurs.

## Shared ward accounts

Each ward account is mapped to exactly one `ward_id` in `user_access`. A C10 account can read/write C10 reports and C10 staff only. H6 sees H6 staff only. Managers can read all complete ward reports but cannot alter ward submissions. Maintenance accounts configure the system and, by default, do not have clinical report access.

## Empty-bed gender handling

Gender is used only for empty-bed information.

- `male` / `female`: the ward page calculates the empty-bed count without asking for a sex on every empty bed.
- `dynamic`: empty-bed detail rows allow the ward to mark each vacancy M/F for that night. The same physical bed can therefore be male on one night and female on another.

Infection and device bed numbers do not carry gender.

## Night nurse free text

Night nurse names use the ward's `ward_staff` records for autocomplete and automatic rank/appointment fill. The input is not restricted to the database, so a travel or temporary nurse can be typed directly. A free-text nurse is stored in that report only and is not silently added to the permanent ward staff list.

## Ward lifecycle and bed capacity

Ward existence and capacity are date-aware:

- `ward_operating_periods` allows seasonal wards to open and close without deleting history.
- `ward_capacity_history` keeps effective-dated capacity values, so changing beds next month does not rewrite historical empty-bed calculations.
- manager views determine which wards were operating on the selected report date, not which wards happen to be open today.

## Supabase Auth from maintenance.html

`maintenance.html` never receives the service-role key. Create user, rename login and password reset actions call `supabase/functions/admin-users/index.ts`, which verifies that the caller has the maintenance role and then performs the privileged Auth Admin operation server-side.

A maintenance user can also enable/disable application access. Disabling `user_access.active` blocks RLS access even if the Supabase Auth credential itself still exists.

## Migrating the old JSON database

An optional migration helper is included:

```bash
node scripts/migrate-memo-json.mjs /path/to/memo-data.json C5
```

Create/configure the target ward first. The script copies `history[]` into `ward_reports` and `staffDB[]` into `ward_staff`, while preserving the existing report payload shape as much as possible.

## Important deployment rule

Do not commit real patient data, exported reports, the old `memo-data.json`, `.env`, or a Supabase service-role/secret key to the GitHub repository. GitHub Pages should contain application code only; patient/report data belongs in Supabase behind Authentication and RLS.
