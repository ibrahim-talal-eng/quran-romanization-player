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
  reciter: el('reciter'), reciterSearch: el('reciter-search'), reciterMenu: el('reciter-menu'), refresh: el('refresh'),
  surah: el('surah'), surahSearch: el('surah-search'), surahMenu: el('surah-menu'), ayah: el('start-ayah'),
  file: el('text-file'), fileName: el('file-name'), load: el('load'), progress: el('load-progress'),
  reader: el('reader'), loaded: el('loaded-label'), status: el('status'), audio: el('audio'),
  play: el('play'), pause: el('pause'), stop: el('stop'), prev: el('prev-ayah'), next: el('next-ayah'),
  back: el('back-5'), forward: el('forward-5')
};

let manifest = null;
let catalog = null;
let recitations = new Map();
let selectedText = null;
let textFileName = '';
let wordElements = new Map();
let segments = [];
let segmentStarts = [];
let ayahStarts = [];
let playing = false;
let paused = false;
let currentWord = null;
let animationFrame = 0;
let loadedChapter = null;

function status(message) { ui.status.textContent = message; }
function setLoading(active) { ui.load.disabled = active; ui.progress.hidden = !active; }
function setControlsReady(ready) {
  for (const button of [ui.play, ui.pause, ui.stop, ui.prev, ui.next, ui.back, ui.forward]) button.disabled = !ready;
  ui.pause.textContent = '❚❚ Pause';
}
async function getJSON(url) {
  const response = await fetch(quaURL(url), { cache: 'no-store' });
  if (!response.ok) throw new Error(`Request failed (${response.status}): ${url}`);
  return response.json();
}

function populateSurahs() {
  SURAH_NAMES.forEach((name, index) => {
    const option = document.createElement('option');
    option.value = String(index + 1);
    option.textContent = `${index + 1}. ${name}`;
    ui.surah.append(option);
  });
  ui.surah.value = '1';
  ui.surahSearch.value = ui.surah.selectedOptions[0]?.textContent || '';
  renderComboMenu(ui.surah, ui.surahSearch, ui.surahMenu);
}

