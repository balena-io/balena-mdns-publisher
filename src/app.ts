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
import * as Bluebird from 'bluebird';
import { Message, systemBus } from 'dbus-native';
import * as os from 'os';
import * as request from 'request-promise';

interface DeviceDetails {
	api_port: string;
	ip_address: string;
	os_version: string;
	supervisor_version: string;
	update_pending: boolean;
	update_failed: boolean;
	update_downloaded: boolean;
	commit: string;
	status: string;
	download_progress: string | null;
}

// Utilities for invoking DBus
const dbus = systemBus();
const dbusInvoker = (message: Message): PromiseLike<any> => {
	return Bluebird.fromCallback(cb => {
		return dbus.invoke(message, cb);
	});
};

// Retrieve the IPv4 address for the named interface,
const getNamedInterfaceAddr = (intf: string): string => {
	const nics = os.networkInterfaces()[intf];

	if (!nics) {
		throw new Error('The configured interface is not present, exiting');
	}

	// We need to look for the IPv4 address
	let ipv4Intf;
	for (const nic of nics) {
		if (nic.family === 'IPv4') {
			ipv4Intf = nic;
			break;
		}
	}

	if (!ipv4Intf) {
		throw new Error(
			'IPv4 version of configured interface is not present, exiting',
		);
	}

	return ipv4Intf.address;
};

// Retrieve the IPv4 address for the default balena internet-connected interface
const getDefaultInterfaceAddr = async (): Promise<string> => {
	let deviceDetails: DeviceDetails | null = null;

	// We continue to attempt to get the default IP address every 10 seconds,
	// inifinitely, as without our service the rest won't work.
	while (!deviceDetails) {
		try {
			deviceDetails = await request({
				uri: `${process.env.BALENA_SUPERVISOR_ADDRESS}/v1/device?apikey=${
					process.env.BALENA_SUPERVISOR_API_KEY
				}`,
				json: true,
				method: 'GET',
			}).promise();
		} catch (_err) {
			console.log('Could not acquire IP address from Supervisor, retrying in 10 seconds');
			await Bluebird.delay(10000);
		}
	}

	// Ensure that we only use the first returned IP address route. We don't want to broadcast
	// on multiple subnets.
	return deviceDetails.ip_address.split(' ')[0];
};

// Retrieve a new group for address publishing.
const getGroup = async (): Promise<string> => {
	return await dbusInvoker({
		destination: 'org.freedesktop.Avahi',
		path: '/',
		interface: 'org.freedesktop.Avahi.Server',
		member: 'EntryGroupNew',
	});
};

// Add a host address to the local domain.
const addHostAddress = async (
	hostname: string,
	address: string,
): Promise<void> => {
	// We require a new group for each address.
	// We don't catch errors, as our restart policy is to not restart.
	const group = await getGroup();

	await dbusInvoker({
		destination: 'org.freedesktop.Avahi',
		path: group,
		interface: 'org.freedesktop.Avahi.EntryGroup',
		member: 'AddAddress',
		body: [-1, -1, 0x10, hostname, address],
		signature: 'iiuss',
	});

	await dbusInvoker({
		destination: 'org.freedesktop.Avahi',
		path: group,
		interface: 'org.freedesktop.Avahi.EntryGroup',
		member: 'Commit',
	});
};

// Use the 'MDNS_SUBDOMAINS' envvar to collect the list of hosts to
// advertise
if (!process.env.MDNS_TLD || !process.env.MDNS_SUBDOMAINS) {
	throw new Error('MDNS_TLD and MDNS_SUBDOMAINS must be set.');
}
const tld = process.env.MDNS_TLD;
const MDNSHosts = JSON.parse(process.env.MDNS_SUBDOMAINS);

(async () => {
	try {
		// Get IP address for the specified interface, and the TLD to use.
		let ipAddr: string;
		if (process.env.INTERFACE) {
			ipAddr = getNamedInterfaceAddr(process.env.INTERFACE);
		} else {
			ipAddr = await getDefaultInterfaceAddr();
		}

		// For each address, publish the interface IP address.
		await Bluebird.map(MDNSHosts, host => {
			const fullHostname = `${host}.${tld}`;
			console.log(
				`Adding ${fullHostname} at address ${ipAddr} to local MDNS pool`,
			);
			return addHostAddress(fullHostname, ipAddr);
		});
	} catch (err) {
		console.log(`balena MDNS publisher error:\n${err}`);
		// This is not ideal. However, dbus-native does not correctly free connections
		// on event loop exit
		process.exit(1);
	}
})();
