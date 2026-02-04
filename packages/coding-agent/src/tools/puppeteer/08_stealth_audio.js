// Spoof AudioContext latency values to look like real hardware
const spoofLatency = (proto) => {
  Object_defineProperty(proto, "baseLatency", {
    get: () => 0.005, // ~5ms typical for real hardware
    configurable: true,
    enumerable: true,
  });
  Object_defineProperty(proto, "outputLatency", {
    get: () => 0.01, // ~10ms typical
    configurable: true,
    enumerable: true,
  });
};

if (window.AudioContext) {
  spoofLatency(AudioContext.prototype);
}
if (window.OfflineAudioContext) {
  // For offline context, add subtle randomness to prevent deterministic fingerprints
  const OriginalOfflineAudioContext = window.OfflineAudioContext;
  window.OfflineAudioContext = class extends OriginalOfflineAudioContext {
    constructor(numberOfChannels, length, sampleRate) {
      super(numberOfChannels, length, sampleRate);

      // Hook startRendering to add noise
      const originalStartRendering = this.startRendering.bind(this);
      this.startRendering = async () => {
        const buffer = await originalStartRendering();
        // Add imperceptible noise to prevent deterministic hash
        for (let c = 0; c < buffer.numberOfChannels; c++) {
          const channel = buffer.getChannelData(c);
          for (let i = 0; i < channel.length; i++) {
            if (Math_random() < 0.001) {
              channel[i] += (Math_random() - 0.5) * 1e-8;
            }
          }
        }
        return buffer;
      };
    }
  };
}

// Also spoof sampleRate consistency
if (window.AudioContext) {
  Object_defineProperty(AudioContext.prototype, "sampleRate", {
    get: () => 48000, // Common hardware rate
    configurable: true,
    enumerable: true,
  });
}
