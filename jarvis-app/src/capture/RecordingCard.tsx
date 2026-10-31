import { useEffect, useRef, useState } from "react";
import { MAX_RECORD_SECONDS } from "../speech/wire";

// PROVE IT IS LISTENING (the speech box, 2026-10-31; the research, flow step 2: "animated waveform from a Web Audio analyser on
// the same getUserMedia stream, elapsed timer, the rotating example replaced by Listening, tap when done", and step 4: "show a
// Transcribing state within 100 ms of stop, with the waveform freezing, rather than dead air").
//
// No words are faked while recording: the clip is transcribed when it stops, so the card shows the voice's level and the time,
// then Writing It Down, then the words land in the box above, editable, and nothing is saved until his own tap.

const BARS = 24;

export default function RecordingCard({ stream, startedAt, writing, onStop }: {
  stream: MediaStream | null;
  startedAt: number | null;
  /** The clip is being turned into words: the bars freeze and the card says so. */
  writing: boolean;
  onStop: () => void;
}) {
  const bars = useRef<(HTMLSpanElement | null)[]>([]);
  const [now, setNow] = useState(() => Date.now());

  // The level meter: the analyser reads the same stream the recorder writes, and each bar is one band's loudness.
  useEffect(() => {
    if (!stream || writing) return;
    const Ctx = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    let ctx: AudioContext;
    try { ctx = new Ctx(); } catch { return; }
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 64;
    src.connect(an);
    const data = new Uint8Array(an.frequencyBinCount);
    let raf = 0;
    const draw = () => {
      an.getByteFrequencyData(data);
      for (let i = 0; i < BARS; i++) {
        const el = bars.current[i];
        if (!el) continue;
        const v = data[Math.min(data.length - 1, i + 1)] ?? 0;
        el.style.transform = `scaleY(${Math.max(0.12, v / 255)})`;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); try { src.disconnect(); void ctx.close(); } catch { /* already closed */ } };
  }, [stream, writing]);

  useEffect(() => {
    if (!startedAt || writing) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [startedAt, writing]);

  const secs = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
  const left = MAX_RECORD_SECONDS - secs;
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  return (
    <div className={"rec-card" + (writing ? " rec-writing" : "")} role="status" aria-live="polite">
      <div className="rec-wave" aria-hidden="true">
        {Array.from({ length: BARS }, (_, i) => <span key={i} ref={(el) => { bars.current[i] = el; }} className="rec-bar" />)}
      </div>
      <div className="rec-line">
        <span className="rec-state">{writing ? "Writing It Down" : "Listening"}</span>
        {!writing && startedAt && <span className="rec-clock">{left <= 10 ? `Stops in ${Math.max(0, left)}` : clock}</span>}
      </div>
      {!writing && <button type="button" className="btn btn-primary btn-block" onClick={onStop}>Done Talking</button>}
    </div>
  );
}
