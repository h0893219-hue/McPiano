const ENABLE_MIDI_FILE_UPLOAD = true;

let ws = null;
let midiAccess = null;
let selectedInput = null;
let authorized = false;
let keepAliveInterval = null;
let usingVirtualPiano = false;
let virtualPianoKeys = {};
let isDragging = false;
let lastPlayedNote = null;
let pressedKeys = new Set();

let midiFileData = null;
let isPlaying = false;
let isPaused = false;
let playbackStartTime = 0;
let currentPlaybackTime = 0;
let scheduledNotes = [];
let playbackInterval = null;
let midiFileName = '';
let midiTotalDuration = 0;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const STORAGE_KEY_MIDI_DEVICE = 'piano_last_midi_device';
const STORAGE_KEY_INSTRUMENT = 'piano_instrument';

const KEYBOARD_TO_MIDI = {
    'q': 60,
    'w': 62,
    'e': 64,
    'r': 65,
    't': 67,
    'y': 69,
    'u': 71,
    'i': 72,
    'o': 74,
    'p': 76,
    '1': 61,
    '2': 63,
    '3': 66,
    '4': 68,
    '5': 70,
    '6': 73,
    '7': 75,
    '8': 77,
    '9': 78,
    '0': 79,
    'z': 48,
    'x': 50,
    'c': 52,
    'v': 53,
    'b': 55,
    'n': 57,
    'm': 59,
    ',': 60,
    '.': 62,
    '-': 64,
    'a': 49,
    's': 51,
    'd': 54,
    'f': 56,
    'g': 58,
    'h': 61,
    'j': 63,
    'k': 65,
    'l': 66,
};

const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss' : 'ws';
const WS_URL = `${WS_PROTOCOL}://${window.location.host}/piano`;

function getNoteInfo(midiNote) {
    const octave = Math.floor(midiNote / 12) - 1;
    const noteName = NOTE_NAMES[midiNote % 12];
    return {name: noteName, octave: octave, fullName: noteName + octave};
}

function showProfile(username, uuid) {
    const profileCard = document.getElementById('profileCard');
    const playerHead = document.getElementById('playerHead');
    const playerName = document.getElementById('playerName');

    playerName.textContent = username;
    playerHead.src = `https://laby.net/texture/profile/head/${uuid}.png?size=128`;
    playerHead.alt = username;
    profileCard.style.display = 'flex';

    const instrumentContainer = document.getElementById('instrumentContainer');
    const instrumentSelect = document.getElementById('instrumentSelect');
    instrumentContainer.style.display = 'flex';
    try {
        const saved = localStorage.getItem(STORAGE_KEY_INSTRUMENT);
        if (saved) {
            instrumentSelect.value = saved;
        }
    } catch {
    }

    if (ENABLE_MIDI_FILE_UPLOAD) {
        document.getElementById('midiPlayerContainer').style.display = 'block';
    }
}

function hideProfile() {
    document.getElementById('profileCard').style.display = 'none';
    document.getElementById('midiPlayerContainer').style.display = 'none';
}

function modal(title, bodyNodeOrHtml, actions) {
    const overlay = document.getElementById('modalOverlay');
    const titleEl = document.getElementById('modalTitle');
    const bodyEl = document.getElementById('modalBody');
    const actionsEl = document.getElementById('modalActions');
    titleEl.textContent = title;
    if (typeof bodyNodeOrHtml === 'string') {
        bodyEl.innerHTML = bodyNodeOrHtml;
    } else {
        bodyEl.innerHTML = '';
        bodyEl.appendChild(bodyNodeOrHtml);
    }
    actionsEl.innerHTML = '';
    (actions || []).forEach(a => {
        const btn = document.createElement('button');
        btn.textContent = a.label;
        if (a.secondary) btn.classList.add('secondary');
        btn.addEventListener('click', a.onClick);
        actionsEl.appendChild(btn);
    });
    overlay.style.display = 'flex';
}