function renderComboMenu(select, input, menu) {
  const query = input.value.trim().toLocaleLowerCase();
  const matches = [...select.options].filter(option =>
    option.value && option.textContent.toLocaleLowerCase().includes(query)
  );
  menu.replaceChildren();
  if (!matches.length) {
    const empty = document.createElement('div');
    empty.className = 'combo-empty';
    empty.textContent = 'No matches found';
    menu.append(empty);
    return;
  }
  for (const option of matches) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'combo-option';
    item.textContent = option.textContent;
    item.setAttribute('role', 'option');
    item.addEventListener('mousedown', event => event.preventDefault());
    item.addEventListener('click', () => {
      select.value = option.value;
      input.value = option.textContent;
      menu.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    menu.append(item);
  }
}

function setupCombo(select, input, menu) {
  const open = () => {
    if (input.disabled) return;
    renderComboMenu(select, input, menu);
    menu.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };
  input.addEventListener('focus', open);
  input.addEventListener('click', open);
  input.addEventListener('input', open);
  input.addEventListener('keydown', event => {
    const items = [...menu.querySelectorAll('.combo-option')];
    const active = menu.querySelector('.combo-option[aria-selected="true"]');
    let index = items.indexOf(active);
    if (event.key === 'ArrowDown' && items.length) {
      event.preventDefault();
      index = Math.min(index + 1, items.length - 1);
      items.forEach((item, i) => item.setAttribute('aria-selected', String(i === index)));
      items[index].scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'ArrowUp' && items.length) {
      event.preventDefault();
      index = index < 0 ? items.length - 1 : Math.max(index - 1, 0);
      items.forEach((item, i) => item.setAttribute('aria-selected', String(i === index)));
      items[index].scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter' && items.length) {
      event.preventDefault();
      (items[index < 0 ? 0 : index]).click();
    } else if (event.key === 'Escape') {
      menu.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.value = select.selectedOptions[0]?.textContent || '';
    }
  });
  document.addEventListener('click', event => {
    if (!event.target.closest(`#${input.id}-wrap`)) {
      menu.hidden = true;
      input.setAttribute('aria-expanded', 'false');
    }
  });
}

async function refreshReciters() {
  ui.refresh.disabled = true;
  ui.reciter.disabled = true;
  ui.reciterSearch.disabled = true;
  ui.reciterSearch.value = '';
  ui.reciterSearch.placeholder = 'Loading reciters…';
  ui.reciterMenu.hidden = true;
  ui.reciter.replaceChildren();
  status('Loading QUA catalog and manifest…');
  try {
    [manifest, catalog] = await Promise.all([getJSON(MANIFEST_URL), getJSON(CATALOG_URL)]);
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
      const details = [entry.riwayah, entry.style, entry.channel].filter(Boolean).join(' / ');
      const label = `${name}${details ? ` | ${details}` : ''} [${slug}]`;
      recitations.set(label, { manifestEntry, catalogEntry: entry, slug });
    }
    const labels = [...recitations.keys()].sort((a, b) => a.localeCompare(b));
    ui.reciter.replaceChildren();
    for (const label of labels) {
      const option = document.createElement('option'); option.value = label; option.textContent = label; ui.reciter.append(option);
    }
    const preferred = labels.find(label => recitations.get(label).slug === DEFAULT_RECITER_SLUG)
      || labels.find(label => (recitations.get(label).catalogEntry.name_en || '').toLowerCase().includes('yasser al-dosari'))
      || labels[0];
    if (preferred) {
      ui.reciter.value = preferred;
      ui.reciterSearch.value = preferred;
    }
    ui.reciter.disabled = !labels.length;
    ui.reciterSearch.disabled = !labels.length;
    ui.reciterSearch.placeholder = labels.length ? 'Search or select a reciter…' : 'No supported reciters found';
    renderComboMenu(ui.reciter, ui.reciterSearch, ui.reciterMenu);
    status(`Loaded ${labels.length} supported recitations.`);
  } catch (error) {
    status(`Could not load the QUA reciter list: ${error.message}. Check that the local proxy is running, or that QUA_PROXY_BASE points to your deployed Worker.`);
    ui.reciter.replaceChildren(new Option('Could not load reciters', ''));
    ui.reciterSearch.value = '';
    ui.reciterSearch.placeholder = 'Could not load reciters';
    ui.reciterSearch.disabled = true;
    ui.reciterMenu.replaceChildren();
    ui.reciterMenu.hidden = true;
  } finally { ui.refresh.disabled = false; }
}

function parseRomanizedText(text) {
  const parsed = [];
  const ranges = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = line.match(/^(\d+)\.\s*(.*)$/);
    if (!match) { parsed.push({ type: 'plain', text: line }); continue; }
    const ayah = Number(match[1]);
    const words = match[2].split(/\s+/).filter(Boolean);
    parsed.push({ type: 'ayah', ayah, words });
    ranges.set(ayah, words.length);
  }
  return { parsed, ranges };
}

function renderText(text) {
  const { parsed } = parseRomanizedText(text);
  wordElements = new Map();
  ui.reader.replaceChildren();
  for (const line of parsed) {
    if (line.type === 'plain') {
      const p = document.createElement('p'); p.className = 'ayah'; p.textContent = line.text; ui.reader.append(p); continue;
    }
    const p = document.createElement('p'); p.className = 'ayah'; p.dataset.ayah = String(line.ayah);
    const number = document.createElement('span'); number.className = 'ayah-number'; number.textContent = `${line.ayah}.`;
    p.append(number);
    const refs = [];
    line.words.forEach((word, index) => {
      const span = document.createElement('span'); span.className = 'word'; span.textContent = word;
      span.dataset.wordIndex = String(index + 1); span.dataset.ayah = String(line.ayah);
      p.append(span, document.createTextNode(' ')); refs.push(span);
    });
    wordElements.set(line.ayah, refs);
    ui.reader.append(p);
  }
  return parseRomanizedText(text).ranges;
}

