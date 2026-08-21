(() => {
  const root = document.documentElement;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* EQ musical */
  const eq = document.getElementById("eq");
  const eqBars = [];
  if (eq) {
    const n = 48;
    for (let i = 0; i < n; i++) {
      const bar = document.createElement("i");
      bar.style.setProperty("--h", "0.2");
      eq.appendChild(bar);
      eqBars.push({
        el: bar,
        base: 0.15 + Math.random() * 0.35,
        phase: Math.random() * Math.PI * 2,
        speed: 1.2 + Math.random() * 2.4,
      });
    }
  }

  let ptrX = 0.5;
  let ptrY = 0.5;

  function onScroll() {
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const mood = Math.min(1, Math.max(0, window.scrollY / max));
    root.style.setProperty("--mood", mood.toFixed(4));
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  window.addEventListener(
    "pointermove",
    (e) => {
      ptrX = e.clientX / window.innerWidth;
      ptrY = e.clientY / window.innerHeight;
      root.style.setProperty("--cx", ptrX * 100 + "%");
      root.style.setProperty("--cy", ptrY * 100 + "%");
    },
    { passive: true },
  );

  function tickEq(now) {
    if (eqBars.length && !reduce) {
      const t = now / 1000;
      const mood = Number(getComputedStyle(root).getPropertyValue("--mood")) || 0;
      const energy = 0.55 + (1 - mood) * 0.45 + (1 - ptrY) * 0.25;
      eqBars.forEach((b, i) => {
        const wave =
          Math.sin(t * b.speed + b.phase) * 0.22 +
          Math.sin(t * 3.1 + i * 0.35) * 0.12 +
          Math.sin(t * 0.7 + i * 0.08) * 0.08;
        const near = 1 - Math.min(1, Math.abs(i / eqBars.length - ptrX) * 2.2);
        const h = Math.min(1, Math.max(0.08, (b.base + wave + near * 0.35) * energy));
        b.el.style.setProperty("--h", h.toFixed(3));
      });
    }
    requestAnimationFrame(tickEq);
  }
  if (!reduce) requestAnimationFrame(tickEq);

  document.querySelectorAll(".mag").forEach((btn) => {
    btn.addEventListener("pointermove", (e) => {
      if (reduce) return;
      const r = btn.getBoundingClientRect();
      const x = e.clientX - (r.left + r.width / 2);
      const y = e.clientY - (r.top + r.height / 2);
      btn.style.setProperty("--mx", x * 0.12 + "px");
      btn.style.setProperty("--my", y * 0.18 + "px");
    });
    btn.addEventListener("pointerleave", () => {
      btn.style.setProperty("--mx", "0px");
      btn.style.setProperty("--my", "0px");
    });
  });

  document.querySelectorAll(".reveal").forEach((el) => {
    el.classList.add("is-in");
  });

  if (!reduce) {
    const floats = document.querySelectorAll("[data-drift]");
    function tickFloat(now) {
      const t = now / 1000;
      floats.forEach((el, i) => {
        if (el.id === "heroPlayer" && el.dataset.held === "1") return;
        const amp = Number(el.dataset.amp || 8);
        const spd = Number(el.dataset.spd || 0.35);
        const phase = i * 1.3;
        const x = Math.sin(t * spd + phase) * amp;
        const y = Math.cos(t * spd * 0.85 + phase) * amp * 0.7;
        const rot = Math.sin(t * spd * 0.5 + phase) * 2.5;
        el.style.transform = "translate(" + x + "px," + y + "px) rotate(" + rot + "deg)";
      });
      requestAnimationFrame(tickFloat);
    }
    requestAnimationFrame(tickFloat);
  }

  function formatClock(secs) {
    if (!Number.isFinite(secs) || secs < 0) return "0:00";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return m + ":" + String(s).padStart(2, "0");
  }

  /* —— Mini player hero (haut droite) —— */
  (async function bootHeroPlayer() {
    const root = document.getElementById("heroPlayer");
    if (!root) return;
    const playBtn = document.getElementById("heroPlayerPlay");
    const prevBtn = document.getElementById("heroPlayerPrev");
    const nextBtn = document.getElementById("heroPlayerNext");
    const seek = document.getElementById("heroPlayerSeek");
    const eq = document.getElementById("heroPlayerEq");
    const titleEl = document.getElementById("heroPlayerTitle");
    const artistEl = document.getElementById("heroPlayerArtist");
    const folderEl = document.getElementById("heroPlayerFolder");
    const curEl = document.getElementById("heroPlayerCur");
    const durEl = document.getElementById("heroPlayerDur");

    let clips = [];
    try {
      const res = await fetch("clips/clips.json", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        clips = (data.clips || []).filter((c) => c.file && c.title && !/^Remplace-moi/i.test(c.title));
      }
    } catch (_) {}
    if (!clips.length) {
      clips = [
        {
          title: "Wake Me Up",
          artist: "Avicii",
          folder: "Électro",
          file: "06-wake-me-up.mp3",
        },
      ];
    }

    let idx = Math.max(
      0,
      clips.findIndex((c) => /wake-me-up|Wake Me Up/i.test(c.file || c.title)),
    );
    if (idx < 0) idx = 0;
    const audio = new Audio();
    audio.preload = "metadata";
    audio.volume = 0.75;

    function showMeta(c) {
      if (folderEl) folderEl.textContent = c.folder || c.genre || "—";
      if (titleEl) titleEl.textContent = c.title;
      if (artistEl) artistEl.textContent = c.artist || "—";
    }

    function load(i, autoplay) {
      idx = (i + clips.length) % clips.length;
      const c = clips[idx];
      showMeta(c);
      audio.src = "clips/" + c.file;
      audio.load();
      if (seek) {
        seek.value = "0";
        seek.style.setProperty("--p", "0%");
      }
      if (curEl) curEl.textContent = "0:00";
      if (eq) eq.classList.remove("is-on");
      if (playBtn) playBtn.textContent = "Play";
      if (autoplay) {
        void audio.play().then(() => {
          if (eq) eq.classList.add("is-on");
          if (playBtn) playBtn.textContent = "Pause";
        }).catch((err) => {
          console.warn("hero play", err);
          if (playBtn) playBtn.textContent = "Play";
        });
      }
    }

    function toggle() {
      if (audio.paused) {
        void audio.play().then(() => {
          if (eq) eq.classList.add("is-on");
          if (playBtn) playBtn.textContent = "Pause";
        }).catch((err) => {
          console.warn("hero play", err);
          if (artistEl) artistEl.textContent = "Erreur lecture — clique encore";
        });
      } else {
        audio.pause();
        if (eq) eq.classList.remove("is-on");
        if (playBtn) playBtn.textContent = "Play";
      }
    }

    audio.addEventListener("timeupdate", () => {
      const d = audio.duration || 0;
      const c = audio.currentTime || 0;
      const p = d > 0 ? (c / d) * 100 : 0;
      if (seek) {
        seek.max = String(Math.max(1, d));
        seek.value = String(c);
        seek.style.setProperty("--p", p + "%");
      }
      if (curEl) curEl.textContent = formatClock(c);
    });
    audio.addEventListener("durationchange", () => {
      if (durEl) durEl.textContent = formatClock(audio.duration || 0);
      if (seek) seek.max = String(Math.max(1, audio.duration || 1));
    });
    audio.addEventListener("ended", () => load(idx + 1, true));

    playBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      toggle();
    });
    prevBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      load(idx - 1, true);
    });
    nextBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      load(idx + 1, true);
    });
    seek?.addEventListener("input", () => {
      audio.currentTime = Number(seek.value);
    });

    load(idx, false);
  })();

  /* —— Preview Live —— */
  const player = (() => {
    const overlay = document.getElementById("playerOverlay");
    if (!overlay) return null;

    const eqHost = document.getElementById("playerEq");
    if (eqHost && !eqHost.children.length) {
      for (let i = 0; i < 12; i++) {
        const span = document.createElement("span");
        span.style.animationDelay = i * 0.07 + "s";
        eqHost.appendChild(span);
      }
    }

    const els = {
      folder: document.getElementById("playerFolder"),
      title: document.getElementById("playerTitle"),
      artist: document.getElementById("playerArtist"),
      error: document.getElementById("playerError"),
      album: document.getElementById("playerAlbum"),
      year: document.getElementById("playerYear"),
      genre: document.getElementById("playerGenre"),
      bpm: document.getElementById("playerBpm"),
      key: document.getElementById("playerKey"),
      bitrate: document.getElementById("playerBitrate"),
      durMeta: document.getElementById("playerDurMeta"),
      file: document.getElementById("playerFile"),
      path: document.getElementById("playerPath"),
      seek: document.getElementById("playerSeek"),
      timeCur: document.getElementById("playerTimeCur"),
      timeDur: document.getElementById("playerTimeDur"),
      mute: document.getElementById("playerMute"),
      vol: document.getElementById("playerVol"),
      volPct: document.getElementById("playerVolPct"),
      prev: document.getElementById("playerPrev"),
      play: document.getElementById("playerPlay"),
      next: document.getElementById("playerNext"),
    };

    const audio = new Audio();
    audio.preload = "metadata";
    let queue = [];
    let index = 0;
    let volume = 0.8;
    let lastVolume = 0.8;
    let open = false;

    function setPlayingUi(playing) {
      if (els.play) els.play.textContent = playing ? "Pause" : "Play";
      if (eqHost) {
        eqHost.querySelectorAll("span").forEach((s) => s.classList.toggle("is-on", playing));
      }
    }

    function setVolume(v) {
      volume = Math.min(1, Math.max(0, Math.round(v * 100) / 100));
      if (volume > 0) lastVolume = volume;
      audio.volume = volume;
      if (els.vol) {
        els.vol.value = String(volume);
        els.vol.style.setProperty("--p", volume * 100 + "%");
      }
      if (els.volPct) els.volPct.textContent = Math.round(volume * 100) + "%";
      if (els.mute) els.mute.textContent = volume > 0 ? "Sound" : "Mute";
    }

    function fillMeta(track) {
      const path = track.audio || ("clips/" + (track.file || ""));
      if (els.folder) els.folder.textContent = track.folder || track.genre || "—";
      if (els.title) els.title.textContent = track.title || track.file || "—";
      if (els.artist) els.artist.textContent = track.artist || "Unknown artist";
      if (els.album) els.album.textContent = track.album || "—";
      if (els.year) els.year.textContent = track.year || "—";
      if (els.genre) els.genre.textContent = track.genre || track.folder || "—";
      if (els.bpm) els.bpm.textContent = track.bpm != null ? String(track.bpm) : "—";
      if (els.key) els.key.textContent = track.musicalKey || "—";
      if (els.bitrate) {
        els.bitrate.textContent = track.bitrateKbps ? track.bitrateKbps + " kb/s" : "—";
      }
      if (els.durMeta) {
        els.durMeta.textContent = track.durationSecs
          ? formatClock(track.durationSecs)
          : track.dur || "—";
      }
      if (els.file) els.file.textContent = track.file || path.split("/").pop() || "—";
      if (els.path) {
        els.path.textContent = path;
        els.path.title = path;
      }
      if (els.error) {
        els.error.hidden = true;
        els.error.textContent = "";
      }
    }

    function loadTrack(i, autoplay) {
      if (!queue.length) return;
      index = (i + queue.length) % queue.length;
      const track = queue[index];
      fillMeta(track);
      const src = track.audio || ("clips/" + track.file);
      audio.src = src;
      audio.load();
      setPlayingUi(false);
      if (els.seek) {
        els.seek.value = "0";
        els.seek.style.setProperty("--p", "0%");
      }
      if (els.timeCur) els.timeCur.textContent = "0:00";
      if (autoplay) {
        void audio.play().then(() => setPlayingUi(true)).catch(() => {
          setPlayingUi(false);
          if (els.error) {
            els.error.hidden = false;
            els.error.textContent =
              "File not found — add the clip to /clips and check clips.json.";
          }
        });
      }
      if (els.prev) els.prev.disabled = queue.length < 2;
      if (els.next) els.next.disabled = queue.length < 2;
    }

    function openPlayer(track, allPlayable) {
      queue = allPlayable && allPlayable.length ? allPlayable : [track];
      const i = Math.max(
        0,
        queue.findIndex((t) => (t.id && t.id === track.id) || t.audio === track.audio),
      );
      overlay.classList.add("is-on");
      open = true;
      document.body.style.overflow = "hidden";
      setVolume(volume);
      loadTrack(i < 0 ? 0 : i, true);
    }

    function closePlayer() {
      audio.pause();
      setPlayingUi(false);
      overlay.classList.remove("is-on");
      open = false;
      document.body.style.overflow = "";
    }

    function toggle() {
      if (audio.paused) {
        void audio.play().then(() => setPlayingUi(true)).catch(() => {
          if (els.error) {
            els.error.hidden = false;
            els.error.textContent = "Unable to play this track.";
          }
        });
      } else {
        audio.pause();
        setPlayingUi(false);
      }
    }

    audio.addEventListener("timeupdate", () => {
      const d = audio.duration || 0;
      const c = audio.currentTime || 0;
      const p = d > 0 ? (c / d) * 100 : 0;
      if (els.seek) {
        els.seek.max = String(Math.max(1, d));
        els.seek.value = String(c);
        els.seek.style.setProperty("--p", p + "%");
      }
      if (els.timeCur) els.timeCur.textContent = formatClock(c);
    });
    audio.addEventListener("durationchange", () => {
      const d = audio.duration || 0;
      if (els.timeDur) els.timeDur.textContent = formatClock(d);
      if (els.durMeta && Number.isFinite(d) && d > 0) {
        els.durMeta.textContent = formatClock(d);
      }
      if (els.seek) els.seek.max = String(Math.max(1, d));
    });
    audio.addEventListener("ended", () => {
      if (queue.length > 1) loadTrack(index + 1, true);
      else setPlayingUi(false);
    });
    audio.addEventListener("error", () => {
      setPlayingUi(false);
      if (els.error) {
        els.error.hidden = false;
        els.error.textContent =
          "File not found — add the clip to /clips and check clips.json.";
      }
    });

    els.seek?.addEventListener("input", () => {
      audio.currentTime = Number(els.seek.value);
    });
    els.vol?.addEventListener("input", () => setVolume(Number(els.vol.value)));
    els.mute?.addEventListener("click", () => {
      if (volume > 0) setVolume(0);
      else setVolume(lastVolume || 0.8);
    });
    els.play?.addEventListener("click", toggle);
    els.prev?.addEventListener("click", () => loadTrack(index - 1, true));
    els.next?.addEventListener("click", () => loadTrack(index + 1, true));
    document.getElementById("playerClose")?.addEventListener("click", closePlayer);
    document.getElementById("playerBackdrop")?.addEventListener("click", closePlayer);

    window.addEventListener("keydown", (e) => {
      if (!open) return;
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Escape") {
        e.preventDefault();
        closePlayer();
      }
      if (e.key === " ") {
        e.preventDefault();
        toggle();
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setVolume(volume + 0.05);
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setVolume(volume - 0.05);
      }
      if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        if (volume > 0) setVolume(0);
        else setVolume(lastVolume || 0.8);
      }
      if (e.key === "ArrowRight" && e.shiftKey) {
        e.preventDefault();
        loadTrack(index + 1, true);
      }
      if (e.key === "ArrowLeft" && e.shiftKey) {
        e.preventDefault();
        loadTrack(index - 1, true);
      }
    });

    setVolume(0.8);
    return { openPlayer, closePlayer };
  })();

  /* —— Simulation scan local —— */
  async function bootSim() {
    /* Placeholders non écoutables — uniquement pour tester le tri / dossiers. */
    const DEMO_TRACKS = [
      { title: "Glass Jaw", artist: "Static Youth", folder: "Rock", dur: "3:42", file: "glass_jaw.mp3" },
      { title: "Static Youth", artist: "Static Youth", folder: "Rock", dur: "4:05", file: "static_youth.mp3" },
      { title: "Redline", artist: "Ash Circuit", folder: "Rock", dur: "3:18", file: "redline.flac" },
      { title: "Fault Line", artist: "Ash Circuit", folder: "Rock", dur: "3:51", file: "fault_line.mp3" },
      { title: "Blue Room", artist: "Elm Quartet", folder: "Jazz", dur: "5:12", file: "blue_room.mp3" },
      { title: "Smoke Signal", artist: "River Brass", folder: "Jazz", dur: "4:44", file: "smoke_signal.mp3" },
      { title: "Late Set", artist: "Elm Quartet", folder: "Jazz", dur: "6:01", file: "late_set.flac" },
      { title: "Harbor Lights", artist: "River Brass", folder: "Jazz", dur: "4:02", file: "harbor_lights.mp3" },
      { title: "Concrete Prayer", artist: "K-Line", folder: "Hip-Hop", dur: "2:58", file: "concrete_prayer.mp3" },
      { title: "Night Court", artist: "K-Line", folder: "Hip-Hop", dur: "3:21", file: "night_court.mp3" },
      { title: "Low Battery", artist: "Tape Run", folder: "Hip-Hop", dur: "2:47", file: "low_battery.m4a" },
      { title: "Sidewalk Cipher", artist: "Tape Run", folder: "Hip-Hop", dur: "3:09", file: "sidewalk_cipher.mp3" },
      { title: "Midnight Drive", artist: "Neon Coast", folder: "Electro", dur: "4:10", file: "midnight_drive.mp3" },
      { title: "After Hours", artist: "Soft Circuit", folder: "Electro", dur: "5:33", file: "after_hours.wav" },
      { title: "Gridlock", artist: "Soft Circuit", folder: "Electro", dur: "3:55", file: "gridlock.mp3" },
      { title: "Pulse Map", artist: "Neon Coast", folder: "Electro", dur: "4:28", file: "pulse_map.flac" },
      { title: "Chrome Bloom", artist: "Velvet Relay", folder: "Pop", dur: "3:14", file: "chrome_bloom.mp3" },
      { title: "Paper Planets", artist: "Velvet Relay", folder: "Pop", dur: "2:56", file: "paper_planets.mp3" },
      { title: "Weekend Glow", artist: "Lumen Park", folder: "Pop", dur: "3:33", file: "weekend_glow.m4a" },
      { title: "Iron Chorus", artist: "Black Voltage", folder: "Metal", dur: "4:41", file: "iron_chorus.mp3" },
      { title: "Rust Anthem", artist: "Black Voltage", folder: "Metal", dur: "5:02", file: "rust_anthem.flac" },
      { title: "Forge Hymn", artist: "Slag Engine", folder: "Metal", dur: "3:48", file: "forge_hymn.mp3" },
      { title: "Copper Softly", artist: "Amber Lane", folder: "Soul", dur: "3:27", file: "copper_softly.mp3" },
      { title: "Midnight Kitchen", artist: "Amber Lane", folder: "Soul", dur: "4:11", file: "midnight_kitchen.mp3" },
      { title: "Slow Burn Honey", artist: "Riviera Keys", folder: "Soul", dur: "3:58", file: "slow_burn_honey.flac" },
      { title: "Yard Signal", artist: "King Root", folder: "Reggae", dur: "3:36", file: "yard_signal.mp3" },
      { title: "Dub Morning", artist: "King Root", folder: "Reggae", dur: "4:22", file: "dub_morning.mp3" },
      { title: "Island Wire", artist: "Coral Pressure", folder: "Reggae", dur: "3:19", file: "island_wire.m4a" },
      { title: "String Orbit", artist: "North Chamber", folder: "Classical", dur: "7:05", file: "string_orbit.flac" },
      { title: "Quiet March", artist: "North Chamber", folder: "Classical", dur: "5:40", file: "quiet_march.mp3" },
      { title: "Glass Nocturne", artist: "Ivory Atlas", folder: "Classical", dur: "4:18", file: "glass_nocturne.mp3" },
      { title: "Calle Norte", artist: "Sol Fuego", folder: "Latin", dur: "3:44", file: "calle_norte.mp3" },
      { title: "Ritmo Baja", artist: "Sol Fuego", folder: "Latin", dur: "3:12", file: "ritmo_baja.mp3" },
      { title: "Plaza Drift", artist: "Mar Azul", folder: "Latin", dur: "4:01", file: "plaza_drift.flac" },
      { title: "Fog Layer", artist: "Pale Antenna", folder: "Ambient", dur: "6:20", file: "fog_layer.wav" },
      { title: "Soft Horizon", artist: "Pale Antenna", folder: "Ambient", dur: "5:55", file: "soft_horizon.mp3" },
      { title: "Empty Platform", artist: "Grey Terminal", folder: "Ambient", dur: "7:12", file: "empty_platform.flac" },
      { title: "Untitled 07", artist: "Unknown", folder: "Uncategorized", dur: "3:00", file: "untitled_07.mp3" },
      { title: "Demo Track", artist: "Unknown", folder: "Uncategorized", dur: "2:14", file: "demo_track.mp3" },
      { title: "track_final_mix", artist: "Unknown", folder: "Uncategorized", dur: "2:48", file: "track_final_mix.mp3" },
      { title: "IMG_2048_audio", artist: "Unknown", folder: "Uncategorized", dur: "1:55", file: "img_2048_audio.m4a" },
    ];

    function normalizeDemoFolder(name) {
      if (!name) return "Uncategorized";
      const n = String(name).trim();
      if (/^électr/i.test(n) || /^electr/i.test(n)) return "Electro";
      return n;
    }

    let clips = [];
    try {
      const res = await fetch("clips/clips.json", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        clips = Array.isArray(data.clips) ? data.clips : [];
      }
    } catch (_) {
      /* ignore */
    }

    const featured = clips
      .filter((c) => c && c.file && c.title && !/^Remplace-moi/i.test(c.title))
      .map((c) => {
        const folder = normalizeDemoFolder(c.folder || c.genre || "Electro");
        return {
          id: c.id || c.file,
          title: c.title,
          artist: c.artist || "Unknown artist",
          folder,
          genre: folder,
          dur: c.durationSecs ? formatClock(c.durationSecs) : "—",
          file: c.file,
          audio: "clips/" + c.file,
          album: c.album || "",
          year: c.year || "",
          bpm: c.bpm,
          musicalKey: c.musicalKey || "",
          bitrateKbps: c.bitrateKbps,
          durationSecs: c.durationSecs,
          playable: true,
        };
      });

    /* Placeholders encore dans clips.json : on les ignore pour la lecture,
       mais on garde le scan démo. Si au moins 1 vrai clip : on les met en tête. */
    const TRACKS = featured.length
      ? featured.concat(
          DEMO_TRACKS.filter(
            (d) => !featured.some((f) => f.title === d.title && f.folder === d.folder),
          ),
        )
      : DEMO_TRACKS;

    const playableQueue = () => TRACKS.filter((t) => t.playable && t.audio);

    const SCAN_LINES = [
      "Opening your folder without touching the tracks…",
      "Finding MP3, FLAC, M4A and friends…",
      "Reading tags: artist, title, album…",
      "Grouping tracks by genre…",
      "Preparing the folder plan…",
    ];

    const FOLDER_ORDER = [
      "Rock",
      "Metal",
      "Jazz",
      "Hip-Hop",
      "Electro",
      "Pop",
      "Soul",
      "Reggae",
      "Latin",
      "Classical",
      "Ambient",
      "Uncategorized",
    ];

    const rootEl = document.getElementById("simLocal");
    if (!rootEl) return;

    const statusEl = document.getElementById("simStatus");
    const toastEl = document.getElementById("simToast");
    const toastTitle = document.getElementById("simToastTitle");
    const toastBody = document.getElementById("simToastBody");
    const pickerPath = document.getElementById("simPickerPath");
    const pickerOk = document.getElementById("simPickerOk");
    const foldersEl = document.getElementById("simFolders");
    const tracksEl = document.getElementById("simTracks");
    const detailLabel = document.getElementById("simDetailLabel");
    const rootPathEl = document.getElementById("simRootPath");
    const barFill = document.getElementById("simBarFill");
    const percentEl = document.getElementById("simPercent");
    const countEl = document.getElementById("simCount");
    const progressEl = document.getElementById("simProgress");
    const termLine = document.getElementById("simTermLine");
    const termFile = document.getElementById("simTermFile");
    const clipsNote = document.getElementById("simClipsNote");

    if (clipsNote) {
      clipsNote.hidden = featured.length === 0;
      if (featured.length === 0) {
        clipsNote.hidden = false;
        clipsNote.innerHTML =
          "Ajoute 4–8 extraits dans <strong>clips/</strong> + <strong>clips.json</strong> pour activer la Preview Live.";
      }
    }

    let selectedPath = null;
    let selectedFolder = featured[0] ? featured[0].folder : "Rock";
    let toastTimer = null;
    let scanTimer = null;

    function setStatus(text) {
      if (statusEl) statusEl.textContent = text;
    }

    function showToast(title, body, ms) {
      if (!toastEl) return;
      if (toastTitle) toastTitle.textContent = title;
      if (toastBody) toastBody.textContent = body;
      toastEl.classList.add("is-on");
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => {
        toastEl.classList.remove("is-on");
      }, ms || 2800);
    }

    function showStep(next) {
      rootEl.querySelectorAll(".sim-panel").forEach((p) => {
        p.classList.toggle("is-on", p.dataset.step === next);
      });
    }

    function folderStats() {
      const map = {};
      FOLDER_ORDER.forEach((f) => {
        map[f] = [];
      });
      TRACKS.forEach((t) => {
        if (!map[t.folder]) map[t.folder] = [];
        map[t.folder].push(t);
      });
      return map;
    }

    function renderPlan() {
      const stats = folderStats();
      const total = TRACKS.length;
      const classified = TRACKS.filter((t) => t.folder !== "Uncategorized").length;
      const pct = Math.round((classified / total) * 100);
      const ring = document.getElementById("simRing");
      const ringPct = document.getElementById("simRingPct");
      const summary = document.getElementById("simPlanSummary");
      if (ring) ring.style.setProperty("--p", String(pct));
      if (ringPct) ringPct.textContent = pct + "%";
      if (summary) {
        summary.textContent =
          classified + " sorted · " + (total - classified) + " uncategorized";
      }
      if (rootPathEl && selectedPath) rootPathEl.textContent = selectedPath;

      if (!foldersEl) return;
      foldersEl.innerHTML = "";
      const order = FOLDER_ORDER.slice();
      Object.keys(stats).forEach((k) => {
        if (!order.includes(k)) order.push(k);
      });
      order.forEach((name) => {
        const list = stats[name] || [];
        if (!list.length) return;
        const li = document.createElement("li");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className =
          "sim-folder" +
          (name === selectedFolder ? " is-active" : "") +
          (name === "Uncategorized" ? " is-warn" : "");
        const w = Math.round((list.length / total) * 100);
        btn.innerHTML =
          '<div class="sim-folder-top"><span class="sim-folder-name">' +
          name +
          '</span><span class="sim-folder-count">' +
          list.length +
          '</span></div><div class="sim-folder-fill"><i style="--w:' +
          w +
          '%"></i></div>';
        btn.addEventListener("click", () => {
          selectedFolder = name;
          renderPlan();
        });
        li.appendChild(btn);
        foldersEl.appendChild(li);
      });

      const tracks = stats[selectedFolder] || [];
      if (detailLabel) detailLabel.textContent = selectedFolder + " · " + tracks.length;
      if (!tracksEl) return;
      tracksEl.innerHTML = "";
      tracks.forEach((t) => {
        const li = document.createElement("li");
        li.className = "sim-track" + (t.playable ? " is-playable" : "");
        li.innerHTML =
          "<div><b>" +
          t.title +
          "</b><span>" +
          t.artist +
          "</span></div>" +
          (t.playable
            ? '<span class="play-hint">listen</span>'
            : "<time>" + t.dur + "</time>");
        if (t.playable && player) {
          li.addEventListener("click", () => {
            player.openPlayer(t, playableQueue());
          });
        }
        tracksEl.appendChild(li);
      });
    }

    function stopScan() {
      if (scanTimer) {
        clearTimeout(scanTimer);
        scanTimer = null;
      }
    }

    function runScan() {
      stopScan();
      showStep("scan");
      setStatus("Analyzing…");
      showToast("Analyzing folder…", "Read-only — nothing is moved", 3200);

      const total = TRACKS.length;
      let done = 0;
      let lineIdx = 0;

      if (barFill) barFill.style.width = "0%";
      if (percentEl) percentEl.textContent = "0%";
      if (countEl) countEl.textContent = "0 / " + total + " tracks";
      if (progressEl) progressEl.setAttribute("aria-valuenow", "0");
      if (termLine) termLine.textContent = SCAN_LINES[0];
      if (termFile) termFile.textContent = "";

      const stepMs = reduce ? 40 : 280;

      function tick() {
        done += 1;
        const pct = Math.min(100, Math.round((done / total) * 100));
        if (barFill) barFill.style.width = pct + "%";
        if (percentEl) percentEl.textContent = pct + "%";
        if (countEl) countEl.textContent = done + " / " + total + " tracks";
        if (progressEl) progressEl.setAttribute("aria-valuenow", String(pct));

        const t = TRACKS[done - 1];
        if (t && termFile) {
          termFile.textContent = (selectedPath || "C:\\Users\\Alex\\Music") + "\\" + t.file;
        }
        if (done % 3 === 1 && termLine) {
          lineIdx = (lineIdx + 1) % SCAN_LINES.length;
          termLine.textContent = SCAN_LINES[lineIdx];
        }

        if (done >= total) {
          scanTimer = window.setTimeout(() => {
            showStep("plan");
            setStatus(pct + "% sorted");
            const n = TRACKS.filter((x) => x.folder !== "Uncategorized").length;
            showToast(
              "Plan ready",
              n + " tracks sorted · " + (TRACKS.length - n) + " to fix in the app",
              3000,
            );
            renderPlan();
          }, reduce ? 80 : 450);
          return;
        }
        scanTimer = window.setTimeout(tick, stepMs);
      }

      scanTimer = window.setTimeout(tick, reduce ? 60 : 400);
    }

    function resetDemo() {
      stopScan();
      selectedPath = null;
      selectedFolder = featured[0] ? featured[0].folder : "Rock";
      if (pickerOk) pickerOk.disabled = true;
      document.querySelectorAll("#simTree button").forEach((b) => b.classList.remove("is-sel"));
      if (pickerPath) pickerPath.textContent = "This PC\\Users\\Alex";
      showStep("idle");
      setStatus("Ready");
      if (toastEl) toastEl.classList.remove("is-on");
      if (player) player.closePlayer();
    }

    document.getElementById("simOpenPicker")?.addEventListener("click", () => {
      showStep("picker");
      setStatus("Choose a folder");
    });
    document.getElementById("simPickerCancel")?.addEventListener("click", resetDemo);
    document.getElementById("simReplay")?.addEventListener("click", resetDemo);

    document.getElementById("simTree")?.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const path = btn.dataset.path;
      if (!path) return;
      if (pickerPath) {
        pickerPath.textContent = path.replace(/^C:\\Users\\Alex/, "This PC\\Users\\Alex");
      }
      document.querySelectorAll("#simTree button").forEach((b) => b.classList.remove("is-sel"));
      btn.classList.add("is-sel");
      if (btn.dataset.folder === "1") {
        selectedPath = path;
        if (pickerOk) pickerOk.disabled = false;
      } else {
        selectedPath = null;
        if (pickerOk) pickerOk.disabled = true;
      }
    });

    pickerOk?.addEventListener("click", () => {
      if (!selectedPath) return;
      runScan();
    });
  }

  bootSim().catch((err) => console.warn("simLocal", err));
})();
