import JSZip from 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm';

const RELEASE = 'https://github.com/QUD-Technologies/quranic-universal-audio/releases/latest/download';
// Local development: run `python proxy.py` (port 8787). For deployment,
// replace this with the URL of your deployed Cloudflare Worker.
const QUA_PROXY_BASE = 'https://quran-proxy.ibrahim-talal.workers.dev';
const MANIFEST_URL = `${RELEASE}/manifest.json`;
const CATALOG_URL = `${RELEASE}/catalog.json`;

function quaURL(url) {
  return `${QUA_PROXY_BASE}/proxy?url=${encodeURIComponent(url)}`;
}

const DEFAULT_RECITER_SLUG = 'yasser_al_dosari_archive';
const SEEK_STEP_MS = 5000;
const RESTART_THRESHOLD_MS = 1500;

const SURAH_NAMES = [
  'Al-Fatihah','Al-Baqarah','Aal-Imran','An-Nisa','Al-Maidah','Al-Anam','Al-Araf','Al-Anfal','At-Tawbah','Yunus',
  'Hud','Yusuf','Ar-Rad','Ibrahim','Al-Hijr','An-Nahl','Al-Isra','Al-Kahf','Maryam','Ta-Ha',
  'Al-Anbiya','Al-Hajj','Al-Muminun','An-Nur','Al-Furqan','Ash-Shuara','An-Naml','Al-Qasas','Al-Ankabut','Ar-Rum',
  'Luqman','As-Sajdah','Al-Ahzab','Saba','Fatir','Ya-Sin','As-Saffat','Sad','Az-Zumar','Ghafir',
  'Fussilat','Ash-Shura','Az-Zukhruf','Ad-Dukhan','Al-Jathiyah','Al-Ahqaf','Muhammad','Al-Fath','Al-Hujurat','Qaf',
  'Adh-Dhariyat','At-Tur','An-Najm','Al-Qamar','Ar-Rahman','Al-Waqiah','Al-Hadid','Al-Mujadilah','Al-Hashr','Al-Mumtahanah',
  'As-Saff','Al-Jumuah','Al-Munafiqun','At-Taghabun','At-Talaq','At-Tahrim','Al-Mulk','Al-Qalam','Al-Haqqah','Al-Maarij',
  'Nuh','Al-Jinn','Al-Muzzammil','Al-Muddaththir','Al-Qiyamah','Al-Insan','Al-Mursalat','An-Naba','An-Naziat','Abasa',
  'At-Takwir','Al-Infitar','Al-Mutaffifin','Al-Inshiqaq','Al-Buruj','At-Tariq','Al-Ala','Al-Ghashiyah','Al-Fajr','Al-Balad',
  'Ash-Shams','Al-Layl','Ad-Duha','Ash-Sharh','At-Tin','Al-Alaq','Al-Qadr','Al-Bayyinah','Az-Zalzalah','Al-Adiyat',
  'Al-Qariah','At-Takathur','Al-Asr','Al-Humazah','Al-Fil','Quraysh','Al-Maun','Al-Kawthar','Al-Kafirun','An-Nasr',
  'Al-Masad','Al-Ikhlas','Al-Falaq','An-Nas'
];

const el = id => document.getElementById(id);

const ui = {
  reciter: el('reciter'),
  refresh: el('refresh'),
  surah: el('surah'),
  ayah: el('start-ayah'),
  reader: el('reader'),
  loaded: el('loaded-label'),
  status: el('status'),
  audio: el('audio'),
  play: el('play'),
  pause: el('pause'),
  stop: el('stop'),
  prev: el('prev-ayah'),
  next: el('next-ayah'),
  back: el('back-5'),
  forward: el('forward-5')
};

let manifest = null;
let catalog = null;
let recitations = new Map();

let reciterControl = null;
let surahControl = null;

let wordElements = new Map();

let segments = [];
let segmentStarts = [];
let ayahStarts = [];

let playing = false;
let paused = false;
let currentWord = null;
let animationFrame = 0;

let loadedChapter = null;
let loadedReciterSlug = null;
let loadPromise = null;

function status(message) {
  ui.status.textContent = message;
}