async function loadText(chapter) {
  if (selectedText !== null) return selectedText;
  const response = await fetch(`./surahs/${chapter}.txt`);
  if (!response.ok) throw new Error(`Could not find surahs/${chapter}.txt. Add your surahs folder to the web project or choose a text file.`);
  return response.text();
}

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function extractTimingData(manifestEntry, slug, chapter) {
  const response = await fetch(quaURL(manifestEntry.zip_url));
  if (!response.ok) throw new Error(`Could not download timing archive (${response.status}).`);
  const buffer = await response.arrayBuffer();
  const expectedHash = (manifestEntry.sha256 || '').replace(/^sha256:/i, '').toLowerCase();
  if (expectedHash) {
    const actualHash = await sha256Hex(buffer);
    if (actualHash !== expectedHash) throw new Error('The timing archive failed SHA-256 verification.');
  }
  status('Extracting this surah’s word timings…');
  const zip = await JSZip.loadAsync(buffer);
  const entry = Object.values(zip.files).find(file => !file.dir && file.name.split('/').pop() === 'word_timestamps.json.gz');
  if (!entry) throw new Error('word_timestamps.json.gz was not found inside the reciter archive.');
  const compressed = await entry.async('uint8array');
  if (!('DecompressionStream' in window)) throw new Error('This browser does not support gzip decompression. Use a current version of Chrome, Edge, or Firefox.');
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
  const fullData = JSON.parse(await new Response(stream).text());
  const prefix = `${chapter}:`;
  const rows = (fullData.rows || []).filter(row => Array.isArray(row) && row.length && String(row[0]).startsWith(prefix));
  if (!rows.length) throw new Error(`The selected recitation has no word timings for surah ${chapter}.`);
  const metadata = { ...(fullData._meta || {}), audio_category: 'by_surah', chapter, occurrence_count: rows.length,
    verse_count: new Set(rows.map(row => String(row[0]))).size };
  if (metadata.slug && metadata.slug !== slug) throw new Error('The timing archive belongs to a different recitation.');
  return { _meta: { ...metadata, slug, chapter, tier: 'word' }, rows };
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
      if (!Number.isInteger(wordIndex) || wordIndex < 1 || wordIndex > count) continue;
      const start = Number(rawStart) + audioOffset;
      const end = Number(rawEnd) + audioOffset;
      if (end <= start) continue;
      const element = wordElements.get(ayah)?.[wordIndex - 1];
      if (element) built.push({ start, end, element, ayah });
    }
  }
  built.sort((a, b) => a.start - b.start);
  segments = built;
  segmentStarts = built.map(item => item.start);
  const first = new Map();
  for (const item of built) if (!first.has(item.ayah)) first.set(item.ayah, item.start);
  ayahStarts = [...first.entries()].map(([ayah, start]) => ({ ayah, start })).sort((a, b) => a.start - b.start);
  if (!segments.length) throw new Error('No usable word timings matched the selected text file. Check that its word order matches the QUA timing data.');
}

async function waitForAudioMetadata() {
  if (ui.audio.readyState >= 1) return;
  await new Promise((resolve, reject) => {
    const onReady = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error('The audio file could not be loaded.')); };
    const cleanup = () => { ui.audio.removeEventListener('loadedmetadata', onReady); ui.audio.removeEventListener('error', onError); };
    ui.audio.addEventListener('loadedmetadata', onReady, { once: true });
    ui.audio.addEventListener('error', onError, { once: true });
  });
}