function closeModal() {
    document.getElementById('modalOverlay').style.display = 'none';
}

function showNotInRangePopup() {
    modal(
        'Not sitting at the piano',
        'Sit on the chair in front of the piano in Minecraft and click Retry.',
        [
            {
                label: 'Retry', onClick: () => {
                    closeModal();
                    retryConnect();
                }
            }
        ]
    );
}

function showDevicePickerPopup() {
    const container = document.createElement('div');
    const list = document.createElement('div');
    list.id = 'devicePickerList';
    container.appendChild(list);

    const refreshList = async () => {
        list.innerHTML = '';

        const virtualItem = document.createElement('div');
        virtualItem.className = 'device-item';
        virtualItem.textContent = 'Virtual Piano';

        const lastDeviceName = localStorage.getItem(STORAGE_KEY_MIDI_DEVICE);
        if (lastDeviceName === 'Virtual Piano') {
            virtualItem.classList.add('selected');
        }

        virtualItem.addEventListener('click', () => {
            document.querySelectorAll('#devicePickerList .device-item')
                .forEach(d => d.classList.remove('selected'));
            virtualItem.classList.add('selected');
            connectVirtualPiano();
            closeModal();
        });
        list.appendChild(virtualItem);

        try {
            const access = midiAccess || await navigator.requestMIDIAccess();
            midiAccess = access;
            const inputs = Array.from(access.inputs.values());

            if (inputs.length === 0) {
                const p = document.createElement('p');
                p.textContent = 'No physical MIDI devices found.';
                p.style.marginTop = '10px';
                p.style.fontSize = '0.9em';
                p.style.color = '#aaa';
                list.appendChild(p);
            } else {
                inputs.forEach(input => {
                    const item = document.createElement('div');
                    item.className = 'device-item';
                    item.textContent = input.name || 'Unknown Device';

                    if (input.name === lastDeviceName) {
                        item.classList.add('selected');
                    }

                    item.addEventListener('click', () => {
                        document.querySelectorAll('#devicePickerList .device-item')
                            .forEach(d => d.classList.remove('selected'));
                        item.classList.add('selected');
                        connectMidiDevice(input);
                        closeModal();
                    });
                    list.appendChild(item);
                });
            }
        } catch (e) {
            const p = document.createElement('p');
            p.textContent = 'MIDI access denied. Physical MIDI devices unavailable.';
            p.style.marginTop = '10px';
            p.style.fontSize = '0.9em';
            p.style.color = '#fbbf24';
            list.appendChild(p);
        }
    };

    modal('Choose your MIDI device', container, [
        {label: 'Refresh', secondary: true, onClick: refreshList}
    ]);
    refreshList();
}

function retryConnect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        try {
            ws.close();
        } catch {
        }
    }
    setTimeout(connectWebSocket, 250);
}

