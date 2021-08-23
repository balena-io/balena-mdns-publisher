# balena-mdns-publisher

The MDNS publisher advertises a set of local IP addresses for a local network
(`<tld>.local`) instance of the balena-on-balena (BoB) or OpenBalena (OB) services. The
same IP address is used for all services in the BoB or OB instance.

This allows any machine on the same subnet that is not more than one hop from the
publisher and BoB/OB instance to automatically be able to resolve the hostnames used for
the instance (as long as the machine supports mDNS/DNS-SD, also known as 'ZeroConf'
networking).


## Prerequisites

The host machine running the publisher service must be running an instance of the
[Avahi](https://www.avahi.org/) daemon, which this service uses for address publishing.

Additionally, the service requires the ability to use `systemd` (ie. access to host
`cgroups` or relevant `tmpfs` mount), and the host DBUS socket.


## Installation and Running

This service can be run under a Linux environment, either any standard distribution
running docker, or a resinOS device. The two configurations require separate setup,
however. A `docker-compose` service is used here to show how to configure the service, and
each specific target.


### Docker Setup

Regardless of target, the service requires particular environment variables and access to
the host network. The following `docker-compose` snippet shows the requirements for
running the service:

    balena-mdns-publisher:
        image: 'balena/balena-mdns-publisher:master'
        network_mode: host
        cap_add:
            - SYS_RESOURCE
            - SYS_ADMIN
        security_opt:
            - 'apparmor:unconfined'
        tmpfs:
            - /run
            - /sys/fs/cgroup
        environment:
            <See 'Environment Variables' section>


#### Generic Linux Host

Additionally, for a generic Linux host running Avahi and Docker, the following should be
included in the service definition to expose the DBUS socket to the correct place inside
the service container:

    volumes:
        - /run/dbus/system_bus_socket:/host/run/dbus/system_bus_socket

Alternatively you may change the in-container location of the DBUS socket, but you
*must* set `DBUS_SYSTEM_BUS_ADDRESS` envvar to the same location value.


#### balenaOS Device

Should the target be a balenaOS device, then the following section should also be included
to ensure that the Supervisor correctly exposes the relevant information to the service:

	 labels:
		io.balena.features.dbus: '1'


### Environment Variables

The mDNS publisher requires some additional environment variables be passed to it on
execution to allow it to function correctly. These are

* `CONFD_BACKEND` - This should always be set to `ENV`
* `MDNS_TLD` - This is the full Top Level Domain of the host being published
* `MDNS_SUBDOMAINS` - An array of subdomains to publish host addresses for
* `INTERFACE` - The name of the host network interface to publish the subdomain addresses
  too. Under balenaOS, if this is not set, the Supervisor API will be used to determine
  the interface to use, and therefore is not required. If this *is* set, it will override
  the returned default interface
* ⚠️ `DBUS_SYSTEM_BUS_ADDRESS` (optional) - For generic Linux hosts this must always be set
  to the location of the system socket (e.g. `unix:path=/var/run/dbus/system_bus_socket`)
  and must be **unset** for balenaOS devices to prevent collisions with `systemd` running
  on the host OS
* `MDNS_API_TOKEN` (optional) - Should Public URL exposure be required, then the shared
  API token for the Proxy service should be set using this key. The API will be queried
  every 20 seconds, and any new device with an exposed public URL will have its UUID
  published as a subdomain. Previously published UUIDs that no longer have a public URL
  will be deleted
* `BALENA_ROOT_CA` (optional) - Should the certificate chain used for the BoB/OB instance
  be via a self-signed CA, this value should be a Base64 encoded version of the CA's PEM
  certificate

This allows the acquisition of the underlying DBUS socket, as well as the ability to run
`systemd`.


## Example `docker-compose` Service

The following is an example of adding the balena mDNS publisher to a BoB instance running
under balenaOS:

    balena-mdns-publisher:
        image: 'balena/balena-mdns-publisher:master'
        network_mode: host
        cap_add:
            - SYS_RESOURCE
            - SYS_ADMIN
        security_opt:
            - 'apparmor:unconfined'
        tmpfs:
            - /run
            - /sys/fs/cgroup
        labels:
            io.balena.features.dbus: '1'
        environment:
            CONFD_BACKEND: ENV
            MDNS_TLD: my.bob.local
            MDNS_SUBDOMAINS: >-
                ["admin", "api", ...]
            MDNS_API_TOKEN: 1234567890abcdef
            BALENA_ROOT_CA: >-
                1234567890abcdef
