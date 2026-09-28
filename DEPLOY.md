# FMS — wdrożenie i CI/CD (Netlify)

Aplikacja jest frontendowa (React + TypeScript + Vite). Build: `yarn build` → katalog `dist`.

## Automatyczny deploy z GitHuba (zalecane)

1. Wejdź na https://app.netlify.com → Add new site → Import an existing project.
2. Połącz GitHub i wybierz repo `fmspro869-commits/fms`.
3. Ustawienia (są już w `netlify.toml`, Netlify je odczyta):
   - Branch: `main`
   - Build command: `yarn build`
   - Publish directory: `dist`
   - Node: 22
4. Deploy site.

Od tej pory:
- push na `main` → produkcja
- pull request → Deploy Preview (osobny URL do testów)
- inny branch → Branch deploy (jeśli włączysz w Site settings → Build & deploy → Branches)

## GitHub Actions (opcjonalnie, obok integracji Netlify)

W repo są dwa workflow:
- `.github/workflows/ci.yml` — `yarn install --frozen-lockfile` + `yarn build` na PR i `main`
- `.github/workflows/netlify.yml` — deploy przez CLI, **tylko gdy** dodasz sekrety

Sekrety (Settings → Secrets and variables → Actions):
- `NETLIFY_AUTH_TOKEN` — User settings → Applications → Personal access tokens w Netlify
- `NETLIFY_SITE_ID` — Site settings → Site details → Site ID

Bez tych sekretów workflow Netlify się pomija; wystarczy integracja Git z panelu Netlify.

## Ręczny drop

Lokalnie: `yarn build` → wrzuć folder `dist` na https://app.netlify.com/drop
