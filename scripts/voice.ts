#!/usr/bin/env bun
/**
 * voice.ts — minimal discord voice channel listener
 *
 * connects to discord gateway, joins a voice channel, receives audio via UDP.
 * proof of concept — no STT yet, just proves the connection works.
 *
 * usage: bun scripts/voice.ts <channel-id> [guild-id]
 */

const TOKEN = process.env.DISCORD_TOKEN!;
const GUILD_ID = process.argv[3] || "1411109346594787480"; // fluffy omelette diner
const CHANNEL_ID = process.argv[2];
const SELF_ID = "1480584089894391828"; // bot user id

if (!CHANNEL_ID) {
	console.error("usage: bun scripts/voice.ts <voice-channel-id> [guild-id]");
	process.exit(1);
}
if (!TOKEN) {
	console.error("DISCORD_TOKEN not set");
	process.exit(1);
}

const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";

// intents: GUILDS (1<<0) | GUILD_VOICE_STATES (1<<7)
const INTENTS = (1 << 0) | (1 << 7);

type VoiceServerInfo = {
	token: string;
	endpoint: string;
	guild_id: string;
};

type VoiceStateInfo = {
	session_id: string;
};

let gatewayWs: WebSocket;
let voiceWs: WebSocket | null = null;
let udpSocket: ReturnType<typeof Bun.udpSocket> extends Promise<infer T> ? T : never;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let voiceHeartbeatInterval: ReturnType<typeof setInterval> | null = null;
let lastSeq: number | null = null;
let voiceSeqAck = -1;

let voiceServerInfo: VoiceServerInfo | null = null;
let voiceStateInfo: VoiceStateInfo | null = null;

let secretKey: number[] | null = null;
let encryptionMode: string | null = null;
let ssrc: number | null = null;
let voiceUdpIp: string | null = null;
let voiceUdpPort: number | null = null;

// ssrc -> user mapping from speaking events
const ssrcToUser = new Map<number, string>();
// track received audio stats
let packetsReceived = 0;
let lastStatsTime = Date.now();

function log(...args: unknown[]) {
	const ts = new Date().toISOString().slice(11, 19);
	console.log(`[${ts}]`, ...args);
}

// --- main gateway ---

function connectGateway() {
	log("connecting to gateway...");
	gatewayWs = new WebSocket(GATEWAY_URL);

	gatewayWs.onopen = () => log("gateway connected");

	gatewayWs.onmessage = (event) => {
		const data = JSON.parse(event.data as string);
		handleGatewayMessage(data);
	};

	gatewayWs.onclose = (event) => {
		log(`gateway closed: ${event.code} ${event.reason}`);
		if (heartbeatInterval) clearInterval(heartbeatInterval);
		// could reconnect here, but for POC just exit
		cleanup();
	};

	gatewayWs.onerror = (event) => {
		log("gateway error:", event);
	};
}

function handleGatewayMessage(data: any) {
	const { op, t, s, d } = data;
	if (s !== null) lastSeq = s;

	switch (op) {
		case 10: // Hello
			startHeartbeat(d.heartbeat_interval);
			identify();
			break;
		case 11: // Heartbeat ACK
			break;
		case 0: // Dispatch
			handleDispatch(t, d);
			break;
		default:
			log(`gateway op ${op}:`, JSON.stringify(d).slice(0, 100));
	}
}

function startHeartbeat(interval: number) {
	log(`heartbeat interval: ${interval}ms`);
	// send first heartbeat after jitter
	setTimeout(() => {
		sendGateway({ op: 1, d: lastSeq });
	}, interval * Math.random());
	heartbeatInterval = setInterval(() => {
		sendGateway({ op: 1, d: lastSeq });
	}, interval);
}

function identify() {
	sendGateway({
		op: 2,
		d: {
			token: TOKEN,
			properties: { os: "linux", browser: "fuwafuwa", device: "fuwafuwa" },
			intents: INTENTS,
		},
	});
	log("identified");
}

function sendGateway(data: any) {
	gatewayWs.send(JSON.stringify(data));
}

