# BEAT IT — Collision Engine v3

A high-end creative weapon for producers who refuse to sound like everyone else. Deep-black void, frosted-glass panels, lava-orange accents, and three beast modes.

## Three Modes

**01 · BEAT IT — The Collision Engine**
- Five heavy glass levers (Century / Scale / Grid / Kit / Subtract) that force dangerous musical collisions
- Giant **GENERATE COLLISION** button drops a cinematic result card: brutal beat name, instrument × genre collision, BPM, scale, meter, copy-ready Suno/Udio prompts, thesis text
- Sketch pad: 8-voice drum synth, 16-step sequencer, transport, BPM/swing, randomize
- Drop audio to strip vocals (center-channel karaoke with bass preservation)
- Live collision history sidebar

**02 · SOUND IT — Training Weapon**
- Interval ear-training game with streak/accuracy tracking
- Rhythm tap-back drill with live scoring
- Genre DNA dissection panel (BPM, percussion, production, things to avoid)
- Mastery progress bars and level system stored in browser

**03 · REC IT — Studio Mode**
- Live recording booth with glass waveform, meters, 48kHz/24bit readout
- Freestyle / Lyrics / Guided session modes
- Multi-track glass timeline stacking beat + vocal takes
- Cue list for flow structure, "send from BEAT IT" one-click routing
- Professional transport with timer, record arm, playback preview

## Design

- Deep #050506 void background with subtle SVG film grain
- Three ambient radial lights (lava-orange top-left, cyan top-right, warm bottom glow)
- Heavy frosted glass: 40px backdrop blur + saturate(180%), layered highlights and luminous 1px borders
- Accent: electric coral `#FF5C37` (primary), cold cyan `#5CE1E6` (precision)
- Typography: Inter 300–900 for UI, JetBrains Mono for all data/metrics

## Run

No build step, no dependencies. Open `index.html` or serve locally:

```bash
python3 -m http.server 8000
```
