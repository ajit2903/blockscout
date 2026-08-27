FROM builder-ui AS builder

ENV DISABLE_WEBAPP=false

ARG ADMIN_PANEL_ENABLED
ENV ADMIN_PANEL_ENABLED=${ADMIN_PANEL_ENABLED}

ARG DISABLE_API
ENV DISABLE_API=${DISABLE_API}

# Run backend compilation
RUN mix compile

RUN mkdir -p /opt/release && \
    mix release blockscout && \
    mv _build/${MIX_ENV}/rel/blockscout /opt/release
