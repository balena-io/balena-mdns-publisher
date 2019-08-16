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
import { spawn } from 'child_process';
import * as _ from 'lodash';
import * as fs from 'mz/fs';

import { getFullHostnames, getHostAddress } from './utils';

/**
 * Creates the dnsmasq config from the subdomains.
 *
 * @param hosts		The subdomains to provide DNS for.
 * @param ipAddr	The IP address to point DNS records to.
 * @returns void promise.
 */
const configureDnsmasq = async (
	hosts: string[],
	ipAddr: string,
): Promise<void> => {
	// Write all the host entries to a new dnsmasq configuration
	let config = 'log-queries\n';

	_.map(hosts, host => {
		config += `address=/${host}/${ipAddr}\n`;
	});

	await fs.writeFile('/etc/dnsmasq.conf', config);
};

/**
 * Start the dnsmasq process in debug mode for DNS proxying.
 *
 * @returns Void promise.
 */
export async function startDnsProxy(): Promise<void> {
	// Configure the dnsmasq config
	// Get the list of hostnames to DNS proxy for
	const hosts = getFullHostnames();

	try {
		const ipAddr = await getHostAddress(process.env.INTERFACE);

		// For each address, publish the interface IP address.
		await configureDnsmasq(hosts, ipAddr);
	} catch (err) {
		console.log(`balena DNS proxier configuration error:\n${err}`);
	}

	// Start dnsmasq, log output to console
	try {
		const dnsmasq = spawn('/usr/sbin/dnsmasq', [
			'-d',
			'-x',
			'/run/dnsmasq.pid',
		]);

		dnsmasq.stdout.on('data', data => {
			console.log(`dnsmasq: ${data.toString()}`);
		});
		dnsmasq.stderr.on('data', data => {
			console.error(`dnsmasq: Error - ${data}`);
		});
		dnsmasq.on('close', code => {
			if (code !== 0) {
				console.log(`dnsmasq: process exited with code ${code}`);
			}
		});
	} catch (err) {
		console.log(`dnsmasq: Could not launch daemon - ${err}`);
	}
}