function parseMIDIFile(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    let offset = 0;

    const ensureBytes = (count) => {
        if (offset + count > view.byteLength) {
            throw new Error('Unexpected end of MIDI file');
        }
    };

    const readChunkType = () => {
        ensureBytes(4);
        return String.fromCharCode(
            view.getUint8(offset++),
            view.getUint8(offset++),
            view.getUint8(offset++),
            view.getUint8(offset++)
        );
    };

    const headerType = readChunkType();
    if (headerType !== 'MThd') {
        throw new Error('Invalid MIDI file: Missing MThd header');
    }

    ensureBytes(10);
    const headerLength = view.getUint32(offset); offset += 4;
    if (headerLength < 6) {
        throw new Error('Invalid MIDI header length');
    }

    const headerEnd = offset + headerLength;
    const format = view.getUint16(offset); offset += 2;
    const trackCount = view.getUint16(offset); offset += 2;
    const timeDivision = view.getUint16(offset); offset += 2;
    offset = headerEnd;

    if (timeDivision & 0x8000) {
        throw new Error('SMPTE time division is not supported');
    }

    const ticksPerBeat = timeDivision;
    if (!ticksPerBeat) {
        throw new Error('Invalid MIDI time division');
    }

    const tracks = [];
    const tempoEvents = [];
    let durationTicks = 0;

    for (let i = 0; i < trackCount; i++) {
        const trackType = readChunkType();
        if (trackType !== 'MTrk') {
            throw new Error('Invalid MIDI track header');
        }

        ensureBytes(4);
        const trackLength = view.getUint32(offset); offset += 4;
        const trackEnd = offset + trackLength;
        if (trackEnd > view.byteLength) {
            throw new Error('Invalid MIDI track length');
        }

        const events = [];
        let currentTime = 0;
        let runningStatus = 0;

        while (offset < trackEnd) {
            const deltaTime = readVariableLength(view, offset, trackEnd);
            offset = deltaTime.offset;
            currentTime += deltaTime.value;
            durationTicks = Math.max(durationTicks, currentTime);

            if (offset >= trackEnd) {
                throw new Error('Incomplete MIDI event');
            }

            let status = view.getUint8(offset);
            if (status < 0x80) {
                if (!runningStatus) {
                    throw new Error('Invalid MIDI running status');
                }
                status = runningStatus;
            } else {
                offset++;
                if (status < 0xF0) {
                    runningStatus = status;
                }
            }

            const eventType = status & 0xF0;
            const channel = status & 0x0F;

            if (eventType === 0x80 || eventType === 0x90) {
                if (offset + 2 > trackEnd) throw new Error('Incomplete note event');
                const note = view.getUint8(offset++);
                const velocity = view.getUint8(offset++);
                events.push({
                    time: currentTime,
                    type: (eventType === 0x90 && velocity > 0) ? 'noteOn' : 'noteOff',
                    note,
                    velocity,
                    channel
                });
            } else if (eventType === 0xA0 || eventType === 0xB0 || eventType === 0xE0) {
                if (offset + 2 > trackEnd) throw new Error('Incomplete MIDI event');
                offset += 2;
            } else if (eventType === 0xC0 || eventType === 0xD0) {
                if (offset + 1 > trackEnd) throw new Error('Incomplete MIDI event');
                offset += 1;
            } else if (status === 0xFF) {
                if (offset >= trackEnd) throw new Error('Incomplete meta event');
                const metaType = view.getUint8(offset++);
                const length = readVariableLength(view, offset, trackEnd);
                offset = length.offset;
                if (offset + length.value > trackEnd) throw new Error('Incomplete meta event data');

                if (metaType === 0x51 && length.value === 3) {
                    const microsecondsPerBeat =
                        (view.getUint8(offset) << 16) |
                        (view.getUint8(offset + 1) << 8) |
                        view.getUint8(offset + 2);
                    tempoEvents.push({time: currentTime, microsecondsPerBeat});
                }

                offset += length.value;
                if (metaType === 0x2F) {
                    offset = trackEnd;
                }
            } else if (status === 0xF0 || status === 0xF7) {
                runningStatus = 0;
                const length = readVariableLength(view, offset, trackEnd);
                offset = length.offset;
                if (offset + length.value > trackEnd) throw new Error('Incomplete SysEx event');
                offset += length.value;
            } else {
                throw new Error(`Unsupported MIDI event: 0x${status.toString(16)}`);
            }
        }

        offset = trackEnd;
        tracks.push(events);
    }

    return {format, trackCount, ticksPerBeat, tracks, tempoEvents, durationTicks};
}

function readVariableLength(view, offset, limit = view.byteLength) {
    let value = 0;
    let byte = 0;
    let count = 0;

    do {
        if (offset >= limit || count >= 4) {
            throw new Error('Invalid variable-length MIDI value');
        }
        byte = view.getUint8(offset++);
        value = (value << 7) | (byte & 0x7F);
        count++;
    } while (byte & 0x80);

    return {value, offset};
}

