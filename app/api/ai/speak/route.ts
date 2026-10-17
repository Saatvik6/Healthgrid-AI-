import { sarvamConfigured, sarvamLanguageCode, synthesize } from "@/lib/sarvam";
import { canReadBack } from "@/lib/speech-languages";

/** Text → speech with Sarvam Bulbul: reads the voice-update confirmation back
    to the worker in their language, so they can confirm without reading. */
export async function POST(req: Request) {
  const { text, lang } = (await req.json()) as { text?: string; lang?: string };
  if (!text?.trim()) return Response.json({ error: "text required" }, { status: 400 });
  if (text.length > 1500) return Response.json({ error: "text too long" }, { status: 413 });
  const languageCode = sarvamLanguageCode(lang);
  if (!canReadBack(languageCode)) return Response.json({ error: "no voice for this language" }, { status: 422 });
  if (!sarvamConfigured()) return Response.json({ error: "speech unavailable" }, { status: 503 });

  try {
    const audioBase64 = await synthesize({ text, languageCode });
    return Response.json({ audioBase64, mimeType: "audio/wav" });
  } catch (e) {
    console.error("speak error:", e instanceof Error ? e.message : e);
    return Response.json({ error: "speech unavailable" }, { status: 502 });
  }
}
