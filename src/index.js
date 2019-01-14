/*
 *  Copyright 2018 Resinio Ltd.
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

// The following should be rewritten in TypeScript, ideally.
const Promise = require('bluebird');
const os = require('os');
const dbus = require('dbus-native');
const bus = Promise.promisifyAll(dbus.systemBus());

// This is an exhaustive list of the hosts required to run that backend that
// require advertisement to the local network
const MDNSHosts = [
    'admin',
    'api',
    'builder',
    'dashboard',
    'devices',
    'terminal.devices',
    'db',
    'git',
    'resin-image-maker.img',
    'img',
    'redis',
    'registry',
    'registry2',
    'resin-image-maker.s3',
    's3',
    'sentry',
    'ui',
    'vpn',
];

// Retrieve the IPv4 address for the named interface,
const getNamedInterfaceAddr = (intf) => {
    const interface = os.networkInterfaces()[intf];

    if (!interface) {
        throw new Error('The configured interface is not present, exiting');
    }

    // We need to look for the IPv4 address
    let ipv4Intf;
    for (let index = 0; index < interface.length; index++) {
        if (interface[index].family === 'IPv4') {
            ipv4Intf = interface[index];
            break;
        }
    }

    if (!ipv4Intf) {
        throw new Error('IPv4 version of configured interface is not present, exiting');
    }

    return ipv4Intf.address;
};

// Retrieve a new group for address publishing.
const getGroup = () => {
    return bus.invokeAsync({
        destination: 'org.freedesktop.Avahi',
        path: '/',
        interface: 'org.freedesktop.Avahi.Server',
        member: 'EntryGroupNew'
    });
};

// Add a host address to the local domain.
const addHostAddress = (hostname, address) => {
    let group;

    // We require a new group for each address.
    // We don't catch errors, as our restart policy is to not restart.
    return getGroup()
    .then((entryGroup) => {
        group = entryGroup;
        return bus.invokeAsync({
            destination: 'org.freedesktop.Avahi',
            path: group,
            interface: 'org.freedesktop.Avahi.EntryGroup',
            member: 'AddAddress',
            body: [ -1, -1, 0x10, hostname, address ],
            signature: 'iiuss'
        });
    }).then(() => {
        return bus.invokeAsync({
            destination: 'org.freedesktop.Avahi',
            path: group,
            interface: 'org.freedesktop.Avahi.EntryGroup',
            member: 'Commit'
        });
    });
};


// Get IP address for the specified interface, and the TLD to use.
const ipAddr = getNamedInterfaceAddr(process.env.INTERFACE);
const tld = process.env.MDNS_TLD;

// For each address, publish the interface IP address.
Promise.map(MDNSHosts, (host) => {
    const fullHostname = `${host}.${tld}`;
    console.log(`Adding ${fullHostname} at address ${ipAddr} to local MDNS pool`);
    return addHostAddress(fullHostname, ipAddr)
});
