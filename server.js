const express = require('express');
const path = require('path');
const cheerio = require('cheerio');

const app = express();
const rootDir = __dirname;
const port = Number(process.env.PORT || 8080);

function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

    function cleanGeniusLyrics(rawLyrics) {
        return String(rawLyrics || '')
        .replace(/\r/g, '')
        .replace(/^\d+\s+Contributors[\s\S]*?Lyrics/, '')
            .replace(/^[\s\S]*?(?=\[(?:Verse|Chorus|Intro|Outro|Bridge|Hook|Pre-Chorus|Post-Chorus|Refrain))/i, '')
        .replace(/You might also like/gi, '')
        .replace(/Read More/gi, '')
        .replace(/\bEmbed\b.*$/gi, '')
        .replace(/\[(.+?)\]/g, '\n[$1]\n')
        .replace(/([a-z])([A-Z])/g, '$1\n$2')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }

function scoreSongHit(hit, artist, track) {
    const normalizedArtist = normalizeText(artist);
    const normalizedTrack = normalizeText(track);
    const hitArtist = normalizeText(hit.result?.primary_artist?.name);
    const hitTrack = normalizeText(hit.result?.title);

    let score = 0;
    if (hitArtist.includes(normalizedArtist) || normalizedArtist.includes(hitArtist)) {
        score += 3;
    }
    if (hitTrack.includes(normalizedTrack) || normalizedTrack.includes(hitTrack)) {
        score += 4;
    }
    if (`${hitArtist} ${hitTrack}`.includes(`${normalizedArtist} ${normalizedTrack}`)) {
        score += 2;
    }
    return score;
}

async function fetchJson(url) {
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 ZenSpace Lyrics Proxy',
            Accept: 'application/json,text/plain,*/*'
        }
    });

    if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
    }

    return response.json();
}

async function fetchText(url) {
    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 ZenSpace Lyrics Proxy',
            Accept: 'text/html,application/xhtml+xml'
        }
    });

    if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
    }

    return response.text();
}

async function searchGeniusSong(artist, track) {
    const searchUrl = `https://genius.com/api/search/song?q=${encodeURIComponent(`${artist} ${track}`)}`;
    const payload = await fetchJson(searchUrl);
    const sections = payload.response?.sections || [];
    const hits = sections.flatMap(section => section.hits || []);
    const songHits = hits
        .filter(hit => hit.type === 'song' && hit.result?.url)
        .sort((first, second) => scoreSongHit(second, artist, track) - scoreSongHit(first, artist, track));

    return songHits[0]?.result || null;
}

async function scrapeLyricsFromGenius(songUrl) {
    const html = await fetchText(songUrl);
    const $ = cheerio.load(html);
    const parts = $('[data-lyrics-container="true"]')
        .map((_, element) => $(element).text().trim())
        .get()
        .filter(Boolean);

    if (!parts.length) {
        return null;
    }

    return cleanGeniusLyrics(parts.join('\n'));
}

app.get('/api/lyrics/fallback', async (req, res) => {
    const artist = String(req.query.artist || '').trim();
    const track = String(req.query.track || '').trim();

    if (!artist || !track) {
        res.status(400).json({ error: 'artist and track are required' });
        return;
    }

    try {
        const song = await searchGeniusSong(artist, track);
        if (!song?.url) {
            res.status(404).json({ error: 'lyrics not found on genius' });
            return;
        }

        const lyrics = await scrapeLyricsFromGenius(song.url);
        if (!lyrics) {
            res.status(404).json({ error: 'lyrics not found on genius' });
            return;
        }

        res.json({
            source: 'genius',
            title: song.title,
            artist: song.primary_artist?.name || artist,
            lyrics
        });
    } catch (error) {
        res.status(502).json({ error: 'failed to fetch genius lyrics', details: error.message });
    }
});

app.use(express.static(rootDir));

app.get('*', (req, res) => {
    res.sendFile(path.join(rootDir, 'index.html'));
});

app.listen(port, () => {
    console.log(`ZenSpace server listening on port ${port}`);
});
