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
import * as BalenaSdk from 'balena-sdk';
import * as Bluebird from 'bluebird';
import { Message, systemBus } from 'dbus-native';
import * as _ from 'lodash';
import * as os from 'os';
import * as request from 'request-promise';

/**
 * Supervisor returned device details interface.
 */
interface HostDeviceDetails {
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

/**
 * Hosts published via Avahi.
 */
interface PublishedHosts {
	/** The Avahi group used to publish the host */
	group: string;
	/** The full hostname of the published host */
	hostname: string;
	/** The IP address of the published host */
	address: string;
}

/** List of published hosts */
const publishedHosts: PublishedHosts[] = [];
/** List of devices with accessible public URLs */
let accessibleDevices: BalenaSdk.Device[] = [];

/** DBus controller */
const dbus = systemBus();
/**
 * DBus invoker.
 *
 * @param message DBus message to send
 */
const dbusInvoker = (message: Message): PromiseLike<any> => {
	return Bluebird.fromCallback(cb => {
		return dbus.invoke(message, cb);
	});
};

/**
 * Retrieves the IPv4 address for the named interface.
 *
 * @param intf Name of interface to query
 */
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

/**
 * Retrieve the IPv4 address for the default balena internet-connected interface.
 */
const getDefaultInterfaceAddr = async (): Promise<string> => {
	let deviceDetails: HostDeviceDetails | null = null;

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
			console.log(
				'Could not acquire IP address from Supervisor, retrying in 10 seconds',
			);
			await Bluebird.delay(10000);
		}
	}

	// Ensure that we only use the first returned IP address route. We don't want to broadcast
	// on multiple subnets.
	return deviceDetails.ip_address.split(' ')[0];
};

/**
 * Retrieve a new Avahi group for address publishing.
 */
const getGroup = async (): Promise<string> => {
	return await dbusInvoker({
		destination: 'org.freedesktop.Avahi',
		path: '/',
		interface: 'org.freedesktop.Avahi.Server',
		member: 'EntryGroupNew',
	});
};

/**
 * Add a host address to the local domain.
 *
 * @param hostname Full hostname to publish
 * @param address  IP address for the hostname
 */
const addHostAddress = async (
	hostname: string,
	address: string,
): Promise<void> => {
	// If the hostname is already published with the same address, return
	if (_.find(publishedHosts, { hostname, address })) {
		return;
	}

	console.log(`Adding ${hostname} at address ${address} to local MDNS pool`);

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

	// Add to the published hosts list
	publishedHosts.push({
		group,
		hostname,
		address,
	});
};

/**
 * Remove hostname from published list
 *
 * @param hostname Hostname to remove from list
 */
const removeHostAddress = async (hostname: string): Promise<void> => {
	// If the hostname doesn't exist, we don't use it
	const hostDetails = _.find(publishedHosts, { hostname });
	if (!hostDetails) {
		return;
	}

	console.log(`Removing ${hostname} at address from local MDNS pool`);

	// Free the group, removing the published address
	await dbusInvoker({
		destination: 'org.freedesktop.Avahi',
		path: hostDetails.group,
		interface: 'org.freedesktop.Avahi.EntryGroup',
		member: 'Free',
	});

	// Remove from the published hosts list
	_.remove(publishedHosts, { hostname });
};

/**
 * Scan balena devices with accessible public URLs
 *
 * @param tld     TLD to use for URL publishing
 * @param address IP address to use for publishing
 */
const reapDevices = async (deviceTld: string, address: string) => {
	// Query the SDK using the Proxy service key for *all* current devices
	try {
		const devices = await balena.models.device.getAll();

		// Get list of all accessible devices
		const newAccessible = _.filter(devices, device => device.is_web_accessible);

		// Get all devices that are not in both lists
		const xorList = _.xorBy(accessibleDevices, newAccessible, 'uuid');

		// Get all new devices to be published and old to be unpublished
		const toUnpublish: BalenaSdk.Device[] = [];
		const toPublish = _.filter(xorList, device => {
			const filter = _.find(newAccessible, { uuid: device.uuid })
				? true
				: false;
			if (!filter) {
				toUnpublish.push(device);
			}
			return filter;
		});

		// Publish everything required
		for (const device of toPublish) {
			await addHostAddress(`${device.uuid}.devices.${deviceTld}`, address);
		}

		// Unpublish the rest
		for (const device of toUnpublish) {
			await removeHostAddress(`${device.uuid}.devices.${deviceTld}`);
		}

		accessibleDevices = newAccessible;
	} catch (err) {
		console.log(`Couldn't reap devices list: ${err}`);
	}
};

// Use the 'MDNS_SUBDOMAINS' envvar to collect the list of hosts to
// advertise
if (!process.env.MDNS_TLD || !process.env.MDNS_SUBDOMAINS) {
	throw new Error('MDNS_TLD and MDNS_SUBDOMAINS must be set.');
}
const tld = process.env.MDNS_TLD;
const MDNSHosts = JSON.parse(process.env.MDNS_SUBDOMAINS);
const balena = BalenaSdk({
	apiUrl: `https://api.${process.env.MDNS_TLD}/`,
});

(async () => {
	try {
		let ipAddr: string;
		// Get IP address for the specified interface, and the TLD to use.
		if (process.env.INTERFACE) {
			ipAddr = getNamedInterfaceAddr(process.env.INTERFACE);
		} else {
			ipAddr = await getDefaultInterfaceAddr();
		}

		// For each address, publish the interface IP address.
		await Bluebird.map(MDNSHosts, host => {
			const fullHostname = `${host}.${tld}`;

			return addHostAddress(fullHostname, ipAddr);
		});

		// Finally, login to the SDK and set a timerInterval every 20 seconds to update public URL addresses
		if (process.env.MDNS_API_TOKEN) {
			await balena.auth.loginWithToken(process.env.MDNS_API_TOKEN);
			setInterval(() => reapDevices(tld, ipAddr), 20 * 1000);
		}
	} catch (err) {
		console.log(`balena MDNS publisher error:\n${err}`);
		// This is not ideal. However, dbus-native does not correctly free connections
		// on event loop exit
		process.exit(1);
	}
})();
