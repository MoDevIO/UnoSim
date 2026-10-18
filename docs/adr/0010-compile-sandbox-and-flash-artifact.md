# ADR 0010: Compile sandbox and delivery of the flash image

- Status: Proposed
- Date: 2026-10-18
- Owners: UnoSim maintainers and platform operators
- Plan: [browser-emulation-plan.md](../proposals/browser-emulation-plan.md)
  (decisions E6, E15)
- Related: [ADR 0009](0009-browser-emulation-runtime.md),
  [SECURITY.md](../SECURITY.md) "Compile boundary",
  [open points](../OPEN_POINTS.md) S1-ASM

> Draft. The compile-sandbox decision depends on spike P0.2 (overhead and
> isolation) and is accepted only after its report and by the maintainers.

## Context

`POST /api/compile` runs `arduino-cli` inside the backend container without a
sandbox. Inline-assembler directives (`.incbin`, `.include`) can embed any
file the backend may read. Today the compiled HEX therefore never leaves the
server, and the include filter only keeps file contents out of diagnostics.
Browser emulation (ADR 0009) needs that image in the browser; an image built
in the backend could contain backend files or other users' sketches from
temporary and cache directories.

The HEX cache finds a build by a sketch hash of code, FQBN, entry file and
headers. Core version, `arduino-cli` version and libraries are not part of it,
and `storage/` survives deployments. Once the image drives runtime behavior, a
toolchain change must not serve an old build.

## Decision

1. **Compile sandbox (E6).** In the Docker profile `arduino-cli` runs in a
   short-lived compile container: network disabled, read-only root
   filesystem, only the submitted project visible and read-only, build in a
   bounded tmpfs, CPU, memory, PID and time limits, output limit 8 MiB as
   today, no Docker socket, and the owner label of the existing sweep. The
   include filter stays as an additional layer. *Overhead and isolation
   pending spike P0.2; if the overhead criterion fails, a pool of warm
   containers that are cleaned per job is evaluated.*
2. **Delivery gate.** The Docker profile returns `artifact` only when the
   compile sandbox is configured and ready; a startup check refuses the
   `browser` backend otherwise. The local profile, intended for one trusted
   developer, keeps compiling directly and may return `artifact`. A `binary`
   field is never returned.
3. **Build identity (E15).** The key of the compile cache, the artifact
   sidecar and the route's in-memory result cache, and the metadata checked on
   a hit, cover: source (code, headers, entry file), board with full FQBN and
   options, `arduino-cli` version, ID and version of every involved core,
   libraries with version, build options and the artifact format version. If
   any part differs, the sketch is rebuilt.
4. **Content addressing.** An artifact is addressed by its build identity. A
   cache hit is only possible for someone who submits the same source for the
   same board and therefore learns nothing new.

## Consequences

- S1-ASM is resolved for the Docker profile once the sandbox is implemented
  (plan package P2.4); OPEN_POINTS changes S1-ASM to decided when this ADR is
  accepted.
- Each compile in the Docker profile starts a container; core caches in the
  image and cache hits for unchanged examples keep the start of a lesson
  bounded. Capacity calibration gains a compile scenario.
- A second image (`Dockerfile.compile-sandbox`) has to be built, pinned and
  checked for leaks like the runtime sandbox; `arduino-cli` leaves the backend
  image after the sandbox is in place.
- Existing cache entries without a sidecar or with different metadata are
  rebuilt once; rolling back to V1 needs no change to `storage/` because V2
  only adds keys.
