import * as BalenaSdk from 'balena-sdk';
import * as Bluebird from 'bluebird';
import { Message, systemBus } from 'dbus-native';
import * as _ from 'lodash';
import * as os from 'os';

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
	return Bluebird.fromCallback((cb) => {
		return dbus.invoke(message, cb);
	});
};

const getIPv4InterfaceInfo = (iface?: string): os.NetworkInterfaceInfo[] => {
	return Object.entries(os.networkInterfaces())
		.filter(([nic]) => !iface || nic === iface)
		.flatMap(([, ips]) => ips || [])
		.filter((ip) => !ip.internal && ip.family === 'IPv4');
};

const getIPv6InterfaceInfo = (iface?: string): os.NetworkInterfaceInfo[] => {
	return Object.entries(os.networkInterfaces())
		.filter(([nic]) => !iface || nic === iface)
		.flatMap(([, ips]) => ips || [])
		.filter((ip) => !ip.internal && ip.family === 'IPv6' && ip.scopeid === 0);
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
 * @param hostname	Full hostname to publish
 * @param addresses	IP address for the hostname
 */
const addHostAddress = async (
	hostname: string,
	addresses: string[],
): Promise<void> => {
	for (const address of addresses) {
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
	}
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
 * @param tld		TLD to use for URL publishing
 * @param addresses	IP addresses to use for publishing
 */
const reapDevices = async (addresses: string[], deviceTld?: string) => {
	for (const address of addresses) {
		// Query the SDK using the Proxy service key for *all* current devices
		try {
			const devices = await balena.models.device.getAll();

			// Get list of all accessible devices
			const newAccessible = _.filter(
				devices,
				(device) => device.is_web_accessible,
			);

			// Get all devices that are not in both lists
			const xorList = _.xorBy(accessibleDevices, newAccessible, 'uuid');

			// Get all new devices to be published and old to be unpublished
			const toUnpublish: BalenaSdk.Device[] = [];
			const toPublish = _.filter(xorList, (device) => {
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
				await addHostAddress(`${device.uuid}.devices.${deviceTld}`, [address]);
			}

			// Unpublish the rest
			for (const device of toUnpublish) {
				await removeHostAddress(`${device.uuid}.devices.${deviceTld}`);
			}

			accessibleDevices = newAccessible;
		} catch (err) {
			console.log(`Couldn't reap devices list: ${err}`);
		}
	}
};

// if running on balenaOS, insert device UUID
let tld = process.env.MDNS_TLD;
if (tld && process.env.BALENA_DEVICE_UUID) {
	tld = `${process.env.BALENA_DEVICE_UUID}.${process.env.MDNS_TLD}`;
}

const MDNSHosts = process.env.MDNS_SUBDOMAINS
	? process.env.MDNS_SUBDOMAINS.split(',')
	: [];

const balena = BalenaSdk({
	apiUrl: `https://${process.env.API_HOST}/`,
});

(async () => {
	try {
		// get the first non-link local IP for each address family
		const ipAddrs = _.compact([
			getIPv4InterfaceInfo(process.env.INTERFACE)[0],
			getIPv6InterfaceInfo(process.env.INTERFACE)[0],
		]).flatMap((ip) => ip.address);

		// For each address, publish the interface IP address.
		if (tld) {
			await Bluebird.map(MDNSHosts, (host) => {
				const fullHostname = `${host}.${tld}`;

				return addHostAddress(fullHostname, ipAddrs);
			});
		}

		// Finally, login to the SDK and set a timerInterval every 20 seconds to update
		// public URL addresses
		if (process.env.MDNS_API_TOKEN && tld) {
			await balena.auth.loginWithToken(process.env.MDNS_API_TOKEN);
			setInterval(() => reapDevices(ipAddrs, tld), 20 * 1000);
		}
	} catch (err) {
		console.log(`balena MDNS publisher error:\n${err}`);
		// This is not ideal. However, dbus-native does not correctly free connections
		// on event loop exit
		process.exit(1);
	}
})();
