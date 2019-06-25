# balena-mdns-publisher

The MDNS publisher advertises a set of local IP addresses for a local network
(`<tld>.local`) instance of the balena-on-balena services (also known as the
Devenv, or resin On Premises (rOP) solution).

This allows any machine on the same subnet that is not more than one hop from
the publisher and b-o-b instance to automatically be able to resolve the
hostnames used for the instance (as long as the machine supports MDNS/DNS-SD,
also known as 'Bonjour').

## Prerequisites

The host machine running the balena-mdns-publisher service must be running
an instance of the [Avahi](https://www.avahi.org/) daemon, which this service
uses for address publishing.

Additionally, the service requires the ability to use `systemd` (ie. access to
host `cgroups` or relevant `tmpfs` mount), and the host DBUS socket.

## Installation and Running

This service can be run under a Linux environment, either any standard
distribution running docker, or a resinOS device. The two configurations require
separate setup, however. A `docker-compose` service is used here to show
how to configure the service, and each specific target.

### Generic Setup

Regardless of target, the service requires particular environment variables
and access to the host network. The following `docker-compose` snippet
shows the information required:

```
  balena-mdns-publisher:
    image: resin/balena-mdns-publisher
    network_mode: "host"
    cap_add:
        - SYS_RESOURCE
        - SYS_ADMIN
    security_opt:
        - 'apparmor:unconfined'
    tmpfs:
        - /run
        - /sys/fs/cgroup
    environment:
        CONFD_BACKEND: ENV
        # The name of the TLD to use. This *must* match certificates used for the rest of
        # the resin backend (eg. that for BALENA_ROOT_CA if present).
        MDNS_TLD: "resindev.local"
        # The list of subdomains to publish
        MDNS_SUBDOMAINS: [ "admin", "api" ]
        # The expectation is the DBus socket to use is always at the following location.
        DBUS_SESSION_BUS_ADDRESS: "unix:path=/host/run/dbus/system_bus_socket"
        # Selects the interface used for incoming connections from the wider subnet.
        # For NUCs, this is `enp0s3`. For RPis, it's `eth0`. If running natively, pick
        # the appropriate interface. You can remove this envvar to allow the service
        # to pick the default balena device Internet connected IP address.
        INTERFACE: "enp0s3"
        # API token to retrieve all device information. Usually the Proxy services API key.
        # Only required if device public URL access is rquired.
        MDNS_API_TOKEN: "proxyApiKey"
```

### Generic Linux Host

Additionally, for a generic Linux host running Avahi and Docker, the following
should be included in the service definition:

```
    volumes:
        - /run/dbus/system_bus_socket:/host/run/dbus/system_bus_socket
        - /sys/fs/cgroup:/sys/fs/cgroup:ro
```

This allows the acquisition of the underlying DBUS socket, as well as the ability
to run `systemd`.

### resinOS Device

For a resinOS device, the following should be included in the service
definition:

```
    #labels:
    #    io.resin.features.dbus: '1'
    #    io.balena.features.supervisor-api: '1'
    #tmpfs:
    #    - /run
    #    - /sys/fs/cgroup
    # environment:
    #    BALENA_ROOT_CA: "<base64CA>"
```

Again, this is required for access to the host DBUS socket and to allow the
execution of `systemd`.