async function loadSurah() {
  if (ui.load.disabled) return;
  const chapter = Number(ui.surah.value);
  const selected = recitations.get(ui.reciter.value);
  if (!selected) { status('Select a recitation first.'); return; }
  stopPlayback(); setLoading(true); status('Preparing surah text and timings…');
  try {
    const text = await loadText(chapter);
    const ranges = renderText(text);
    const timingData = await extractTimingData(selected.manifestEntry, selected.slug, chapter);
    const audio = selected.catalogEntry.audio || {};
    const audioURL = audio.chapter_urls?.[String(chapter)];
    if (!audioURL) throw new Error(`No audio URL is listed for surah ${chapter}.`);
    const audioOffset = Number(audio.chapter_offsets_ms?.[String(chapter)] || 0);
    status('Loading audio stream…');
    ui.audio.pause(); ui.audio.src = audioURL; ui.audio.load();
    await waitForAudioMetadata();
    buildSegments(timingData, ranges, audioOffset);
    loadedChapter = chapter;
    ui.loaded.textContent = `${SURAH_NAMES[chapter - 1]} · ${segments.length.toLocaleString()} timed words`;
    setControlsReady(true);
    status(`Loaded ${segments.length.toLocaleString()} word timings for ${selected.catalogEntry.name_en || selected.slug}, surah ${chapter}.`);
  } catch (error) {
    setControlsReady(false);
    status(`Could not load this surah: ${error.message}`);
  } finally { setLoading(false); }
}

function findSegmentIndex(position) {
  let low = 0, high = segmentStarts.length;
  while (low < high) { const mid = (low + high) >>> 1; if (segmentStarts[mid] <= position) low = mid + 1; else high = mid; }
  return low - 1;
}

function applyHighlight(position) {
  const index = findSegmentIndex(position);
  const item = index >= 0 && position < segments[index].end ? segments[index] : null;
  const next = item?.element || null;

  if (next === currentWord) return;

  currentWord?.classList.remove('active');
  currentWord = next;

  if (!currentWord) return;

  currentWord.classList.add('active');

  if (playing) {
    const rect = currentWord.getBoundingClientRect();
    const readerRect = ui.reader.getBoundingClientRect();

    const margin = 70;

    if (rect.top < readerRect.top + margin) {
      ui.reader.scrollTop -= readerRect.top + margin - rect.top;
    } else if (rect.bottom > readerRect.bottom - margin) {
      ui.reader.scrollTop += rect.bottom - (readerRect.bottom - margin);
    }
  }
}

