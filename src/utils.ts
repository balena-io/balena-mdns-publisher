/**
 * @license
 * Copyright (C) 2018-2019  Balena Ltd.
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
import * as Bluebird from 'bluebird';
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
 * Retrieve the IPv4 address for the default balena internet-connected interface.
 *
 * @returns IP adress for the first default balena interface.
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
 * Retrieves the IPv4 address for the named interface.
 *
 * @param intf Name of interface to query
 * @returns Full IP address of interface.
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
 * Retrieves the host IP address.
 *
 * @param namedInterface The name of the interface to query, if any.
 * @returns Address to be used for the host.
 */
export const getHostAddress = async (
	namedInterface: string | void,
): Promise<string> => {
	// Get IP address for the specified interface, and the TLD to use.
	if (namedInterface) {
		return getNamedInterfaceAddr(namedInterface);
	}

	return await getDefaultInterfaceAddr();
};

/**
 * Retrieves the full hostnames of all addresses to publish/proxy.
 *
 * @returns Array of full hostnames.
 */
export const getFullHostnames = (): string[] => {
	// Use the 'MDNS_SUBDOMAINS' envvar to collect the list of hosts to
	// proxy DNS for
	if (!process.env.MDNS_TLD || !process.env.MDNS_SUBDOMAINS) {
		throw new Error('MDNS_TLD and MDNS_SUBDOMAINS must be set.');
	}
	const tld = process.env.MDNS_TLD;
	const MDNSHosts = JSON.parse(process.env.MDNS_SUBDOMAINS);

	return _.map(MDNSHosts, host => `${host}.${tld}`);
};
