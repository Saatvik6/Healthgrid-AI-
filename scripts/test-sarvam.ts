/* Live Sarvam check: transcribes the demo Hindi clip with Saaras and
   synthesizes a confirmation with Bulbul.
   Run: npx tsx --env-file=.env.local scripts/test-sarvam.ts [path/to/audio.wav] */
import { readFileSync, writeFileSync } from "fs";
import { SARVAM_STT_MODEL, SARVAM_TTS_MODEL, synthesize, transcribe } from "../lib/sarvam";

async function main() {
  const file = process.argv[2] ?? "docs/demo/hindi-line.wav";
  const t0 = Date.now();
  const stt = await transcribe({
    audio: readFileSync(file),
    mimeType: "audio/wav",
    languageCode: "hi-IN",
    keyterms: ["ORS Sachets", "Paracetamol 500mg", "Malaria RDT"],
  });
  console.log(`[${SARVAM_STT_MODEL}] ${Date.now() - t0}ms → "${stt.transcript}" (${stt.languageCode})`);

  const t1 = Date.now();
  const wav = await synthesize({ text: "ओआरएस सैशे: 50 बचे हैं", languageCode: "hi-IN" });
  const out = "sarvam-tts-check.wav";
  writeFileSync(out, Buffer.from(wav, "base64"));
  console.log(`[${SARVAM_TTS_MODEL}] ${Date.now() - t1}ms → wrote ${out}`);
}

main().catch((e) => {
  console.error("sarvam check failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
