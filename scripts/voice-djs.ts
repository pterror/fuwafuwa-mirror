#!/usr/bin/env bun
/**
 * voice-djs.ts — discord voice listener with STT
 *
 * connects to a voice channel, receives opus audio, decodes to PCM,
 * converts to wav, and transcribes with whisper (when available).
 *
 * usage: bun scripts/voice-djs.ts [voice-channel-id] [guild-id]
 */

import { Client, GatewayIntentBits } from "discord.js";
import {
	joinVoiceChannel,
	VoiceConnectionStatus,
	entersState,
	EndBehaviorType,
	type AudioReceiveStream,
} from "@discordjs/voice";
import { spawn } from "node:child_process";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";

const prism = require("prism-media");

const TOKEN = process.env.DISCORD_TOKEN!;
const GUILD_ID = process.argv[3] || "1411109346594787480";
const CHANNEL_ID = process.argv[2] || "1411109348549066925";

if (!TOKEN) {
	console.error("DISCORD_TOKEN not set");
	process.exit(1);
}

const AUDIO_DIR = "/tmp/fuwafuwa-voice";
if (!existsSync(AUDIO_DIR)) mkdirSync(AUDIO_DIR, { recursive: true });

function log(...args: unknown[]) {
	const ts = new Date().toISOString().slice(11, 19);
	console.log(`[${ts}]`, ...args);
}

// track active subscriptions to avoid listener leaks
const activeSubscriptions = new Map<string, AudioReceiveStream>();

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildVoiceStates,
	],
});

client.once("ready", async () => {
	log(`logged in as ${client.user?.tag}`);

	const guild = client.guilds.cache.get(GUILD_ID);
	if (!guild) {
		log(`guild ${GUILD_ID} not found`);
		process.exit(1);
	}

	const channel = guild.channels.cache.get(CHANNEL_ID);
	if (!channel) {
		log(`channel ${CHANNEL_ID} not found`);
		process.exit(1);
	}

	log(`joining voice channel: ${channel.name} (${CHANNEL_ID})`);

	const connection = joinVoiceChannel({
		channelId: CHANNEL_ID,
		guildId: GUILD_ID,
		adapterCreator: guild.voiceAdapterCreator,
		selfDeaf: false,
		selfMute: true,
	});

	connection.on("stateChange", (oldState, newState) => {
		log(`connection: ${oldState.status} → ${newState.status}`);
	});

	connection.on("error", (error) => {
		log("connection error:", error.message);
	});

	try {
		await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
		log("=== connected and listening ===");
	} catch (error) {
		log("failed to connect:", error);
		connection.destroy();
		process.exit(1);
	}

	const receiver = connection.receiver;

	receiver.speaking.on("start", (userId) => {
		if (activeSubscriptions.has(userId)) return;

		const audioStream = receiver.subscribe(userId, {
			end: {
				behavior: EndBehaviorType.AfterSilence,
				duration: 1500,
			},
		});

		activeSubscriptions.set(userId, audioStream);

		// pipe opus stream → prism opus decoder → PCM buffer
		const decoder = new prism.opus.Decoder({
			rate: 48000,
			channels: 2,
			frameSize: 960,
		});

		const pcmChunks: Buffer[] = [];
		let packetCount = 0;

		audioStream.pipe(decoder);

		decoder.on("data", (chunk: Buffer) => {
			pcmChunks.push(Buffer.from(chunk));
			packetCount++;
		});

		decoder.on("end", () => {
			activeSubscriptions.delete(userId);

			if (packetCount < 10) return; // too short

			const pcmBuffer = Buffer.concat(pcmChunks);
			log(`captured ${userId}: ${packetCount} frames, ${(pcmBuffer.length / 1024).toFixed(1)}KB PCM`);
			saveAndTranscribe(pcmBuffer, userId);
		});

		decoder.on("error", (err: Error) => {
			activeSubscriptions.delete(userId);
			log(`decode error for ${userId}:`, err.message);
		});

		audioStream.on("error", (err: Error) => {
			activeSubscriptions.delete(userId);
			log(`stream error for ${userId}:`, err.message);
		});
	});

	log("waiting for voice activity...");
});

/**
 * Save PCM as WAV (16kHz mono for whisper) and attempt transcription.
 */
function saveAndTranscribe(pcmBuffer: Buffer, userId: string) {
	const timestamp = Date.now();
	const wavFile = `${AUDIO_DIR}/${userId}-${timestamp}.wav`;

	// use ffmpeg to convert 48kHz stereo PCM → 16kHz mono WAV
	const ffmpeg = spawn("ffmpeg", [
		"-f", "s16le",
		"-ar", "48000",
		"-ac", "2",
		"-i", "pipe:0",
		"-ar", "16000",
		"-ac", "1",
		"-y",
		wavFile,
	], { stdio: ["pipe", "pipe", "pipe"] });

	let stderr = "";
	ffmpeg.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

	ffmpeg.on("close", (code) => {
		if (code !== 0) {
			log(`ffmpeg failed for ${userId}:`, stderr.slice(-200));
			return;
		}
		log(`saved: ${wavFile}`);
		tryTranscribe(wavFile, userId);
	});

	ffmpeg.stdin.write(pcmBuffer);
	ffmpeg.stdin.end();
}

/**
 * Transcribe audio using Gemini API.
 */
async function tryTranscribe(wavFile: string, userId: string) {
	const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
	if (!apiKey) {
		log(`  [no GOOGLE_GENERATIVE_AI_API_KEY — audio saved at ${wavFile}]`);
		return;
	}

	try {
		const audioData = await Bun.file(wavFile).arrayBuffer();
		const base64Audio = Buffer.from(audioData).toString("base64");

		const response = await fetch(
			`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					contents: [{
						parts: [
							{
								inlineData: {
									mimeType: "audio/wav",
									data: base64Audio,
								},
							},
							{
								text: "Transcribe this audio exactly as spoken. Output only the transcription, nothing else. If the audio is silence or unintelligible, output [silence].",
							},
						],
					}],
				}),
			},
		);

		if (!response.ok) {
			log(`  gemini error ${response.status}: ${await response.text()}`);
			return;
		}

		const result = await response.json() as any;
		const text = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
		if (text && text !== "[silence]") {
			log(`  📝 ${userId}: "${text}"`);
		} else {
			log(`  [silence or unintelligible]`);
		}
	} catch (err: any) {
		log(`  transcription error:`, err.message);
	}
}

function cleanup() {
	log("shutting down...");
	client.destroy();
	process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

client.login(TOKEN);
