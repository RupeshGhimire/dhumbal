import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class SoundService {
  private audioContext: AudioContext | null = null;
  private enabled = true;
  private volume = 0.9;

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  getVolume(): number {
    return this.volume;
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
  }

  private getEffectiveVolume(baseVolume: number): number {
    const boostedMasterVolume = this.volume * 2.4;
    return Math.min(baseVolume * boostedMasterVolume, 0.85);
  }

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') {
      return null;
    }

    if (!this.audioContext) {
      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextCtor) {
        return null;
      }
      this.audioContext = new AudioContextCtor();
    }

    return this.audioContext;
  }

  private async resumeIfSuspended(context: AudioContext): Promise<void> {
    if (context.state === 'suspended') {
      await context.resume();
    }
  }

  private async playTone(
    startFrequency: number,
    endFrequency: number,
    durationSeconds: number,
    type: OscillatorType,
    volume = 0.08,
    delaySeconds = 0
  ): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const effectiveVolume = this.getEffectiveVolume(volume);
    if (effectiveVolume <= 0) {
      return;
    }

    const context = this.getContext();
    if (!context) {
      return;
    }

    try {
      await this.resumeIfSuspended(context);
    } catch {
      return;
    }

    const now = context.currentTime + delaySeconds;
    const oscillator = context.createOscillator();
    const gainNode = context.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(startFrequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(endFrequency, 1), now + durationSeconds);

    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.exponentialRampToValueAtTime(effectiveVolume, now + 0.015);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + durationSeconds);

    oscillator.connect(gainNode);
    gainNode.connect(context.destination);

    oscillator.start(now);
    oscillator.stop(now + durationSeconds + 0.02);
  }

  private async playFilteredNoise(
    durationSeconds: number,
    lowPassHz: number,
    highPassHz: number,
    volume = 0.06,
    delaySeconds = 0,
    playbackRate = 1,
    attackSeconds = 0.01
  ): Promise<void> {
    if (!this.enabled) {
      return;
    }

    const effectiveVolume = this.getEffectiveVolume(volume);
    if (effectiveVolume <= 0) {
      return;
    }

    const context = this.getContext();
    if (!context) {
      return;
    }

    try {
      await this.resumeIfSuspended(context);
    } catch {
      return;
    }

    const now = context.currentTime + delaySeconds;
    const sampleRate = context.sampleRate;
    const frameCount = Math.max(1, Math.floor(sampleRate * durationSeconds));
    const buffer = context.createBuffer(1, frameCount, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < frameCount; i++) {
      data[i] = (Math.random() * 2 - 1) * (0.6 + Math.random() * 0.4);
    }

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.setValueAtTime(playbackRate, now);

    const highPass = context.createBiquadFilter();
    highPass.type = 'highpass';
    highPass.frequency.setValueAtTime(Math.max(highPassHz, 20), now);

    const lowPass = context.createBiquadFilter();
    lowPass.type = 'lowpass';
    lowPass.frequency.setValueAtTime(Math.max(lowPassHz, highPassHz + 50), now);

    const gainNode = context.createGain();
    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.exponentialRampToValueAtTime(effectiveVolume, now + attackSeconds);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + durationSeconds);

    source.connect(highPass);
    highPass.connect(lowPass);
    lowPass.connect(gainNode);
    gainNode.connect(context.destination);

    source.start(now);
    source.stop(now + durationSeconds + 0.02);
  }

  private async playCardThump(
    frequency = 170,
    durationSeconds = 0.07,
    volume = 0.04,
    delaySeconds = 0
  ): Promise<void> {
    await this.playTone(frequency, Math.max(80, frequency * 0.62), durationSeconds, 'triangle', volume, delaySeconds);
  }

  playDiscard(): void {
    // Card placed on pile: sharp snap with near-instant attack, bright & short.
    void this.playFilteredNoise(0.065, 8500, 700, 0.10, 0, 1.7, 0.003);
    void this.playFilteredNoise(0.05, 2000, 200, 0.055, 0.008, 1.0, 0.004);
    void this.playCardThump(120, 0.075, 0.06, 0.007);
  }

  playDraw(): void {
    // Card slid off pile: gradual attack, warm muffled texture, longer duration.
    void this.playFilteredNoise(0.18, 1500, 90, 0.065, 0, 0.65, 0.028);
    void this.playFilteredNoise(0.10, 3500, 480, 0.032, 0.07, 1.05, 0.018);
  }

  playTurnPass(): void {
    // Soft melodic chime for turn change — distinct sine tones, not noise.
    void this.playTone(600, 560, 0.12, 'sine', 0.09, 0);
    void this.playTone(450, 420, 0.10, 'sine', 0.06, 0.07);
  }

  playGameStart(): void {
    void this.playTone(330, 360, 0.16, 'triangle', 0.07, 0);
    void this.playTone(440, 470, 0.16, 'triangle', 0.06, 0.08);
    void this.playTone(550, 580, 0.2, 'triangle', 0.05, 0.16);
  }

  playGameEnd(): void {
    void this.playTone(420, 280, 0.2, 'square', 0.06, 0);
    void this.playTone(280, 190, 0.26, 'square', 0.05, 0.1);
  }
}