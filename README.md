# Quran Romanization Player — Web Edition

A browser port of the CustomTkinter Quran Romanization Player. The player UI is static, but QUA release metadata and timing archives require a small CORS proxy because GitHub release downloads do not allow direct browser fetches from a different origin.

## Features

- Loads the QUA recitation catalog and manifest.
- Filters recitations to supported by-surah audio with word-level timings.
- Downloads and verifies the reciter timing archive, then extracts the selected surah's timings in the browser.
- Streams the selected surah's audio directly from its QUA URL through the browser audio player.
- Synchronizes word highlighting with the audio.
- Supports start-at-ayah, previous/next ayah, pause/resume, stop, and 5-second seeking.
- Uses Gentium Plus for the romanized reader text.

## Add your romanized text files

The source ZIP supplied for the port contained the Python `src/` directory, but not the original `surahs/` text directory. Copy your existing text files into this project's `surahs/` directory, preserving their names:

```text
surahs/
  1.txt
  2.txt
  ...
  114.txt
```

The expected format is the same as the desktop player, one ayah per line:

```text
1. first romanized ayah words
2. second romanized ayah words
```

The word order and word count on each ayah must correspond to the QUA timing data. Alternatively, use **Choose file** to load a `.txt` file manually; the selected file is used for the next load.

## Run locally

The app needs two local processes: the static file server and the QUA proxy.

Terminal 1:

```bash
cd quran-player-web
python -m http.server 8000
```

Terminal 2:

```bash
cd quran-player-web
python proxy.py
```

Then open <http://localhost:8000>. Keep both terminals running. The proxy uses only Python's standard library and forwards only HTTPS requests to the QUA GitHub release hosts.

## Publish with GitHub Pages

GitHub Pages cannot run `proxy.py`. Deploy `worker.js` as a Cloudflare Worker (free plan is sufficient for normal personal use):

1. Create a Cloudflare account and open **Workers & Pages → Create → Worker**.
2. Replace the starter code with the contents of `worker.js` and deploy it.
3. Copy the Worker URL, for example `https://qua-proxy.<your-subdomain>.workers.dev`.
4. In `app.js`, replace `QUA_PROXY_BASE` with that URL (without a trailing slash):

   ```js
   const QUA_PROXY_BASE = 'https://qua-proxy.<your-subdomain>.workers.dev';
   ```

5. Put the contents of this folder at the root of the repository, or in the directory selected for GitHub Pages.
2. Add the `surahs/` text files as described above.
3. Commit and push.
4. In GitHub, open **Settings → Pages**.
5. Under **Build and deployment**, choose **Deploy from a branch**, select your branch and the folder containing `index.html`, then save.

No build step is required. The app uses JSZip from jsDelivr to open the QUA timing archive in the browser. The browser must be online to retrieve the QUA catalog, timing archive, audio, and Gentium Plus web font. The Worker proxies only the QUA GitHub release metadata and timing ZIPs; audio continues to stream directly from the audio source URLs in the catalog.

## Notes

- Audio is streamed by the browser; it is not downloaded and cached by this static app.
- Timing archives are downloaded and processed in browser memory each time a surah is loaded. A future improvement would be caching extracted per-surah timings in IndexedDB.
- Browser playback requires a modern browser with `DecompressionStream` support (current Chrome, Edge, and Firefox).
- If the browser reports a CORS/network error while fetching a QUA catalog or timing archive, the source must permit cross-origin browser requests. A static GitHub Pages site cannot bypass a remote server's CORS policy.
