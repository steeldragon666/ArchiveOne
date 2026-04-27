# @cpa/mobile — CPA Scribe (Expo SDK 51)

The mobile app that R&D claimants and their employees use to capture
project events, voice notes, photos, and signed time entries on the go.

Bootstrapped under P3 Foundation (F10-F17). Functional swimlanes wire up
the API, UI screens, and end-to-end flows in subsequent waves.

## Setup

From the monorepo root:

```bash
pnpm install
pnpm --filter @cpa/mobile start
```

For an iOS simulator build:

```bash
pnpm --filter @cpa/mobile ios
```

Android emulator:

```bash
pnpm --filter @cpa/mobile android
```

## Workspace integration

Metro is configured (`metro.config.js`) to watch the monorepo root and
resolve modules from both `apps/mobile/node_modules` and the root
`node_modules`. `disableHierarchicalLookup` is on so pnpm's flat-ish
hoisting doesn't confuse the resolver.

## Auth + storage

- Refresh token persisted via `expo-secure-store` (Keychain / Keystore).
- Offline event queue + media-blob cache live in `expo-sqlite` under
  `cpa-scribe.db`. Schema + migrations in `src/db/`.

## Env

- `EXPO_PUBLIC_API_URL` — overrides the API base URL. Defaults to
  `app.json.expo.extra.apiUrl` (`https://platform.com.au` in prod).

## Commands

| Script         | Purpose                              |
| -------------- | ------------------------------------ |
| `start`        | Expo dev server (any platform)       |
| `ios`          | Open iOS simulator                   |
| `android`      | Open Android emulator                |
| `web`          | Open browser preview (dev only)      |
| `build`        | `expo export` — static export        |
| `typecheck`    | `tsc --noEmit`                       |
| `lint`         | ESLint over `app/` and `src/`        |
| `test`         | tsx-based unit tests                 |

A fuller README (release flow, EAS profiles, Detox runbook) lands in
T7 of the mobile plan.
