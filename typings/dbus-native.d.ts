declare module 'dbus-native' {
	export type BodyEntry = string | number | null;

	export interface Message {
		path: string;
		destination: string;
		member: string;
		interface: string;
		body?: BodyEntry[];
		signature?: string;
	}

	export interface Bus {
		invoke: (
			message: Message,
			callback: (error: Error, response: any) => void,
		) => void;
	}

	export function systemBus(): Bus;
}
