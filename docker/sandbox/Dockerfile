# Sandbox Container for Arduino Sketch Execution
# Minimal, secure environment for running compiled C++ code

FROM alpine:3.19

# Install only the minimal required packages
RUN apk add --no-cache \
    g++ \
    libstdc++ \
    && rm -rf /var/cache/apk/*

# Create non-root user for running sketches
RUN addgroup -S sandbox && adduser -S sandbox -G sandbox

# Create working directory
WORKDIR /sandbox

# Set restrictive permissions
RUN chown sandbox:sandbox /sandbox

# Switch to non-root user
USER sandbox

# Default command (will be overridden)
CMD ["echo", "Sandbox ready"]
