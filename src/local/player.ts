import { isTauri, mediaSrc } from "./api";

let shared: HTMLAudioElement | null = null;
let previewVolume = 0.8;

export function getPreviewAudio(): HTMLAudioElement {
  if (!shared) {
    shared = new Audio();
    shared.preload = "auto";
  }
  shared.volume = previewVolume;
  return shared;
}

export function setPreviewVolume(volume: number): void {
  previewVolume = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0.8;
  if (shared) {
    shared.volume = previewVolume;
  }
}

export function startPreview(path: string): HTMLAudioElement {
  const audio = getPreviewAudio();
  if (!isTauri()) {
    return audio;
  }
  if (audio.dataset.path !== path) {
    audio.dataset.path = path;
    audio.src = mediaSrc(path);
  }
  void audio.play().catch(() => {
    /* geste perdu ou fichier illisible — l’UI gère Play / erreur média */
  });
  return audio;
}

export function stopPreview(): void {
  if (!shared) {
    return;
  }
  shared.pause();
  shared.removeAttribute("src");
  shared.load();
  shared.volume = previewVolume;
  delete shared.dataset.path;
}
