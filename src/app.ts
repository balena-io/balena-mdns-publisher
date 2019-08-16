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
import { startDnsProxy } from './dns-proxy';
import { startMdnsPublisher } from './mdns-publisher';

const dnsProxy = process.env.PROXY_DNS;

(async () => {
	// If proxying DNS, start dnsmasq else start the MDNS publisher.
	// This will be killed on parent (this) exit if required
	if (dnsProxy && dnsProxy.toLowerCase() === 'true') {
		// Configure and run the DNS proxy
		await startDnsProxy();
	} else {
		await startMdnsPublisher();
	}
})();
