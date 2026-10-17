import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SarvamUnavailable, sarvamConfigured, sarvamLanguageCode, synthesize, transcribe } from "./sarvam";

const audio = new Uint8Array([1, 2, 3]);

describe("sarvam", () => {
  beforeEach(() => vi.stubEnv("SARVAM_API_KEY", "test-key"));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("maps worker languages to Sarvam codes", () => {
    expect(sarvamLanguageCode("Hindi")).toBe("hi-IN");
    expect(sarvamLanguageCode("Marathi")).toBe("mr-IN");
    expect(sarvamLanguageCode("en")).toBe("en-IN");
    expect(sarvamLanguageCode(undefined)).toBe("unknown");
    expect(sarvamLanguageCode("ta-IN")).toBe("ta-IN");
    expect(sarvamLanguageCode("sat-IN")).toBe("sat-IN");
    expect(sarvamLanguageCode("xx-IN")).toBe("unknown");
  });

  it("is unconfigured without a key and never calls the API", async () => {
    vi.stubEnv("SARVAM_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(sarvamConfigured()).toBe(false);
    await expect(transcribe({ audio, mimeType: "audio/webm", languageCode: "hi-IN" })).rejects.toBeInstanceOf(SarvamUnavailable);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends audio, language and deduped keyterms; returns the transcript", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ request_id: "r1", transcript: " आज ओआरएस 50 बचा है ", language_code: "hi-IN" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const out = await transcribe({ audio, mimeType: "audio/webm", languageCode: "hi-IN", keyterms: ["ORS Sachets", "ORS Sachets", "Malaria RDT"] });

    expect(out).toEqual({ transcript: "आज ओआरएस 50 बचा है", languageCode: "hi-IN", requestId: "r1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.sarvam.ai/speech-to-text");
    expect(init.headers["api-subscription-key"]).toBe("test-key");
    const form = init.body as FormData;
    expect(form.get("language_code")).toBe("hi-IN");
    expect(form.get("model")).toBe("saaras:v4");
    expect(JSON.parse(form.get("keyterms") as string)).toEqual(["ORS Sachets", "Malaria RDT"]);
    expect(form.get("file")).toBeInstanceOf(Blob);
  });

  it("treats an empty transcript as unavailable so the route falls back", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ transcript: "" }), { status: 200 })));
    await expect(transcribe({ audio, mimeType: "audio/webm", languageCode: "hi-IN" })).rejects.toBeInstanceOf(SarvamUnavailable);
  });

  it("normalizes provider errors without leaking the key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "insufficient_quota_error", message: "quota" } }), { status: 429 })),
    );
    const err = await transcribe({ audio, mimeType: "audio/webm", languageCode: "hi-IN" }).catch((e) => e);
    expect(err).toBeInstanceOf(SarvamUnavailable);
    expect(err.message).toBe("sarvam 429 insufficient_quota_error");
    expect(err.message).not.toContain("test-key");
  });

  it("synthesizes speech and returns the first audio clip", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ audios: ["UklGRg=="] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(synthesize({ text: "ORS: 50", languageCode: "ta-IN" })).resolves.toBe("UklGRg==");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ text: "ORS: 50", language_code: "ta-IN", model: "bulbul:v3" });
  });

  it("refuses read-back in languages Bulbul cannot speak, without calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const languageCode of ["ur-IN", "unknown"]) {
      await expect(synthesize({ text: "x", languageCode })).rejects.toBeInstanceOf(SarvamUnavailable);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