function createTempoMap(midiData) {
    const tempos = [...midiData.tempoEvents]
        .filter(event => event.microsecondsPerBeat > 0)
        .sort((a, b) => a.time - b.time);

    const map = [{tick: 0, timeMs: 0, microsecondsPerBeat: 500000}];
    let lastTick = 0;
    let timeMs = 0;
    let currentTempo = 500000;

    tempos.forEach(tempo => {
        if (tempo.time < lastTick) return;

        timeMs += ((tempo.time - lastTick) * currentTempo) /
            midiData.ticksPerBeat / 1000;
        lastTick = tempo.time;
        currentTempo = tempo.microsecondsPerBeat;

        if (map[map.length - 1].tick === tempo.time) {
            map[map.length - 1] = {
                tick: tempo.time,
                timeMs,
                microsecondsPerBeat: currentTempo
            };
        } else {
            map.push({
                tick: tempo.time,
                timeMs,
                microsecondsPerBeat: currentTempo
            });
        }
    });

    return map;
}

function ticksToMilliseconds(tick, tempoMap, ticksPerBeat) {
    let left = 0;
    let right = tempoMap.length - 1;
    let segment = tempoMap[0];

    while (left <= right) {
        const middle = Math.floor((left + right) / 2);
        if (tempoMap[middle].tick <= tick) {
            segment = tempoMap[middle];
            left = middle + 1;
        } else {
            right = middle - 1;
        }
    }

    return segment.timeMs +
        ((tick - segment.tick) * segment.microsecondsPerBeat) /
        ticksPerBeat / 1000;
}

function prepareMIDIPlayback(midiData) {
    const tempoMap = createTempoMap(midiData);
    const notes = [];

    midiData.tracks.forEach(track => {
        track.forEach(event => {
            if (event.type === 'noteOn') {
                notes.push({
                    time: ticksToMilliseconds(event.time, tempoMap, midiData.ticksPerBeat),
                    note: event.note,
                    velocity: event.velocity
                });
            }
        });
    });

    notes.sort((a, b) => a.time - b.time);
    scheduledNotes = notes;
    midiTotalDuration = ticksToMilliseconds(
        midiData.durationTicks,
        tempoMap,
        midiData.ticksPerBeat
    );

    if (notes.length && midiTotalDuration < notes[notes.length - 1].time) {
        midiTotalDuration = notes[notes.length - 1].time;
    }
}

function handleMIDIFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    midiFileName = file.name;
    document.getElementById('midiFileName').textContent = `♪ ${midiFileName}`;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            midiFileData = parseMIDIFile(e.target.result);
            prepareMIDIPlayback(midiFileData);

            if (!scheduledNotes.length) {
                throw new Error('The MIDI file does not contain any note events');
            }

            document.getElementById('midiControls').style.display = 'block';
            document.getElementById('totalTime').textContent = formatTime(midiTotalDuration / 1000);
            document.getElementById('midiInfo').textContent =
                `${midiFileData.trackCount} track(s), ${midiFileData.ticksPerBeat} ticks/beat, ${scheduledNotes.length} notes`;

            stopMIDIPlayback();
        } catch (error) {
            console.error('Failed to parse MIDI file:', error);
            alert('Failed to parse MIDI file: ' + error.message);
            midiFileData = null;
            scheduledNotes = [];
            document.getElementById('midiFileName').textContent = '⚠ Invalid MIDI file';
            document.getElementById('midiControls').style.display = 'none';
        }
    };

    reader.onerror = () => {
        alert('The MIDI file could not be read.');
    };

    reader.readAsArrayBuffer(file);
}

