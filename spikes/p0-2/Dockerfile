# Spike P0.2 – prototype compile sandbox image (not product code).
FROM debian:bookworm-slim
ARG DEBIAN_FRONTEND=noninteractive
COPY scripts/install-arduino-cli.sh scripts/arduino-avr-core-version scripts/check-arduino-avr-core-version.sh scripts/install-arduino-avr-core.sh /usr/local/bin/
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates tar xz-utils \
    && sh /usr/local/bin/install-arduino-cli.sh \
    && useradd -m -u 1000 compile \
    && su compile -c 'arduino-cli config init' \
    && su compile -c 'sh /usr/local/bin/install-arduino-avr-core.sh' \
    && apt-get purge -y curl && apt-get autoremove -y && apt-get clean && rm -rf /var/lib/apt/lists/*
USER compile
WORKDIR /home/compile
# Warm the core cache per FQBN. arduino-cli 1.5.1 archives cores under
# build_cache.path (default ~/.cache/arduino) only for builds without
# --build-path; the sketch part of that cache is dropped again.
COPY --chown=compile spikes/p0-2/warm /home/compile/warm
RUN for f in arduino:avr:uno arduino:avr:nano:cpu=atmega328 arduino:avr:mega:cpu=atmega2560; do \
      arduino-cli compile --fqbn "$f" /home/compile/warm >/dev/null || exit 1; \
    done && rm -rf /home/compile/warm /home/compile/.cache/arduino/sketches && ls /home/compile/.cache/arduino/cores
ENTRYPOINT ["arduino-cli"]
