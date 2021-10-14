FROM balena/open-balena-base:v12.1.1 as base

RUN apt-get update && \
    apt-get install -yq --no-install-recommends \
    libdbus-glib-1-dev \
    avahi-utils \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Copies the package.json first for better cache on later pushes
COPY package.json package-lock.json /usr/src/app/

# Install the publisher
RUN JOBS=MAX npm ci --unsafe-perm --production && npm cache clean --force && rm -rf /tmp/*

# Copy and enable the service
COPY config/services /etc/systemd/system
RUN systemctl enable balena-mdns-publisher.service

# Build service
FROM base as build

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
