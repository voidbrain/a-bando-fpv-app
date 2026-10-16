# ABandoFpvApp

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 22.2.2.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Deploying to GitHub Pages

This repository includes a GitHub Actions workflow
([`.github/workflows/deploy-gh-pages.yml`](.github/workflows/deploy-gh-pages.yml))
that builds the app and publishes it to GitHub Pages automatically on every
push to `main` (it can also be triggered manually from the **Actions** tab).

### One-time setup

1. In the repository, open **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.

No further configuration is required — the workflow uses the built-in
`GITHUB_TOKEN`, so no secrets are needed.

### How it works

- Runs `npm ci` and `npm run build` (production build, with
  `"baseHref": "/a-bando-fpv-app/"` set in `angular.json` so asset URLs
  resolve correctly under the project-page subpath).
- Adds a `.nojekyll` file so GitHub Pages does **not** process the bundle
  with Jekyll (without it, Pages renders the README instead of the app).
- Uploads `dist/a-bando-fpv-app/browser` as the Pages artifact.
- Deploys it with `actions/deploy-pages`.

The site will be available at `https://<username>.github.io/<repo>/`.

### Alternative: deploy from your machine

A `deploy` target backed by
[`angular-cli-ghpages`](https://github.com/angular/angular-cli-ghpages) is
already configured in `angular.json`. To use it locally:

```bash
npm i -D angular-cli-ghpages   # one-time install of the builder dependency
npx ng deploy --base-href /<repo-name>/
```

This pushes the production build to the `gh-pages` branch. Note that if you go
this route, set **Settings → Pages → Source** to the `gh-pages` branch instead
of GitHub Actions.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