function playMIDIFile() {
    if (!midiFileData || !scheduledNotes.length || !authorized) {
        alert('Please upload a MIDI file and ensure you are connected to the piano.');
        return;
    }

    if (isPlaying && !isPaused) {
        isPaused = true;
        isPlaying = false;
        if (playbackInterval) {
            clearInterval(playbackInterval);
            playbackInterval = null;
        }
        document.getElementById('playPauseBtn').textContent = '▶ Play';
        return;
    }

    if (currentPlaybackTime >= midiTotalDuration) {
        currentPlaybackTime = 0;
    }

    isPlaying = true;
    isPaused = false;
    document.getElementById('playPauseBtn').textContent = '⏸ Pause';

    const eventsToPlay = scheduledNotes.filter(event => event.time >= currentPlaybackTime);
    if (!eventsToPlay.length) {
        stopMIDIPlayback();
        return;
    }

    playbackStartTime = performance.now() - currentPlaybackTime;
    let eventIndex = 0;

    playbackInterval = setInterval(() => {
        currentPlaybackTime = performance.now() - playbackStartTime;

        document.getElementById('currentTime').textContent = formatTime(currentPlaybackTime / 1000);
        const progress = midiTotalDuration > 0
            ? Math.min(100, (currentPlaybackTime / midiTotalDuration) * 100)
            : 0;
        document.getElementById('progressBar').style.width = progress + '%';

        while (eventIndex < eventsToPlay.length &&
               eventsToPlay[eventIndex].time <= currentPlaybackTime) {
            const midiEvent = eventsToPlay[eventIndex];
            playNote(midiEvent.note, midiEvent.velocity);
            eventIndex++;
        }

        if (currentPlaybackTime >= midiTotalDuration) {
            stopMIDIPlayback();
        }
    }, 5);
}

function stopMIDIPlayback() {
    isPlaying = false;
    isPaused = false;
    currentPlaybackTime = 0;
    playbackStartTime = 0;

    if (playbackInterval) {
        clearInterval(playbackInterval);
        playbackInterval = null;
    }

    const playPauseBtn = document.getElementById('playPauseBtn');
    const currentTime = document.getElementById('currentTime');
    const progressBar = document.getElementById('progressBar');
    if (playPauseBtn) playPauseBtn.textContent = '▶ Play';
    if (currentTime) currentTime.textContent = '0:00';
    if (progressBar) progressBar.style.width = '0%';
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function startKeepAlive() {
    stopKeepAlive();
    keepAliveInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(JSON.stringify({type: 'ping'}));
            } catch (e) {
                console.error('Keep-alive ping failed:', e);
            }
        }
    }, 1000 * 5);
}

function stopKeepAlive() {
    if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
    }
}

function connectWebSocket() {
    authorized = false;
    hideProfile();
    stopKeepAlive();

    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
        startKeepAlive();
    };
    ws.onclose = () => {
        authorized = false;
        hideProfile();
        stopKeepAlive();
        stopMIDIPlayback();
        showNotInRangePopup();
    };
    ws.onerror = () => {
        stopKeepAlive();
    };
    ws.onmessage = async (event) => {
        let data;
        try {
            data = JSON.parse(event.data);
        } catch {
            return;
        }

        switch (data.type) {
            case 'authorized':
                authorized = true;
                closeModal();
                showProfile(data.username, data.uuid);
                const autoConnected = await tryAutoConnectMidiDevice();
                if (!autoConnected) {
                    showDevicePickerPopup();
                }
                break;
            case 'unauthorized':
                authorized = false;
                hideProfile();
                stopMIDIPlayback();
                showNotInRangePopup();
                break;
        }
    };
}

function connectMidiDevice(input) {
    console.log('Connecting to MIDI device:', input.name);

    if (selectedInput) {
        selectedInput.onmidimessage = null;
    }
    selectedInput = input;
    usingVirtualPiano = false;
    hideVirtualPiano();

    try {
        localStorage.setItem(STORAGE_KEY_MIDI_DEVICE, input.name || '');
    } catch (e) {
        console.warn('Failed to save MIDI device preference:', e);
    }

    document.getElementById('openMidiBtn').style.display = 'inline-block';

    input.onmidimessage = (message) => {
        if (!authorized) return;
        const [command, note, velocity] = message.data;
        const messageType = command >> 4;
        if (messageType === 9 && velocity > 0) {
            playNote(note, velocity);
        }
    };
}

