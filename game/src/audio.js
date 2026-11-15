// Sound, synthesised: no audio files, no network. WebAudio oscillators and
// filtered noise, built lazily on the first user gesture (browsers block
// audio before one). Every sound is a few nodes, created and dropped per shot.
export function createAudio() {
  let ctx = null;
  let master = null;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.32;
      master.connect(ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  function noiseBuffer(seconds) {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function burst({ type = 'noise', freq = 800, freqEnd = 100, dur = 0.12, gain = 0.5, filterFreq = 3000, when = 0 }) {
    if (!ensure()) return;
    const t0 = ctx.currentTime + when;
    const out = ctx.createGain();
    out.gain.setValueAtTime(gain, t0);
    out.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    out.connect(master);
    if (type === 'noise') {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(dur + 0.05);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = filterFreq;
      src.connect(filter);
      filter.connect(out);
      src.start(t0);
      src.stop(t0 + dur + 0.05);
    } else {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
      osc.connect(out);
      osc.start(t0);
      osc.stop(t0 + dur);
    }
  }

  return {
    unlock() {
      ensure();
      if (ctx && ctx.state === 'suspended') ctx.resume();
    },
    shot(kind, dist = 0) {
      const volume = kind === 'player' ? 0.6 : Math.max(0.08, 0.4 - dist * 0.008);
      burst({ type: 'noise', dur: 0.09, gain: volume, filterFreq: 2600 });
      burst({ type: 'square', freq: 160, freqEnd: 60, dur: 0.07, gain: volume * 0.5 });
    },
    dryFire() {
      burst({ type: 'square', freq: 900, freqEnd: 700, dur: 0.03, gain: 0.15 });
    },
    reload() {
      burst({ type: 'square', freq: 500, freqEnd: 300, dur: 0.04, gain: 0.12 });
      burst({ type: 'square', freq: 380, freqEnd: 240, dur: 0.04, gain: 0.12, when: 0.35 });
    },
    hit() {
      burst({ type: 'sine', freq: 1400, freqEnd: 1400, dur: 0.05, gain: 0.2 });
    },
    kill() {
      burst({ type: 'sine', freq: 880, freqEnd: 880, dur: 0.07, gain: 0.2 });
      burst({ type: 'sine', freq: 1318, freqEnd: 1318, dur: 0.09, gain: 0.2, when: 0.07 });
    },
    hurt() {
      burst({ type: 'sawtooth', freq: 220, freqEnd: 110, dur: 0.15, gain: 0.25 });
    },
    plantBeep() {
      burst({ type: 'sine', freq: 1200, freqEnd: 1200, dur: 0.06, gain: 0.18 });
    },
    beep(fuseLeft) {
      burst({ type: 'sine', freq: fuseLeft < 10 ? 1500 : 1100, freqEnd: 1100, dur: 0.07, gain: 0.22 });
    },
    defuseTick() {
      burst({ type: 'sine', freq: 950, freqEnd: 950, dur: 0.05, gain: 0.15 });
    },
    explosion() {
      burst({ type: 'noise', dur: 1.1, gain: 0.9, filterFreq: 900 });
      burst({ type: 'sine', freq: 90, freqEnd: 30, dur: 0.9, gain: 0.7 });
    },
    roundWin() {
      burst({ type: 'sine', freq: 523, freqEnd: 523, dur: 0.14, gain: 0.2 });
      burst({ type: 'sine', freq: 659, freqEnd: 659, dur: 0.14, gain: 0.2, when: 0.13 });
      burst({ type: 'sine', freq: 784, freqEnd: 784, dur: 0.22, gain: 0.22, when: 0.26 });
    },
    roundLose() {
      burst({ type: 'sine', freq: 392, freqEnd: 392, dur: 0.16, gain: 0.2 });
      burst({ type: 'sine', freq: 311, freqEnd: 311, dur: 0.26, gain: 0.2, when: 0.15 });
    },
    throwGrenade() {
      burst({ type: 'noise', dur: 0.08, gain: 0.15, filterFreq: 1200 });
    },
    flash() {
      burst({ type: 'sine', freq: 2400, freqEnd: 1800, dur: 0.3, gain: 0.25 });
    },
    buy() {
      burst({ type: 'sine', freq: 660, freqEnd: 660, dur: 0.06, gain: 0.16 });
      burst({ type: 'sine', freq: 990, freqEnd: 990, dur: 0.08, gain: 0.16, when: 0.06 });
    },
  };
}