function setControlsReady(ready) {
  ui.play.disabled = !ui.reciter.value;

  for (const button of [
    ui.pause, ui.stop, ui.prev, ui.next, ui.back, ui.forward
  ]) {
    button.disabled = !ready;
  }

  ui.pause.textContent = '❚❚ Pause';
}

async function getJSON(url) {
  const response = await fetch(quaURL(url), { cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${url}`);
  }

  return response.json();
}

function createSearchableSelect(select, placeholder) {
  if (!window.TomSelect) {
    throw new Error('The searchable dropdown library could not be loaded.');
  }

  return new window.TomSelect(select, {
    create: false,
    openOnFocus: true,
    closeAfterSelect: true,
    maxOptions: null,
    searchField: ['text'],
    placeholder,
    selectOnTab: true,
    hideSelected: false,
    render: {
      no_results: () =>
        '<div class="no-results">No matches found</div>'
    }
  });
}

function populateSurahs() {
  SURAH_NAMES.forEach((name, index) => {
    const option = document.createElement('option');
    option.value = String(index + 1);
    option.textContent = `${index + 1}. ${name}`;
    ui.surah.append(option);
  });

  surahControl = createSearchableSelect(
    ui.surah,
    'Search or select a surah…'
  );

  surahControl.setValue('1', true);
}

async function refreshReciters() {
  ui.refresh.disabled = true;
  reciterControl.disable();

  reciterControl.clear(true);
  reciterControl.clearOptions();

  status('Loading QUA catalog and manifest…');

  try {
    [manifest, catalog] = await Promise.all([
      getJSON(MANIFEST_URL),
      getJSON(CATALOG_URL)
    ]);

    const manifestEntries = manifest.recitations || {};

    recitations.clear();

    for (const entry of catalog.recitations || []) {
      const slug = entry.slug;
      if (!slug) continue;

      const manifestEntry = manifestEntries[slug];
      const audio = entry.audio || {};
      const chapterURLs = audio.chapter_urls;

      if (entry.audio_category && entry.audio_category !== 'by_surah') continue;
      if (!chapterURLs || typeof chapterURLs !== 'object' || !Object.keys(chapterURLs).length) continue;
      if (!manifestEntry?.zip_url) continue;

      const tiers = manifestEntry.tiers;

      if (Array.isArray(tiers) && !tiers.includes('word')) continue;
      if (tiers && !Array.isArray(tiers) && Object.keys(tiers).length && !tiers.word) continue;

      const name = entry.name_en || entry.name_ar || slug;
      const details = [entry.riwayah, entry.style, entry.channel]
        .filter(Boolean)
        .join(' / ');

      const label = `${name}${details ? ` | ${details}` : ''} [${slug}]`;

      recitations.set(label, {
        manifestEntry,
        catalogEntry: entry,
        slug
      });
    }

    const labels = [...recitations.keys()]
      .sort((a, b) => a.localeCompare(b));

    reciterControl.addOptions(
      labels.map(label => ({
        value: label,
        text: label
      }))
    );

    const preferred = labels.find(
      label => recitations.get(label).slug === DEFAULT_RECITER_SLUG
    ) || labels.find(
      label => (recitations.get(label).catalogEntry.name_en || '')
        .toLowerCase()
        .includes('yasser al-dosari')
    ) || labels[0];

    if (preferred) {
      reciterControl.setValue(preferred, true);
      reciterControl.enable();
      ui.play.disabled = false;
    } else {
      reciterControl.disable();
      ui.play.disabled = true;
    }

    reciterControl.refreshOptions(false);

    status(`Loaded ${labels.length} supported recitations.`);
  } catch (error) {
    reciterControl.clear(true);
    reciterControl.clearOptions();
    reciterControl.addOption({
      value: '',
      text: 'Could not load reciters'
    });
    reciterControl.disable();

    ui.play.disabled = true;

    status(
      `Could not load the QUA reciter list: ${error.message}. Check that the local proxy is running, or that QUA_PROXY_BASE points to your deployed Worker.`
    );
  } finally {
    ui.refresh.disabled = false;
  }
}

function parseRomanizedText(text) {
  const parsed = [];
  const ranges = new Map();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const match = line.match(/^(\d+)\.\s*(.*)$/);

    if (!match) {
      parsed.push({ type: 'plain', text: line });
      continue;
    }

    const ayah = Number(match[1]);
    const words = match[2].split(/\s+/).filter(Boolean);

    parsed.push({ type: 'ayah', ayah, words });
    ranges.set(ayah, words.length);
  }

  return { parsed, ranges };
}

function renderText(text) {
  const { parsed, ranges } = parseRomanizedText(text);

  wordElements = new Map();
  ui.reader.replaceChildren();

  for (const line of parsed) {
    if (line.type === 'plain') {
      const p = document.createElement('p');
      p.className = 'ayah';
      p.textContent = line.text;
      ui.reader.append(p);
      continue;
    }

    const p = document.createElement('p');
    p.className = 'ayah';
    p.dataset.ayah = String(line.ayah);

    const number = document.createElement('span');
    number.className = 'ayah-number';
    number.textContent = `${line.ayah}.`;

    p.append(number);

    const refs = [];

    line.words.forEach((word, index) => {
      const span = document.createElement('span');
      span.className = 'word';
      span.textContent = word;
      span.dataset.wordIndex = String(index + 1);
      span.dataset.ayah = String(line.ayah);

      p.append(span, document.createTextNode(' '));
      refs.push(span);
    });

    wordElements.set(line.ayah, refs);
    ui.reader.append(p);
  }

  return ranges;
}

async function loadText(chapter) {
  const response = await fetch(`./surahs/${chapter}.txt`);

  if (!response.ok) {
    throw new Error(
      `Could not find surahs/${chapter}.txt. Make sure the bundled surahs folder is included in the web project.`
    );
  }

  return response.text();
}

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);

  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function extractTimingData(manifestEntry, slug, chapter) {
  const response = await fetch(quaURL(manifestEntry.zip_url));

  if (!response.ok) {
    throw new Error(`Could not download timing archive (${response.status}).`);
  }

  const buffer = await response.arrayBuffer();

  const expectedHash = (manifestEntry.sha256 || '')
    .replace(/^sha256:/i, '')
    .toLowerCase();

  if (expectedHash) {
    const actualHash = await sha256Hex(buffer);

    if (actualHash !== expectedHash) {
      throw new Error('The timing archive failed SHA-256 verification.');
    }
  }

  status('Extracting this surah’s word timings…');

  const zip = await JSZip.loadAsync(buffer);

  const entry = Object.values(zip.files).find(
    file =>
      !file.dir &&
      file.name.split('/').pop() === 'word_timestamps.json.gz'
  );

  if (!entry) {
    throw new Error(
      'word_timestamps.json.gz was not found inside the reciter archive.'
    );
  }

  const compressed = await entry.async('uint8array');

  if (!('DecompressionStream' in window)) {
    throw new Error(
      'This browser does not support gzip decompression. Use a current version of Chrome, Edge, or Firefox.'
    );
  }

  const stream = new Blob([compressed])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));

  const fullData = JSON.parse(await new Response(stream).text());

  const prefix = `${chapter}:`;

  const rows = (fullData.rows || []).filter(
    row =>
      Array.isArray(row) &&
      row.length &&
      String(row[0]).startsWith(prefix)
  );

  if (!rows.length) {
    throw new Error(
      `The selected recitation has no word timings for surah ${chapter}.`
    );
  }

  const metadata = {
    ...(fullData._meta || {}),
    audio_category: 'by_surah',
    chapter,
    occurrence_count: rows.length,
    verse_count: new Set(rows.map(row => String(row[0]))).size
  };

  if (metadata.slug && metadata.slug !== slug) {
    throw new Error('The timing archive belongs to a different recitation.');
  }

  return {
    _meta: {
      ...metadata,
      slug,
      chapter,
      tier: 'word'
    },
    rows
  };
}

function buildSegments(data, ranges, audioOffset) {
  const built = [];

  for (const row of data.rows || []) {
    if (!Array.isArray(row) || row.length < 6) continue;

    const [verseKey, , , , , words] = row;
    const ayah = Number(String(verseKey).split(':')[1]);
    const count = ranges.get(ayah) || 0;

    for (const word of words || []) {
      if (!Array.isArray(word) || word.length !== 3) continue;

      const [wordIndex, rawStart, rawEnd] = word;

      if (!Number.isInteger(wordIndex) || wordIndex < 1 || wordIndex > count) {
        continue;
      }

      const start = Number(rawStart) + audioOffset;
      const end = Number(rawEnd) + audioOffset;

      if (end <= start) continue;

      const element = wordElements.get(ayah)?.[wordIndex - 1];

      if (element) {
        built.push({ start, end, element, ayah });
      }
    }
  }

  built.sort((a, b) => a.start - b.start);

  segments = built;
  segmentStarts = built.map(item => item.start);

  const first = new Map();

  for (const item of built) {
    if (!first.has(item.ayah)) {
      first.set(item.ayah, item.start);
    }
  }

  ayahStarts = [...first.entries()]
    .map(([ayah, start]) => ({ ayah, start }))
    .sort((a, b) => a.start - b.start);

  if (!segments.length) {
    throw new Error(
      'No usable word timings matched the bundled text. Check that the text word order matches the QUA timing data.'
    );
  }
}

async function waitForAudioMetadata() {
  if (ui.audio.readyState >= 1) return;

  await new Promise((resolve, reject) => {
    const onReady = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error('The audio file could not be loaded.'));
    };

    const cleanup = () => {
      ui.audio.removeEventListener('loadedmetadata', onReady);
      ui.audio.removeEventListener('error', onError);
    };

    ui.audio.addEventListener('loadedmetadata', onReady, { once: true });
    ui.audio.addEventListener('error', onError, { once: true });
  });
}

async function loadSurah() {
  if (loadPromise) return loadPromise;

  const chapter = Number(ui.surah.value);
  const selected = recitations.get(ui.reciter.value);

  if (!selected) {
    status('Select a recitation first.');
    return false;
  }

  const task = (async () => {
    stopPlayback();

    setControlsReady(false);
    ui.play.disabled = true;

    reciterControl.disable();
    surahControl.disable();
    ui.refresh.disabled = true;

    loadedChapter = null;
    loadedReciterSlug = null;

    segments = [];
    segmentStarts = [];
    ayahStarts = [];

    ui.loaded.textContent = 'Loading surah…';
    status('Preparing surah text and timings…');

    try {
      const text = await loadText(chapter);
      const ranges = renderText(text);

      const timingData = await extractTimingData(
        selected.manifestEntry,
        selected.slug,
        chapter
      );

      const audio = selected.catalogEntry.audio || {};
      const audioURL = audio.chapter_urls?.[String(chapter)];

      if (!audioURL) {
        throw new Error(`No audio URL is listed for surah ${chapter}.`);
      }

      const audioOffset = Number(
        audio.chapter_offsets_ms?.[String(chapter)] || 0
      );

      status('Loading audio stream…');

      ui.audio.pause();
      ui.audio.src = audioURL;
      ui.audio.load();

      await waitForAudioMetadata();

      buildSegments(timingData, ranges, audioOffset);

      loadedChapter = chapter;
      loadedReciterSlug = selected.slug;

      ui.loaded.textContent =
        `${SURAH_NAMES[chapter - 1]} · ${segments.length.toLocaleString()} timed words`;

      setControlsReady(true);

      status(
        `Loaded ${segments.length.toLocaleString()} word timings for ${selected.catalogEntry.name_en || selected.slug}, surah ${chapter}.`
      );

      return true;
    } catch (error) {
      setControlsReady(false);
      ui.play.disabled = !ui.reciter.value;

      ui.loaded.textContent = 'No surah loaded';
      status(`Could not load this surah: ${error.message}`);

      return false;
    } finally {
      reciterControl.enable();
      surahControl.enable();
      ui.refresh.disabled = false;
    }
  })();

  loadPromise = task;

  try {
    return await task;
  } finally {
    if (loadPromise === task) {
      loadPromise = null;
    }
  }
}

function findSegmentIndex(position) {
  let low = 0;
  let high = segmentStarts.length;

  while (low < high) {
    const mid = (low + high) >>> 1;

    if (segmentStarts[mid] <= position) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low - 1;
}

function scrollToWord(word) {
  const margin = 70;
  const style = getComputedStyle(ui.reader);
  const scrollable =
    /(auto|scroll)/.test(style.overflowY) &&
    ui.reader.scrollHeight > ui.reader.clientHeight + 1;

  const rect = word.getBoundingClientRect();

  if (scrollable) {
    const readerRect = ui.reader.getBoundingClientRect();

    if (rect.top < readerRect.top + margin) {
      ui.reader.scrollTop -= readerRect.top + margin - rect.top;
    } else if (rect.bottom > readerRect.bottom - margin) {
      ui.reader.scrollTop += rect.bottom - (readerRect.bottom - margin);
    }
  } else if (rect.top < margin || rect.bottom > window.innerHeight - margin) {
    window.scrollBy({
      top: rect.top - window.innerHeight / 2 + rect.height / 2,
      behavior: 'smooth'
    });
  }
}

function applyHighlight(position) {
  const index = findSegmentIndex(position);

  const item =
    index >= 0 && position < segments[index].end
      ? segments[index]
      : null;

  const next = item?.element || null;

  if (next === currentWord) return;

  currentWord?.classList.remove('active');
  currentWord = next;

  if (!currentWord) return;

  currentWord.classList.add('active');

  if (playing) scrollToWord(currentWord);
}

function clearHighlight() {
  currentWord?.classList.remove('active');
  currentWord = null;
}

function currentPosition() {
  return ui.audio.currentTime * 1000;
}

function updateLoop() {
  if (!playing) return;

  applyHighlight(currentPosition());

  if (ui.audio.ended) {
    playing = false;
    status('Recitation finished.');
    ui.play.disabled = false;
    ui.pause.disabled = true;
    return;
  }

  animationFrame = requestAnimationFrame(updateLoop);
}

async function seekAudio(position) {
  const target = Math.max(0, position / 1000);

  if (
    Math.abs(ui.audio.currentTime - target) < 0.05 &&
    !ui.audio.seeking
  ) {
    return;
  }

  await new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      ui.audio.removeEventListener('seeked', onSeeked);
      ui.audio.removeEventListener('error', onError);
    };

    const onSeeked = () => {
      if (!ui.audio.seeking) {
        cleanup();
        resolve();
      }
    };

    const onError = () => {
      cleanup();
      reject(new Error('Audio seeking failed.'));
    };

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Audio seeking timed out.'));
    }, 5000);

    ui.audio.addEventListener('seeked', onSeeked);
    ui.audio.addEventListener('error', onError);

    ui.audio.currentTime = target;

    if (
      !ui.audio.seeking &&
      Math.abs(ui.audio.currentTime - target) < 0.05
    ) {
      cleanup();
      resolve();
    }
  });
}

async function playAt(position) {
  if (!segments.length) {
    status('No surah is loaded.');
    return;
  }

  cancelAnimationFrame(animationFrame);
  clearHighlight();

  try {
    await seekAudio(position);
    await ui.audio.play();

    playing = true;
    paused = false;

    ui.play.disabled = true;
    ui.pause.disabled = false;
    ui.pause.textContent = '❚❚ Pause';

    status('Playing…');
    updateLoop();
  } catch (error) {
    status(`Playback could not start: ${error.message}`);
    ui.play.disabled = false;
  }
}

async function play() {
  if (loadPromise) {
    const loaded = await loadPromise;
    if (!loaded) return;
  }

  const chapter = Number(ui.surah.value);
  const selected = recitations.get(ui.reciter.value);

  if (!selected) {
    status('Select a recitation first.');
    return;
  }

  const alreadyLoaded =
    loadedChapter === chapter &&
    loadedReciterSlug === selected.slug &&
    segments.length > 0;

  if (!alreadyLoaded) {
    const loaded = await loadSurah();
    if (!loaded) return;
  }

  const ayah = Number(ui.ayah.value);

  if (!Number.isInteger(ayah) || ayah < 1) {
    status('Enter a valid positive ayah number.');
    return;
  }

  const item = ayahStarts.find(entry => entry.ayah === ayah);

  if (!item) {
    status(`No timing found for ayah ${ayah}.`);
    return;
  }

  await playAt(ayah === 1 ? 0 : item.start);
}

function pauseToggle() {
  if (playing) {
    ui.audio.pause();

    playing = false;
    paused = true;

    cancelAnimationFrame(animationFrame);

    ui.pause.textContent = '▶ Resume';
    status('Paused.');
  } else if (paused) {
    ui.audio.play()
      .then(() => {
        playing = true;
        paused = false;

        ui.pause.textContent = '❚❚ Pause';

        status('Playing…');
        updateLoop();
      })
      .catch(error => {
        status(`Playback could not resume: ${error.message}`);
      });
  }
}

function stopPlayback() {
  cancelAnimationFrame(animationFrame);

  ui.audio.pause();

  try {
    ui.audio.currentTime = 0;
  } catch {}

  playing = false;
  paused = false;

  clearHighlight();

  ui.play.disabled = !ui.reciter.value;
  ui.pause.disabled = true;
  ui.pause.textContent = '❚❚ Pause';

  if (segments.length) {
    status('Stopped.');
  }
}

function seekBy(delta) {
  if (!segments.length || (!playing && !paused)) {
    status('Nothing is playing.');
    return;
  }

  const max = segments[segments.length - 1].end;
  const target = Math.min(
    Math.max(currentPosition() + delta, 0),
    max
  );

  const wasPaused = paused;

  playAt(target).then(() => {
    if (wasPaused) {
      ui.audio.pause();

      playing = false;
      paused = true;

      cancelAnimationFrame(animationFrame);
      applyHighlight(target);

      ui.pause.textContent = '▶ Resume';
      status('Paused.');
    }
  });
}

function stepAyah(direction) {
  if (!segments.length || !ayahStarts.length) {
    status('Load a surah first.');
    return;
  }

  let position = (playing || paused) ? currentPosition() : null;

  if (position === null) {
    const ayah = Number(ui.ayah.value);
    const entry = ayahStarts.find(item => item.ayah === ayah);

    if (!entry) {
      status('Enter an ayah with available timings.');
      return;
    }

    position = entry.start;
  }

  let low = 0;
  let high = ayahStarts.length;

  while (low < high) {
    const mid = (low + high) >>> 1;

    if (ayahStarts[mid].start <= position) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  let index = Math.max(low - 1, 0);

  if (direction > 0) {
    index += 1;
  } else if (
    position - ayahStarts[index].start <= RESTART_THRESHOLD_MS
  ) {
    index = Math.max(index - 1, 0);
  }

  if (index < 0 || index >= ayahStarts.length) {
    status(
      direction > 0
        ? 'Already at the last ayah.'
        : 'Already at the first ayah.'
    );
    return;
  }

  const target = ayahStarts[index];

  ui.ayah.value = String(target.ayah);
  playAt(target.ayah === 1 ? 0 : target.start);
}

// Initialize searchable dropdowns.

reciterControl = createSearchableSelect(
  ui.reciter,
  'Search or select a reciter…'
);

populateSurahs();

// Event listeners.

ui.refresh.addEventListener('click', refreshReciters);

ui.reciter.addEventListener('change', () => {
  stopPlayback();

  if (loadedChapter !== null) {
    status('Recitation changed. Press Play to load the selected recitation.');
  }
});

ui.surah.addEventListener('change', () => {
  stopPlayback();

  if (loadedChapter !== null) {
    status('Surah selected. Press Play to load it.');
  }
});

ui.play.addEventListener('click', play);
ui.pause.addEventListener('click', pauseToggle);
ui.stop.addEventListener('click', stopPlayback);

ui.prev.addEventListener('click', () => stepAyah(-1));
ui.next.addEventListener('click', () => stepAyah(1));

ui.back.addEventListener('click', () => seekBy(-SEEK_STEP_MS));
ui.forward.addEventListener('click', () => seekBy(SEEK_STEP_MS));

ui.audio.addEventListener('ended', () => {
  playing = false;
  paused = false;

  cancelAnimationFrame(animationFrame);

  ui.play.disabled = false;
  ui.pause.disabled = true;

  status('Recitation finished.');
});

// Initial setup.

setControlsReady(false);
refreshReciters();
