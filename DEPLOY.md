# Publishing the Showroom

Same pattern as the APT Field App, which is live at `https://skyrom12.github.io/apt-field-app/`
and documented in the vault at `clients/american-pool-techs/07-web/field-app.md`:
a **public GitHub repo → GitHub Pages → CNAME on the client's domain**.

This app is simpler than APT's. There is no Apps Script backend, no API URL to keep in
sync, and no deployment versions to manage — it is static files that run entirely in the
browser. Push and it is live.

---

## Why it can't just go on Pages from this repo

`didm-baltz-web` is **private**, and GitHub Pages on a private repo needs a paid plan.
APT solved this with a separate public repo, and the same applies here. The app is also
better off standing alone: the Showroom should not go down because a theme deploy did.

---

## One time, about ten minutes

**1. Make the public repo.** On GitHub, new repo named `urban-concrete-showroom`, public,
no README. Under `skyrom12` (matching `skyrom12/apt-field-app`) or the DIDM org.

**2. Push this folder as the repo root.** From a clone of `didm-baltz-web`:

```
cd apps/urban-concrete-showroom
git init -b main
git remote add origin https://github.com/skyrom12/urban-concrete-showroom.git
git add -A
git commit -m "Urban Concrete Showroom"
git push -u origin main
```

The app folder becomes the repo root, so `index.html` sits at the top. Pages serves the
root by default and needs no configuration beyond step 3.

**3. Turn on Pages.** Repo → Settings → Pages → Source: *Deploy from a branch* →
Branch `main`, folder `/ (root)` → Save. A minute later it is live at:

```
https://skyrom12.github.io/urban-concrete-showroom/
```

That URL is shippable. Send it to Kevin, he taps Share → Add to Home Screen, and it
installs with the Baltz logo as its icon.

**4. Custom domain, when you want one.** At Baltz's DNS, CNAME
`showroom.baltzconcrete.com` → `skyrom12.github.io`. Then repo → Settings → Pages →
Custom domain → `showroom.baltzconcrete.com` → Save, and tick **Enforce HTTPS** once the
certificate is issued (can take up to an hour).

Pages writes a `CNAME` file into the repo when you save the custom domain. Leave it —
deleting it drops the domain.

---

## Shipping a change

```
git add -A && git commit -m "what changed" && git push
```

Live in about a minute. No deployment versions, no URL churn, nothing for anybody to
re-bookmark — the trap that the APT runbook warns about does not exist here.

**One caveat: the service worker caches the shell.** A returning phone may run the old
version once and pick up the new one on the next open. To force it immediately, bump
`VERSION` in `sw.js` (`ucs-v1` → `ucs-v2`) in the same push; that drops the old caches on
activate.

---

## Three things that must be right

- **HTTPS.** Geolocation and the service worker both refuse to run without it, and the
  whole product is distance. Pages gives you HTTPS free — just don't skip *Enforce HTTPS*
  after adding a custom domain.
- **The manifest's MIME type.** Pages serves `.webmanifest` correctly out of the box. On
  any other host, check it is `application/manifest+json` or the install prompt never
  appears.
- **Relative paths, which this app already uses.** Nothing references a leading `/`, and
  the manifest's `start_url` and `scope` are both `"."`. That is what lets it work at
  `/urban-concrete-showroom/` and at a bare domain without edits.

---

## Before Kevin sees it

The repo is public, so what ships is public. Check both:

1. **Clear the sample pins** once his real jobs are in — owner tools → *Remove the sample
   jobs*. Until then the "Sample" badges and the banner must stay, because the pin
   locations are approximate.
2. **Photos are in the repo.** The 40 in `img/` are already published on baltzconcrete.com,
   so they are fine. Anything Kevin adds later lives on his phone and never reaches the
   repo — but if we ever pre-load jobs for him, their photos would be public, and any job
   with the privacy switch off would publish a house number. Check that before pushing.

## Alternatives considered

| Option | Verdict |
|---|---|
| **GitHub Pages** | What APT uses, free, HTTPS included, one command to ship. Recommended. |
| WP Engine, alongside the site | The deploy pipeline only syncs `theme/**`, and there is no confirmed production install for baltzconcrete.com yet. Revisit once there is. |
| Cloudflare Pages / Netlify | Also fine and also free. Another vendor in the stack for no gain over Pages. |
