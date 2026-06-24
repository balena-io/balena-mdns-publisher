FROM balena/open-balena-base:21.0.27-s6-overlay@sha256:4c2882a895c5c6af0f5f838b7afa722fe8cf75deb0558b6db60b52b40b7604cb AS base

# hadolint ignore=DL3008
RUN apt-get update && \
    apt-get install -yq --no-install-recommends \
    libdbus-glib-1-dev \
    avahi-utils \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Copies the package.json first for better cache on later pushes
COPY package.json package-lock.json /usr/src/app/

# Install the publisher
RUN JOBS=MAX npm ci --omit=dev && npm cache clean --force && rm -rf /tmp/*

# Build service
FROM base AS build

RUN JOBS=MAX npm ci

COPY . /usr/src/app/

RUN JOBS=MAX npm run build

# Final image
FROM base

# Copy built code
COPY --from=build /usr/src/app/build /usr/src/app/build
COPY --from=build /usr/src/app/bin /usr/src/app/bin
COPY --from=build /usr/src/app/config /usr/src/app/config
COPY --from=base /usr/src/app/node_modules /usr/src/app/node_modules

COPY docker-hc /usr/src/app/

COPY entry.sh /usr/src/app/
RUN chmod +x entry.sh

CMD [ "/usr/src/app/entry.sh" ]