function clearHighlight() { currentWord?.classList.remove('active'); currentWord = null; }
function currentPosition() { return ui.audio.currentTime * 1000; }
function updateLoop() {
  if (!playing) return;
  applyHighlight(currentPosition());
  if (ui.audio.ended) { playing = false; status('Recitation finished.'); ui.play.disabled = false; ui.pause.disabled = true; return; }
  animationFrame = requestAnimationFrame(updateLoop);
}
async function playAt(position) {
  if (!segments.length) { status('Load a surah first.'); return; }
  cancelAnimationFrame(animationFrame); clearHighlight();
  try {
    ui.audio.currentTime = Math.max(0, position / 1000);
    await ui.audio.play();
    playing = true; paused = false;
    ui.play.disabled = true; ui.pause.disabled = false; ui.pause.textContent = '❚❚ Pause';
    status('Playing…'); updateLoop();
  } catch (error) { status(`Playback could not start: ${error.message}`); }
}
function play() {
  const ayah = Number(ui.ayah.value);
  if (!Number.isInteger(ayah) || ayah < 1) { status('Enter a valid positive ayah number.'); return; }
  const item = ayahStarts.find(entry => entry.ayah === ayah);
  if (!item) { status(`No timing found for ayah ${ayah}.`); return; }
  playAt(ayah === 1 ? 0 : item.start);
}
function pauseToggle() {
  if (playing) {
    ui.audio.pause(); playing = false; paused = true; cancelAnimationFrame(animationFrame);
    ui.pause.textContent = '▶ Resume'; status('Paused.');
  } else if (paused) {
    ui.audio.play().then(() => { playing = true; paused = false; ui.pause.textContent = '❚❚ Pause'; status('Playing…'); updateLoop(); })
      .catch(error => status(`Playback could not resume: ${error.message}`));
  }
}
function stopPlayback() {
  cancelAnimationFrame(animationFrame); ui.audio.pause();
  try { ui.audio.currentTime = 0; } catch {}
  playing = false; paused = false; clearHighlight();
  ui.play.disabled = !segments.length; ui.pause.disabled = true; ui.pause.textContent = '❚❚ Pause';
  if (segments.length) status('Stopped.');
}
function seekBy(delta) {
  if (!segments.length || (!playing && !paused)) { status('Nothing is playing.'); return; }
  const max = segments[segments.length - 1].end;
  const target = Math.min(Math.max(currentPosition() + delta, 0), max);
  const wasPaused = paused;
  playAt(target).then(() => { if (wasPaused) { ui.audio.pause(); playing = false; paused = true; cancelAnimationFrame(animationFrame); applyHighlight(target); ui.pause.textContent = '▶ Resume'; status('Paused.'); } });
}
function stepAyah(direction) {
  if (!segments.length || !ayahStarts.length) { status('Load a surah first.'); return; }
  let position = (playing || paused) ? currentPosition() : null;
  if (position === null) {
    const ayah = Number(ui.ayah.value);
    const entry = ayahStarts.find(item => item.ayah === ayah);
    if (!entry) { status('Enter an ayah with available timings.'); return; }
    position = entry.start;
  }
  let low = 0, high = ayahStarts.length;
  while (low < high) { const mid = (low + high) >>> 1; if (ayahStarts[mid].start <= position) low = mid + 1; else high = mid; }
  let index = Math.max(low - 1, 0);
  if (direction > 0) index += 1;
  else if (position - ayahStarts[index].start <= RESTART_THRESHOLD_MS) index = Math.max(index - 1, 0);
  if (index < 0 || index >= ayahStarts.length) { status(direction > 0 ? 'Already at the last ayah.' : 'Already at the first ayah.'); return; }
  const target = ayahStarts[index]; ui.ayah.value = String(target.ayah);
  playAt(target.ayah === 1 ? 0 : target.start);
}

setupCombo(ui.reciter, ui.reciterSearch, ui.reciterMenu);
setupCombo(ui.surah, ui.surahSearch, ui.surahMenu);

ui.refresh.addEventListener('click', refreshReciters);
ui.reciter.addEventListener('change', () => { ui.reciterSearch.value = ui.reciter.selectedOptions[0]?.textContent || ''; stopPlayback(); if (loadedChapter) status('Recitation changed. Load audio and timings again.'); });
ui.surah.addEventListener('change', () => { ui.surahSearch.value = ui.surah.selectedOptions[0]?.textContent || ''; stopPlayback(); if (loadedChapter) status('Surah selected. Load audio and timings when ready.'); });
ui.file.addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return;
  selectedText = await file.text(); textFileName = file.name; ui.fileName.textContent = textFileName;
  status(`Selected ${textFileName}. It will be used for the next surah load.`);
});
ui.load.addEventListener('click', loadSurah);
ui.play.addEventListener('click', play);
ui.pause.addEventListener('click', pauseToggle);
ui.stop.addEventListener('click', stopPlayback);
ui.prev.addEventListener('click', () => stepAyah(-1));
ui.next.addEventListener('click', () => stepAyah(1));
ui.back.addEventListener('click', () => seekBy(-SEEK_STEP_MS));
ui.forward.addEventListener('click', () => seekBy(SEEK_STEP_MS));
ui.audio.addEventListener('ended', () => { playing = false; paused = false; cancelAnimationFrame(animationFrame); ui.play.disabled = false; ui.pause.disabled = true; status('Recitation finished.'); });

populateSurahs(); setControlsReady(false); refreshReciters();