function handleDispatch(type: string, data: any) {
	switch (type) {
		case "READY":
			log(`ready as ${data.user.username}#${data.user.discriminator}`);
			joinVoiceChannel();
			break;
		case "VOICE_STATE_UPDATE":
			if (data.user_id === SELF_ID) {
				voiceStateInfo = { session_id: data.session_id };
				log(`voice state update — session: ${data.session_id}`);
				tryConnectVoice();
			}
			break;
		case "VOICE_SERVER_UPDATE":
			voiceServerInfo = {
				token: data.token,
				endpoint: data.endpoint,
				guild_id: data.guild_id,
			};
			log(`voice server update — endpoint: ${data.endpoint}`);
			tryConnectVoice();
			break;
		default:
			// ignore other events
			break;
	}
}

function joinVoiceChannel() {
	log(`joining voice channel ${CHANNEL_ID}...`);
	sendGateway({
		op: 4,
		d: {
			guild_id: GUILD_ID,
			channel_id: CHANNEL_ID,
			self_mute: true, // we're listen-only
			self_deaf: false, // need to hear!
		},
	});
}

// --- voice gateway ---

function tryConnectVoice() {
	if (!voiceServerInfo || !voiceStateInfo) return;
	connectVoiceGateway();
}

function connectVoiceGateway() {
	const endpoint = voiceServerInfo!.endpoint;
	const url = `wss://${endpoint}?v=8`;
	log(`connecting to voice gateway: ${url}`);

	voiceWs = new WebSocket(url);

	voiceWs.onopen = () => log("voice gateway connected");

	voiceWs.onmessage = (event) => {
		const data = JSON.parse(event.data as string);
		handleVoiceMessage(data);
	};

	voiceWs.onclose = (event) => {
		log(`voice gateway closed: ${event.code} ${event.reason}`);
		if (voiceHeartbeatInterval) clearInterval(voiceHeartbeatInterval);
	};

	voiceWs.onerror = (event) => {
		log("voice gateway error:", event);
	};
}

function sendVoice(data: any) {
	voiceWs?.send(JSON.stringify(data));
}

function handleVoiceMessage(data: any) {
	const { op, d } = data;

	switch (op) {
		case 8: // Hello
			startVoiceHeartbeat(d.heartbeat_interval);
			voiceIdentify();
			break;
		case 6: // Heartbeat ACK
			break;
		case 2: // Ready
			ssrc = d.ssrc;
			voiceUdpIp = d.ip;
			voiceUdpPort = d.port;
			log(`voice ready — ssrc: ${ssrc}, udp: ${voiceUdpIp}:${voiceUdpPort}`);
			log(`encryption modes: ${d.modes.join(", ")}`);
			setupUdp();
			break;
		case 4: // Session Description
			secretKey = d.secret_key;
			encryptionMode = d.mode;
			log(`session description — mode: ${encryptionMode}, key length: ${secretKey?.length}`);
			log("=== voice connection established! listening for audio... ===");
			// start stats printer
			setInterval(printStats, 5000);
			break;
		case 5: // Speaking
			if (d.ssrc && d.user_id) {
				ssrcToUser.set(d.ssrc, d.user_id);
				log(`speaking: user ${d.user_id} → ssrc ${d.ssrc} (speaking: ${d.speaking})`);
			}
			break;
		case 13: // Client Connect (someone joined)
			log(`client connected: user ${d.user_id}`);
			break;
		case 18: // Client Disconnect
			log(`client disconnected: user ${d.user_id}`);
			break;
		default:
			log(`voice op ${op}:`, JSON.stringify(d).slice(0, 200));
	}
}

function startVoiceHeartbeat(interval: number) {
	log(`voice heartbeat interval: ${interval}ms`);
	const sendHeartbeat = () => {
		sendVoice({
			op: 3,
			d: { t: Date.now(), seq_ack: voiceSeqAck },
		});
	};
	setTimeout(sendHeartbeat, interval * Math.random());
	voiceHeartbeatInterval = setInterval(sendHeartbeat, interval);
}

