FROM resin/resin-base:v4.3.0

RUN apt-get update && \
    apt-get install -yq --no-install-recommends \
    libdbus-glib-1-dev \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Copies the package.json first for better cache on later pushes
COPY package.json package-lock.json /usr/src/app/

# Install the publisher
RUN JOBS=MAX npm ci --unsafe-perm --production && npm cache clean --force && rm -rf /tmp/*
COPY . /usr/src/app/

# Copy and enable the service
COPY config/services /etc/systemd/system
RUN systemctl enable balena-mdns-publisher.service
