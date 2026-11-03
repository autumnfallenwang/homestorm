# 0008: The app is called homestorm

- **Status:** accepted
- **Date:** 2026-11-02

## Context

The name goes into the repo, images, Helm chart and hostname, so it had to be picked before any code. It should fit the
`home*` naming of the other apps, without sounding formal or being misleading.

## Decision

**homestorm**, as in brainstorming together.

## Alternatives considered

- **homecouncil:** too formal.
- **homepanel:** misleading.
- **homeroundtable:** fits the "seats and rounds" vocabulary, but long.
- **homehuddle, homeminds, homecircle, homeroom, hometable:** considered, not picked.

## Consequences

- **Names:** repo `autumnfallenwang/homestorm`; images `ghcr.io/autumnfallenwang/homestorm-*`; Helm chart and namespace
  `homestorm`.
- **Hostnames** (in the home DNS since 2026-11-02, both pointing at Traefik on 192.168.1.163): `homestorm.arch.internal`
  for the web app, `homestorm-api.arch.internal` for the API, the same two-host pattern as the sibling apps.
- **Mockup:** its app title says "Homestorm".