function createVirtualPiano() {
    const container = document.getElementById('virtualPiano');
    container.innerHTML = '';
    virtualPianoKeys = {};

    const notes = [
        {midi: 48, mc: null, name: 'C', octave: 3, disabled: true},
        {midi: 49, mc: null, name: 'C#', octave: 3, disabled: true},
        {midi: 50, mc: null, name: 'D', octave: 3, disabled: true},
        {midi: 51, mc: null, name: 'D#', octave: 3, disabled: true},
        {midi: 52, mc: null, name: 'E', octave: 3, disabled: true},
        {midi: 53, mc: null, name: 'F', octave: 3, disabled: true},
        {midi: 54, mc: 0, name: 'F#', octave: 3, disabled: false},
        {midi: 55, mc: 1, name: 'G', octave: 3, disabled: false},
        {midi: 56, mc: 2, name: 'G#', octave: 3, disabled: false},
        {midi: 57, mc: 3, name: 'A', octave: 3, disabled: false},
        {midi: 58, mc: 4, name: 'A#', octave: 3, disabled: false},
        {midi: 59, mc: 5, name: 'B', octave: 3, disabled: false},
        {midi: 60, mc: 6, name: 'C', octave: 4, disabled: false},
        {midi: 61, mc: 7, name: 'C#', octave: 4, disabled: false},
        {midi: 62, mc: 8, name: 'D', octave: 4, disabled: false},
        {midi: 63, mc: 9, name: 'D#', octave: 4, disabled: false},
        {midi: 64, mc: 10, name: 'E', octave: 4, disabled: false},
        {midi: 65, mc: 11, name: 'F', octave: 4, disabled: false},
        {midi: 66, mc: 12, name: 'F#', octave: 4, disabled: false},
        {midi: 67, mc: 13, name: 'G', octave: 4, disabled: false},
        {midi: 68, mc: 14, name: 'G#', octave: 4, disabled: false},
        {midi: 69, mc: 15, name: 'A', octave: 4, disabled: false},
        {midi: 70, mc: 16, name: 'A#', octave: 4, disabled: false},
        {midi: 71, mc: 17, name: 'B', octave: 4, disabled: false},
        {midi: 72, mc: 18, name: 'C', octave: 5, disabled: false},
        {midi: 73, mc: 19, name: 'C#', octave: 5, disabled: false},
        {midi: 74, mc: 20, name: 'D', octave: 5, disabled: false},
        {midi: 75, mc: 21, name: 'D#', octave: 5, disabled: false},
        {midi: 76, mc: 22, name: 'E', octave: 5, disabled: false},
        {midi: 77, mc: 23, name: 'F', octave: 5, disabled: false},
        {midi: 78, mc: 24, name: 'F#', octave: 5, disabled: false},
        {midi: 79, mc: null, name: 'G', octave: 5, disabled: true},
        {midi: 80, mc: null, name: 'G#', octave: 5, disabled: true},
        {midi: 81, mc: null, name: 'A', octave: 5, disabled: true}
    ];

    const whiteNotes = notes.filter(n => !n.name.includes('#'));
    const blackNotes = notes.filter(n => n.name.includes('#'));

    const pianoContainer = document.createElement('div');
    pianoContainer.className = 'piano-keys-container';
    container.appendChild(pianoContainer);

    const whiteKeysContainer = document.createElement('div');
    whiteKeysContainer.className = 'white-keys-container';
    pianoContainer.appendChild(whiteKeysContainer);

    const blackKeysContainer = document.createElement('div');
    blackKeysContainer.className = 'black-keys-container';
    pianoContainer.appendChild(blackKeysContainer);

    whiteNotes.forEach((note, index) => {
        const key = document.createElement('div');
        key.className = 'piano-key white';
        if (note.disabled) key.classList.add('disabled');
        key.dataset.note = note.midi;
        key.dataset.index = index;

        const label = document.createElement('div');
        label.className = 'piano-key-label';
        label.textContent = `${note.name}${note.octave}`;
        key.appendChild(label);

        setupKeyEvents(key, note.midi, note.disabled);
        whiteKeysContainer.appendChild(key);
        virtualPianoKeys[note.midi] = key;
    });

    blackNotes.forEach(note => {
        const whiteIndexBefore = whiteNotes.findIndex(w => w.midi > note.midi) - 1;
        if (whiteIndexBefore < 0) return;

        const key = document.createElement('div');
        key.className = 'piano-key black';
        if (note.disabled) key.classList.add('disabled');
        key.dataset.note = note.midi;
        const leftPercent = ((whiteIndexBefore + 1) / whiteNotes.length) * 100;
        key.style.left = `calc(${leftPercent}% - 1.75%)`;

        const label = document.createElement('div');
        label.className = 'piano-key-label';
        label.textContent = `${note.name}${note.octave}`;
        key.appendChild(label);

        setupKeyEvents(key, note.midi, note.disabled);
        blackKeysContainer.appendChild(key);
        virtualPianoKeys[note.midi] = key;
    });
}

