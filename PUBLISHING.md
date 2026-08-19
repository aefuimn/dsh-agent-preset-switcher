# Publishing to the DSH Plugin Market (dshmarket)

`dshmarket` is the visual market app **inside DSH Web**. It does not host or store
plugins itself — its catalog is generated from the curated
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
registry. Publishing to the market therefore means: **open a PR that adds one
YAML file to that registry**.

## Status

This repository already meets the manifest requirement:

- `package.json` declares `dsh.bundle.patch` → `./cordis.patch.yml`
- `cordis.patch.yml` exists and inserts the plugin row
- compiled `lib/` is committed, so `dsh plugin add` works without a local build

## Step 1 — Make the repo pass the automatic checks

The registry CI enforces:

- the repo is at least **1 day old**
- the repo has **10 or more commits**
- the repo has the topic **`dsh-plugin`**
- a working `dsh.bundle` manifest (already done)

Currently this repo has **3 commits** (as of writing). Either wait until the
project naturally accumulates 10 commits, or improve the plugin in several
small commits before submitting.

Add the GitHub topic:

```bash
gh repo edit aefuimn/dsh-agent-preset-switcher --add-topic dsh-plugin
# or via GitHub web: repo → Settings → General → Topics → add "dsh-plugin"
```

## Step 2 — Fork / clone the registry

```bash
git clone https://github.com/awesome-dsh-plugin/awesome-dsh-plugin.git
cd awesome-dsh-plugin
git checkout -b add/dsh-agent-preset-switcher
```

## Step 3 — Add one YAML file

Create `data/plugins/aefuimn__dsh-agent-preset-switcher.yml`:

```yaml
url: https://github.com/aefuimn/dsh-agent-preset-switcher
name: aefuimn/dsh-agent-preset-switcher
category: session
description:
  en: Hot-switch agent presets (working modes) inside a running DSH session at the next step boundary.
  zh: 在 DSH 会话运行中热切换 agent preset（工作模式），在下一个 step 边界生效。
```

Notes from the registry contributing guide:

- the `url` must match the repository exactly;
- only `description.en` is required—`zh` is optional;
- quote the value if it contains `: ` (colon + space); our example does not,
  but keep it in mind;
- pick the category that matches what the plugin does. `session` fits
  "hot-switch working modes inside a running session"; if the maintainers
  prefer another category (e.g. `workflow`), they will adjust it.

## Step 4 — Regenerate the READMEs and commit

```bash
npm ci
node scripts/generate-readme.mjs
git add data/plugins/aefuimn__dsh-agent-preset-switcher.yml README.md README.zh.md
git commit -m "add dsh-agent-preset-switcher"
```

## Step 5 — Push and open the PR

```bash
git push -u origin add/dsh-agent-preset-switcher
# open https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/compare
```

The market picks the entry up automatically, usually within a day.

## Optional but recommended: publish to npm

When a registry entry sets `npm`, the market installs from the npm tarball
(seconds) instead of cloning the whole GitHub repo. To do that:

1. publish this package as `dsh-agent-preset-switcher` (or a scoped name):
   ```bash
   npm login
   npm publish --access public
   ```
2. add `npm: dsh-agent-preset-switcher` to the registry YAML:
   ```yaml
   npm: dsh-agent-preset-switcher
   ```

If you don't publish to npm, users can still install it from GitHub; the market
will use the `install` field generated from the URL.
