# Contributing to voice-form

Thank you for contributing. This document covers setup, the changeset workflow, and PR conventions.

---

## Setup

### Prerequisites

- Node >= 20 (use [nvm](https://github.com/nvm-sh/nvm): `nvm use`)
- pnpm >= 10 (`npm install -g pnpm`)

### First-time setup

```bash
# Clone the repo
git clone https://github.com/your-org/voice-form.git
cd voice-form

# Install the correct Node version (if using nvm)
nvm use

# Install all dependencies across all packages
pnpm install

# Verify everything builds
pnpm build

# Verify all tests pass
pnpm test
```

---

## Development workflow

### Running the demo

```bash
pnpm dev
# Opens http://localhost:5173
```

### Building packages

```bash
# Build all library packages (excludes demo)
pnpm build

# Build a single package
pnpm --filter @voiceform/core build
```

### Running tests

```bash
# Run all tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Run tests for a single package
pnpm --filter @voiceform/core test
```

### Linting and formatting

```bash
# Lint all packages
pnpm lint

# Format all files
pnpm format

# Check formatting without writing
pnpm format:check
```

### TypeScript type checks

```bash
# Typecheck all packages
pnpm -r typecheck
```

---

## Changeset workflow

This project uses [Changesets](https://github.com/changesets/changesets) to manage versioning and CHANGELOG generation.

### When to create a changeset

Create a changeset whenever your PR:

- Adds a new feature
- Fixes a bug that affects library consumers
- Makes a breaking change

You do NOT need a changeset for:

- Documentation-only changes
- Internal refactors that don't affect the public API
- Changes to the demo app
- Dev tooling changes (CI, linting, etc.)

### Creating a changeset

```bash
pnpm changeset
```

This launches an interactive prompt that asks:

1. Which packages are affected
2. Whether the change is `major`, `minor`, or `patch` (follows semver)
3. A summary of the change

A markdown file is created in `.changeset/`. Commit it alongside your code changes.

### Versioning and publishing (maintainers only)

```bash
# Apply all pending changesets: bumps versions and updates CHANGELOGs
pnpm changeset:version

# Publish all changed packages to npm
pnpm changeset:publish
```

---

## PR conventions

### Branch naming

```
feat/short-description
fix/short-description
chore/short-description
docs/short-description
```

### Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(core): add schema validation for select fields
fix(svelte): correct mic button focus trap
chore: upgrade tsup to 8.2.0
```

### PR checklist

Before marking a PR ready for review:

- [ ] `pnpm build` passes
- [ ] `pnpm lint` passes with no errors
- [ ] `pnpm -r typecheck` passes
- [ ] `pnpm test` passes
- [ ] A changeset is included (if the change affects published packages)
- [ ] New public API is documented with JSDoc

### Review SLA

- Maintainers aim to review PRs within 2 business days.
- Draft PRs are welcome for early feedback — mark them ready when the checklist above is complete.