function setupKeyEvents(key, midiNote, disabled) {
    if (disabled) {
        key.style.cursor = 'not-allowed';
        return;
    }

    key.addEventListener('mousedown', (e) => {
        e.preventDefault();
        if (!authorized) return;
        isDragging = true;
        lastPlayedNote = midiNote;
        key.classList.add('active');
        playNote(midiNote, 100);
    });

    key.addEventListener('mouseenter', () => {
        if (!authorized) return;
        if (isDragging && lastPlayedNote !== midiNote) {
            key.classList.add('active');
            playNote(midiNote, 100);
            lastPlayedNote = midiNote;
        }
    });

    key.addEventListener('mouseleave', () => {
        key.classList.remove('active');
    });

    key.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (!authorized) return;
        isDragging = true;
        lastPlayedNote = midiNote;
        key.classList.add('active');
        playNote(midiNote, 100);
    });

    key.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (!authorized || !isDragging) return;

        const touch = e.touches[0];
        const element = document.elementFromPoint(touch.clientX, touch.clientY);

        if (element && element.classList.contains('piano-key') &&
            !element.classList.contains('disabled')) {
            const touchedNote = parseInt(element.dataset.note, 10);
            if (!Number.isNaN(touchedNote) && lastPlayedNote !== touchedNote) {
                Object.values(virtualPianoKeys).forEach(k => k.classList.remove('active'));
                element.classList.add('active');
                playNote(touchedNote, 100);
                lastPlayedNote = touchedNote;
            }
        }
    });

    key.addEventListener('touchend', (e) => {
        e.preventDefault();
        key.classList.remove('active');
    });

    key.addEventListener('touchcancel', () => {
        key.classList.remove('active');
    });
}

function playNote(note, velocity) {
    const originalNoteInfo = getNoteInfo(note);
    const noteDisplay = document.getElementById('noteDisplay');
    noteDisplay.textContent = `♪ ${originalNoteInfo.fullName} ♪`;
    noteDisplay.style.color = '#55ff55';
    if (ws && ws.readyState === WebSocket.OPEN) {
        let instrument = 'harp';
        try {
            instrument = document.getElementById('instrumentSelect').value || 'harp';
        } catch {
        }
        try {
            localStorage.setItem(STORAGE_KEY_INSTRUMENT, instrument);
        } catch {
        }
        ws.send(JSON.stringify({type: 'note', instrument, note, velocity}));
    }
    setTimeout(() => {
        noteDisplay.textContent = '';
    }, 500);
}