function voiceIdentify() {
	sendVoice({
		op: 0,
		d: {
			server_id: voiceServerInfo!.guild_id,
			user_id: SELF_ID,
			session_id: voiceStateInfo!.session_id,
			token: voiceServerInfo!.token,
		},
	});
	log("voice identified");
}

// --- UDP ---

async function setupUdp() {
	log("setting up UDP socket...");

	const socket = await Bun.udpSocket({
		socket: {
			data(socket, buf, port, addr) {
				handleUdpPacket(buf);
			},
		},
	});

	udpSocket = socket as any;

	// IP Discovery
	const discoveryBuf = Buffer.alloc(74);
	discoveryBuf.writeUInt16BE(0x0001, 0); // type: request
	discoveryBuf.writeUInt16BE(70, 2); // length
	discoveryBuf.writeUInt32BE(ssrc!, 4); // ssrc
	// address and port fields are empty for request

	socket.send(discoveryBuf, voiceUdpPort!, voiceUdpIp!);
	log("sent IP discovery request");

	// wait a moment for discovery response, then select protocol
	// the response will come through handleUdpPacket
}

let ipDiscovered = false;

function handleUdpPacket(buf: Buffer) {
	if (!ipDiscovered) {
		// check if this is an IP discovery response
		const type = buf.readUInt16BE(0);
		if (type === 0x0002) {
			// IP discovery response
			const myIp = buf.slice(8, 72).toString("utf8").replace(/\0/g, "");
			const myPort = buf.readUInt16BE(72);
			log(`IP discovered: ${myIp}:${myPort}`);
			ipDiscovered = true;
			selectProtocol(myIp, myPort);
			return;
		}
	}

	// voice data packet
	packetsReceived++;

	// RTP header parsing
	if (buf.length >= 12) {
		const packetSsrc = buf.readUInt32BE(8);
		const seq = buf.readUInt16BE(2);
		const timestamp = buf.readUInt32BE(4);
		const user = ssrcToUser.get(packetSsrc);

		// only log first few packets per user to avoid spam
		if (packetsReceived <= 10 || packetsReceived % 500 === 0) {
			log(
				`audio packet #${packetsReceived}: ssrc=${packetSsrc}${user ? ` (${user})` : ""} seq=${seq} ts=${timestamp} size=${buf.length}`,
			);
		}
	}
}

function selectProtocol(externalIp: string, externalPort: number) {
	// prefer aead_aes256_gcm_rtpsize, fall back to aead_xchacha20_poly1305_rtpsize
	const preferredModes = [
		"aead_aes256_gcm_rtpsize",
		"aead_xchacha20_poly1305_rtpsize",
		"xsalsa20_poly1305_lite_rtpsize",
	];
	// we don't actually know the available modes here — picked in Ready handler
	// for now just use aead_xchacha20_poly1305_rtpsize as it's the required fallback
	const mode = "aead_xchacha20_poly1305_rtpsize";

	sendVoice({
		op: 1,
		d: {
			protocol: "udp",
			data: {
				address: externalIp,
				port: externalPort,
				mode,
			},
		},
	});
	log(`selected protocol: ${mode}`);
}

function printStats() {
	const now = Date.now();
	const elapsed = (now - lastStatsTime) / 1000;
	const rate = packetsReceived / elapsed;
	log(`stats: ${packetsReceived} packets total, ~${rate.toFixed(1)} pkt/s`);
}

// --- cleanup ---

function cleanup() {
	log("cleaning up...");
	if (heartbeatInterval) clearInterval(heartbeatInterval);
	if (voiceHeartbeatInterval) clearInterval(voiceHeartbeatInterval);

	// leave voice channel
	try {
		sendGateway({
			op: 4,
			d: { guild_id: GUILD_ID, channel_id: null, self_mute: false, self_deaf: false },
		});
	} catch {}

	try {
		voiceWs?.close();
	} catch {}
	try {
		gatewayWs?.close();
	} catch {}
	try {
		(udpSocket as any)?.close();
	} catch {}

	process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

// --- go ---
connectGateway();
