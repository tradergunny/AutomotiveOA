# ADR-002: Each Shop connects its own LINE Official Account

**Status:** Accepted — 2026-08-19

## Context

Customer updates are delivered via LINE. Either the platform owns one LINE OA that all garages send through, or each garage brings its own. A LINE OA's friends list is not portable: whichever account customers add is the account the relationship lives in. Garages care that customers see *their* brand.

## Decision

Each Shop creates and owns its own LINE OA and pays its own LINE message fees. The platform stores the Shop's channel credentials and sends through the Shop's OA via the Messaging API. Onboarding includes a "connect your LINE OA" step.

## Consequences

- Customers see the garage's brand; message quotas and billing are isolated per Shop; there is no shared messaging pipe for one misconfiguration to leak across tenants.
- Onboarding gains real friction: a non-technical garage owner must create an OA and hand over credentials — expect to assist manually during early sales. Credentials must be stored encrypted.
- This decision is practically irreversible once live: end customers have friended each garage's OA, and moving to a platform OA would require every car owner in every garage to re-add a new account.
