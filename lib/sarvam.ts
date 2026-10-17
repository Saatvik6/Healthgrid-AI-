// Sarvam AI — Indic speech recognition (Saaras) and speech synthesis (Bulbul).
// Server-only: the subscription key never reaches the browser.

import { AUTO_DETECT, canReadBack, speechLanguage } from "./speech-languages";

const BASE_URL = "https://api.sarvam.ai";

export const SARVAM_STT_MODEL = process.env.SARVAM_STT_MODEL || "saaras:v4";
export const SARVAM_TTS_MODEL = process.env.SARVAM_TTS_MODEL || "bulbul:v3";
// Unset → Sarvam's default voice for the model.
export const SARVAM_TTS_SPEAKER = process.env.SARVAM_TTS_SPEAKER || undefined;

export class SarvamUnavailable extends Error {}

export function sarvamConfigured(): boolean {
  return Boolean(process.env.SARVAM_API_KEY);
}

function apiKey(): string {
  const key = process.env.SARVAM_API_KEY;
  if (!key) throw new SarvamUnavailable("SARVAM_API_KEY not set");
  return key;
}

/** A Sarvam BCP-47 code ("ta-IN") or a worker UI language ("Hindi", "mr") →
    Sarvam BCP-47 code. Anything else lets Saaras auto-detect. */
export function sarvamLanguageCode(lang?: string): string {
  if (speechLanguage(lang)) return lang!;
  switch (lang?.toLowerCase()) {
    case "hindi":
    case "hi":
      return "hi-IN";
    case "marathi":
    case "mr":
      return "mr-IN";
    case "english":
    case "en":
      return "en-IN";
    default:
      return AUTO_DETECT;
  }
}

async function sarvamError(res: Response): Promise<SarvamUnavailable> {
  let detail = "";
  try {
    const body = (await res.json()) as { error?: { message?: string; code?: string } };
    detail = body.error?.code ?? body.error?.message ?? "";
  } catch {
    // non-JSON error body
  }
  return new SarvamUnavailable(`sarvam ${res.status}${detail ? ` ${detail}` : ""}`);
}

export interface SarvamTranscript {
  transcript: string;
  languageCode: string | null;
  requestId: string | null;
}

/** Speech → text with Saaras. `keyterms` biases recognition towards domain
    vocabulary (medicine names, test names) — saaras:v4 only. */
export async function transcribe(opts: {
  audio: Uint8Array;
  mimeType: string;
  languageCode: string;
  keyterms?: string[];
  timeoutMs?: number;
}): Promise<SarvamTranscript> {
  const form = new FormData();
  const ext = opts.mimeType.split("/")[1]?.split(";")[0] || "webm";
  form.append("file", new Blob([opts.audio as BlobPart], { type: opts.mimeType }), `update.${ext}`);
  form.append("model", SARVAM_STT_MODEL);
  form.append("language_code", opts.languageCode);
  if (opts.keyterms?.length && SARVAM_STT_MODEL.startsWith("saaras:v4")) {
    const terms = [...new Set(opts.keyterms.map((t) => t.trim().slice(0, 64)).filter(Boolean))].slice(0, 50);
    form.append("keyterms", JSON.stringify(terms));
  }

  const res = await fetch(`${BASE_URL}/speech-to-text`, {
    method: "POST",
    headers: { "api-subscription-key": apiKey() },
    body: form,
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
  });
  if (!res.ok) throw await sarvamError(res);

  const data = (await res.json()) as { transcript?: string; language_code?: string | null; request_id?: string | null };
  const transcript = data.transcript?.trim() ?? "";
  if (!transcript) throw new SarvamUnavailable("empty transcript");
  return { transcript, languageCode: data.language_code ?? null, requestId: data.request_id ?? null };
}

/** Text → speech with Bulbul. Returns base64 WAV. */
export async function synthesize(opts: { text: string; languageCode: string; timeoutMs?: number }): Promise<string> {
  if (!canReadBack(opts.languageCode)) throw new SarvamUnavailable(`no Bulbul voice for ${opts.languageCode}`);
  const body: Record<string, unknown> = {
    text: opts.text.slice(0, 1500),
    language_code: opts.languageCode,
    model: SARVAM_TTS_MODEL,
  };
  if (SARVAM_TTS_SPEAKER) body.speaker = SARVAM_TTS_SPEAKER;

  const res = await fetch(`${BASE_URL}/text-to-speech`, {
    method: "POST",
    headers: { "api-subscription-key": apiKey(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
  });
  if (!res.ok) throw await sarvamError(res);

  const data = (await res.json()) as { audios?: string[] };
  const audio = data.audios?.[0] ?? "";
  if (!audio) throw new SarvamUnavailable("empty audio");
  return audio;
}