function connectVirtualPiano() {
    console.log('Connecting to Virtual Piano');

    if (selectedInput) {
        selectedInput.onmidimessage = null;
        selectedInput = null;
    }

    usingVirtualPiano = true;

    try {
        localStorage.setItem(STORAGE_KEY_MIDI_DEVICE, 'Virtual Piano');
    } catch (e) {
        console.warn('Failed to save MIDI device preference:', e);
    }

    document.getElementById('openMidiBtn').style.display = 'inline-block';
    createVirtualPiano();
    showVirtualPiano();
}

function showVirtualPiano() {
    document.getElementById('virtualPianoContainer').style.display = 'block';
}

function hideVirtualPiano() {
    document.getElementById('virtualPianoContainer').style.display = 'none';
}

async function tryAutoConnectMidiDevice() {
    try {
        const lastDeviceName = localStorage.getItem(STORAGE_KEY_MIDI_DEVICE);
        if (!lastDeviceName) return false;

        if (lastDeviceName === 'Virtual Piano') {
            connectVirtualPiano();
            return true;
        }

        try {
            const access = midiAccess || await navigator.requestMIDIAccess();
            midiAccess = access;
            const inputs = Array.from(access.inputs.values());
            const matchingDevice = inputs.find(input => input.name === lastDeviceName);
            if (matchingDevice) {
                connectMidiDevice(matchingDevice);
                return true;
            }
        } catch (e) {
            console.warn('MIDI access denied, cannot auto-reconnect:', e);
        }
    } catch (e) {
        console.warn('Failed to auto-connect MIDI device:', e);
    }
    return false;
}

function initializePianoPage() {
    const openMidiBtn = document.getElementById('openMidiBtn');
    if (openMidiBtn) {
        openMidiBtn.addEventListener('click', showDevicePickerPopup);
    }

    if (ENABLE_MIDI_FILE_UPLOAD) {
        const uploadMidiBtn = document.getElementById('uploadMidiBtn');
        const midiFileInput = document.getElementById('midiFileInput');
        const playPauseBtn = document.getElementById('playPauseBtn');
        const stopBtn = document.getElementById('stopBtn');

        if (!uploadMidiBtn || !midiFileInput || !playPauseBtn || !stopBtn) {
            console.error('MIDI player HTML controls are missing.');
        } else {
            uploadMidiBtn.addEventListener('click', () => midiFileInput.click());
            midiFileInput.addEventListener('change', handleMIDIFileUpload);
            playPauseBtn.addEventListener('click', playMIDIFile);
            stopBtn.addEventListener('click', stopMIDIPlayback);
        }
    }

    connectWebSocket();
}

document.addEventListener('mouseup', () => {
    isDragging = false;
    lastPlayedNote = null;
});

document.addEventListener('touchend', () => {
    isDragging = false;
    lastPlayedNote = null;
});

document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
        return;
    }

    if (!usingVirtualPiano || !authorized) return;

    const key = e.key.toLowerCase();
    if (KEYBOARD_TO_MIDI[key] !== undefined) {
        e.preventDefault();
    }

    if (pressedKeys.has(key)) return;

    const midiNote = KEYBOARD_TO_MIDI[key];
    if (midiNote !== undefined) {
        pressedKeys.add(key);
        const pianoKey = virtualPianoKeys[midiNote];
        if (pianoKey && !pianoKey.classList.contains('disabled')) {
            pianoKey.classList.add('active');
            playNote(midiNote, 100);
        }
    }
});

document.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    pressedKeys.delete(key);

    if (!usingVirtualPiano) return;

    const midiNote = KEYBOARD_TO_MIDI[key];
    if (midiNote !== undefined) {
        const pianoKey = virtualPianoKeys[midiNote];
        if (pianoKey) pianoKey.classList.remove('active');
    }
});

window.addEventListener('blur', () => {
    pressedKeys.clear();
    if (usingVirtualPiano) {
        Object.values(virtualPianoKeys).forEach(key => key.classList.remove('active'));
    }
});

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePianoPage);
} else {
    initializePianoPage();
}
