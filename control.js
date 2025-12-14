
const { ipcRenderer } = require('electron');
const path = require('path');

// Monaco Editor Setup
let monaco = null;
let monacoEditors = {}; // Store editor instances by script ID

// In Electron, we need to use the ESM build approach
function loadMonaco() {
    // Create script tag to load Monaco
    const loaderScript = document.createElement('script');
    loaderScript.src = path.join(__dirname, 'node_modules/monaco-editor/min/vs/loader.js');
    
    loaderScript.onload = () => {
        // Configure AMD loader
        window.require.config({
            paths: {
                'vs': path.join(__dirname, 'node_modules/monaco-editor/min/vs')
            }
        });
        
        // Load Monaco
        window.require(['vs/editor/editor.main'], function() {
            monaco = window.monaco;
        });
    };
    
    loaderScript.onerror = (error) => {
        console.error('[Monaco] Failed to load:', error);
    };
    
    document.head.appendChild(loaderScript);
}

// Load Monaco on startup
loadMonaco();

// Helper function to create number input with custom arrows
function createNumberInput(id, min, max, step, value, onchange, suffix = '') {
    return `
        <div class="number-input-wrapper">
            <div class="number-arrow number-arrow-left" data-input-id="${id}" data-action="decrement">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#838383" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="m15 18-6-6 6-6"/>
                </svg>
            </div>
            <input type="number" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}" onchange="${onchange}">
            <span class="number-suffix">${suffix}</span>
            <div class="number-arrow number-arrow-right" data-input-id="${id}" data-action="increment">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#838383" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="m9 18 6-6-6-6"/>
                </svg>
            </div>
        </div>
    `;
}

let textObjects = [];
let nextObjectId = 1;
let customFonts = []; // Track custom imported fonts
let fontUsageCount = {}; // Track font usage for "recent fonts"

// Google Fonts list - populated dynamically from fonts folder
const GOOGLE_FONTS = [];

// System fonts (pre-installed)
const SYSTEM_FONTS = [
    'Inter',
    'Instrument Serif',
    'Arial',
    'Courier New',
    'Times New Roman',
    'Comic Sans MS',
    'Impact'
];

// Track which Google Fonts have been loaded
const loadedGoogleFonts = new Set();

// Load all fonts from fonts/ directory
// Load all fonts from fonts/ directory
function loadLocalFontsFromDirectory() {
    const fs = require('fs');
    const path = require('path');

    const fontsDir = path.join(__dirname, 'fonts');

    // Weight keywords to strip from font names
    const weightKeywords = ['Thin', 'ExtraLight', 'Light', 'Regular', 'Medium', 'SemiBold', 'Bold', 'ExtraBold', 'Black', 'Heavy', 'Hairline', 'Ultra'];

    function stripWeightFromFontName(fontName) {
        let cleanName = fontName;
        // Remove weight keywords from the end of the font name
        weightKeywords.forEach(weight => {
            const regex = new RegExp(`\\s+${weight}$`, 'i');
            cleanName = cleanName.replace(regex, '').trim();
        });
        return cleanName;
    }

    try {
        const files = fs.readdirSync(fontsDir);
        const ttfFiles = files.filter(f => f.endsWith('.ttf'));

        console.log(`[Fonts] Found ${ttfFiles.length} TTF fonts in fonts/ directory`);

        // Try to require opentype.js - it might not be available in renderer
        let opentype;
        try {
            opentype = require('opentype.js');
            console.log('[Fonts] opentype.js loaded successfully');
        } catch (opentypeError) {
            console.warn('[Fonts] opentype.js not available in renderer, using IPC to main process');
        }

        ttfFiles.forEach(file => {
            const fontPath = path.join(fontsDir, file);

            if (opentype) {
                try {
                    // Parse the font to get the REAL font family name
                    const font = opentype.loadSync(fontPath);
                    let fontName = font.names.fontFamily.en || font.names.fullName.en || file.replace('.ttf', '').replace(/-/g, ' ');

                    // Strip weight keywords
                    const cleanFontName = stripWeightFromFontName(fontName);

                    // Add to Google Fonts list so it appears in dropdown (using clean name)
                    if (!GOOGLE_FONTS.includes(cleanFontName)) {
                        GOOGLE_FONTS.push(cleanFontName);
                    }

                    // Load font with @font-face using the CLEAN name
                    const style = document.createElement('style');
                    style.textContent = `
                        @font-face {
                            font-family: "${cleanFontName}";
                            src: url("file://${fontPath.replace(/\\/g, '/')}");
                        }
                    `;
                    document.head.appendChild(style);

                    // Mark as loaded
                    loadedGoogleFonts.add(cleanFontName);

                    // Send to overlay too with clean name
                    ipcRenderer.send('load-google-font', {
                        fontFamily: cleanFontName,
                        fontFileName: file.replace('.ttf', ''),
                        fontPath: fontPath
                    });
                } catch (fontError) {
                    console.error(`[Fonts] Failed to parse ${file}:`, fontError.message);
                    // Fallback to filename
                    let fontName = file.replace('.ttf', '').replace(/-/g, ' ');
                    const cleanFontName = stripWeightFromFontName(fontName);
                    console.warn(`[Fonts] Using fallback name for ${file}: "${cleanFontName}"`);

                    if (!GOOGLE_FONTS.includes(cleanFontName)) {
                        GOOGLE_FONTS.push(cleanFontName);
                    }

                    const style = document.createElement('style');
                    style.textContent = `
                        @font-face {
                            font-family: "${cleanFontName}";
                            src: url("file://${fontPath.replace(/\\/g, '/')}");
                        }
                    `;
                    document.head.appendChild(style);
                    loadedGoogleFonts.add(cleanFontName);

                    ipcRenderer.send('load-google-font', {
                        fontFamily: cleanFontName,
                        fontFileName: file.replace('.ttf', ''),
                        fontPath: fontPath
                    });
                }
            } else {
                // opentype.js not available - use filename (old behavior)
                let fontName = file.replace('.ttf', '').replace(/-/g, ' ');
                const cleanFontName = stripWeightFromFontName(fontName);
                console.log(`[Fonts] Loading without parsing: "${cleanFontName}" (from ${file})`);

                if (!GOOGLE_FONTS.includes(cleanFontName)) {
                    GOOGLE_FONTS.push(cleanFontName);
                }

                const style = document.createElement('style');
                style.textContent = `
                    @font-face {
                        font-family: "${cleanFontName}";
                        src: url("file://${fontPath.replace(/\\/g, '/')}");
                    }
                `;
                document.head.appendChild(style);
                loadedGoogleFonts.add(cleanFontName);

                ipcRenderer.send('load-google-font', {
                    fontFamily: cleanFontName,
                    fontFileName: file.replace('.ttf', ''),
                    fontPath: fontPath
                });
            }
        });

    } catch (error) {
        console.error('[Fonts] Failed to load local fonts:', error);
    }
}

// Undo/Redo system for position changes
let positionHistory = [];
let positionHistoryIndex = -1;
const MAX_HISTORY = 50;

function recordPositionChange(id, oldX, oldY, newX, newY) {
    // Don't record if position didn't actually change
    if (oldX === newX && oldY === newY) return;
    
    // Remove any history after current index (when undoing then making new change)
    positionHistory = positionHistory.slice(0, positionHistoryIndex + 1);
    
    // Add new history entry
    positionHistory.push({
        id: id,
        oldX: oldX,
        oldY: oldY,
        newX: newX,
        newY: newY
    });
    
    // Keep history within limit
    if (positionHistory.length > MAX_HISTORY) {
        positionHistory.shift();
    } else {
        positionHistoryIndex++;
    }
}

function undoPosition() {
    if (positionHistoryIndex < 0) return;
    
    const entry = positionHistory[positionHistoryIndex];
    const obj = textObjects.find(o => o.id === entry.id);
    
    if (obj) {
        // Restore old position
        obj.positionX = entry.oldX;
        obj.positionY = entry.oldY;
        
        // Update UI
        const xInput = document.getElementById(`pos-x-${entry.id}`);
        const yInput = document.getElementById(`pos-y-${entry.id}`);
        if (xInput) xInput.value = entry.oldX;
        if (yInput) yInput.value = entry.oldY;
        
        // Update overlay (silent to prevent recording this change)
        ipcRenderer.send('update-text-object-position', {
            id: entry.id,
            x: entry.oldX,
            y: entry.oldY,
            silent: true
        });
    }
    
    positionHistoryIndex--;
}

function redoPosition() {
    if (positionHistoryIndex >= positionHistory.length - 1) return;
    
    positionHistoryIndex++;
    const entry = positionHistory[positionHistoryIndex];
    const obj = textObjects.find(o => o.id === entry.id);
    
    if (obj) {
        // Restore new position
        obj.positionX = entry.newX;
        obj.positionY = entry.newY;
        
        // Update UI
        const xInput = document.getElementById(`pos-x-${entry.id}`);
        const yInput = document.getElementById(`pos-y-${entry.id}`);
        if (xInput) xInput.value = entry.newX;
        if (yInput) yInput.value = entry.newY;
        
        // Update overlay (silent to prevent recording this change)
        ipcRenderer.send('update-text-object-position', {
            id: entry.id,
            x: entry.newX,
            y: entry.newY,
            silent: true
        });
    }
}

// Animation presets storage
let animationPresets = [];
let nextAnimationId = 1;

// Scripts storage
let scripts = [];
let nextScriptId = 1;

function createScript() {
    const script = {
        id: nextScriptId++,
        name: `Script ${nextScriptId - 1}`,
        // Only first script gets example code
        code: scripts.length === 0 ? `// Wave effect example
const myText = createTextObject({
  name: "Wave Text",
  text: "HELLO",
  x: 640,
  y: 360,
  fontSize: 60,
  color: 0xFFFFFF
});

waveEffect(myText);` : ``,
        collapsed: false
    };
    
    scripts.push(script);
    renderScript(script);
    return script;
}

function renderScript(script) {
    const listContainer = document.getElementById('scripts-list');
    
    const scriptHTML = `
        <div class="text-object ${script.collapsed ? 'collapsed' : ''}" id="script-${script.id}">
            <div class="text-object-header" onclick="toggleScriptCollapse(${script.id})">
                <span class="collapse-arrow"></span>
                <input type="text" class="text-object-name" value="${script.name}" 
                       onclick="event.stopPropagation()" 
                       onchange="updateScriptName(${script.id}, this.value)">
                <button class="delete-btn" onclick="deleteScript(${script.id}, event)">×</button>
            </div>
            
            <div class="text-object-body">
                <div class="control-group">
                    <label>Script Code</label>
                    <div id="monaco-editor-${script.id}" class="monaco-editor-container"></div>
                </div>                <div style="display: flex; gap: 6px; margin-top: 8px;">
                    <button onclick="expandScript(${script.id})" style="flex: 0.8;" class="secondary" title="Open in full editor">⤢ Expand</button>
                    <button onclick="runScript(${script.id})" style="flex: 1;">▶ Run</button>
                    <button onclick="stopScript(${script.id})" style="flex: 1;" class="secondary">⏹ Stop</button>
                </div>
            </div>
        </div>
    `;
    
    listContainer.insertAdjacentHTML('beforeend', scriptHTML);
    
    // Initialize Monaco Editor after DOM is ready
    setTimeout(() => {
        if (monaco) {
            initMonacoEditor(script);
        } else {
            // Wait for Monaco to load
            const checkMonaco = setInterval(() => {
                if (monaco) {
                    clearInterval(checkMonaco);
                    initMonacoEditor(script);
                }
            }, 100);
        }
    }, 0);
}

// Initialize Monaco Editor for a script
function initMonacoEditor(script) {
    const container = document.getElementById(`monaco-editor-${script.id}`);
    if (!container || monacoEditors[script.id]) return;    const editor = monaco.editor.create(container, {
        value: script.code || '',
        language: 'javascript',
        theme: 'vs-dark',
        automaticLayout: true,
        fontSize: 13,
        fontFamily: 'Consolas, Monaco, Courier New, monospace',
        minimap: { enabled: false },
        lineNumbers: 'on',
        roundedSelection: false,
        scrollBeyondLastLine: false,
        readOnly: false,
        tabSize: 2,
        insertSpaces: true,
        wordWrap: 'off',
        glyphMargin: false,
        folding: true,
        lineDecorationsWidth: 0,
        lineNumbersMinChars: 3,
        renderLineHighlight: 'line',
        scrollbar: {
            vertical: 'visible',
            horizontal: 'visible',
            useShadows: false,
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10,
            alwaysConsumeMouseWheel: false // Don't trap scroll if editor doesn't need it
        }
    });    // Store editor instance
    monacoEditors[script.id] = editor;
    
    // FIX: Manual clipboard and keyboard shortcuts for Electron
    editor.addAction({
        id: 'custom.paste',
        label: 'Paste',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyV],
        contextMenuGroupId: 'clipboard',
        contextMenuOrder: 3,
        run: async function(ed) {
            try {
                const text = await navigator.clipboard.readText();
                const selection = ed.getSelection();
                if (selection) {
                    ed.executeEdits('paste', [{
                        range: selection,
                        text: text,
                        forceMoveMarkers: true
                    }]);
                }
            } catch (err) {
                console.error('Paste failed:', err);
            }
            return null;
        }
    });
    
    editor.addAction({
        id: 'custom.copy',
        label: 'Copy',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyC],
        contextMenuGroupId: 'clipboard',
        contextMenuOrder: 2,
        run: async function(ed) {
            try {
                const selection = ed.getSelection();
                if (selection && !selection.isEmpty()) {
                    const text = ed.getModel().getValueInRange(selection);
                    await navigator.clipboard.writeText(text);
                }
            } catch (err) {
                console.error('Copy failed:', err);
            }
            return null;
        }
    });
    
    editor.addAction({
        id: 'custom.cut',
        label: 'Cut',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyX],
        contextMenuGroupId: 'clipboard',
        contextMenuOrder: 1,
        run: async function(ed) {
            try {
                const selection = ed.getSelection();
                if (selection && !selection.isEmpty()) {
                    const text = ed.getModel().getValueInRange(selection);
                    await navigator.clipboard.writeText(text);
                    ed.executeEdits('cut', [{
                        range: selection,
                        text: '',
                        forceMoveMarkers: true
                    }]);
                }
            } catch (err) {
                console.error('Cut failed:', err);
            }
            return null;
        }
    });
    
    // Undo
    editor.addAction({
        id: 'custom.undo',
        label: 'Undo',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ],
        run: function(ed) {
            ed.trigger('keyboard', 'undo', null);
            return null;
        }
    });
    
    // Redo
    editor.addAction({
        id: 'custom.redo',
        label: 'Redo',
        keybindings: [
            monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyY,
            monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyZ
        ],
        run: function(ed) {
            ed.trigger('keyboard', 'redo', null);
            return null;
        }
    });
    
    // Select All
    editor.addAction({
        id: 'custom.selectAll',
        label: 'Select All',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyA],
        run: function(ed) {
            ed.setSelection(ed.getModel().getFullModelRange());
            return null;
        }
    });
    
    // Find
    editor.addAction({
        id: 'custom.find',
        label: 'Find',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF],
        run: function(ed) {
            ed.trigger('keyboard', 'actions.find', null);
            return null;
        }
    });
    
    // Replace
    editor.addAction({
        id: 'custom.replace',
        label: 'Replace',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH],
        run: function(ed) {
            ed.trigger('keyboard', 'editor.action.startFindReplaceAction', null);
            return null;
        }
    });
    
    // Update script code on changes
    editor.onDidChangeModelContent(() => {
        const code = editor.getValue();
        updateScriptCode(script.id, code);
    });
    
}

function toggleScriptCollapse(id) {
    const script = scripts.find(s => s.id === id);
    if (script) {
        script.collapsed = !script.collapsed;
        const element = document.getElementById(`script-${id}`);
        if (element) {
            element.classList.toggle('collapsed');
            
            // Trigger Monaco layout update when expanding
            if (!script.collapsed && monacoEditors[id]) {
                setTimeout(() => {
                    monacoEditors[id].layout();
                }, 100);
            }
        }
    }
}

function updateScriptName(id, name) {
    const script = scripts.find(s => s.id === id);
    if (script) {
        script.name = name;
    }
}

function updateScriptCode(id, code) {
    const script = scripts.find(s => s.id === id);
    if (script) {
        script.code = code;
    }
}

function deleteScript(id, event) {
    event.stopPropagation();
    const index = scripts.findIndex(s => s.id === id);
    if (index !== -1) {
        // Stop script if running
        stopScript(id);
        
        // Dispose Monaco editor
        if (monacoEditors[id]) {
            monacoEditors[id].dispose();
            delete monacoEditors[id];
        }
        
        scripts.splice(index, 1);
        const element = document.getElementById(`script-${id}`);
        if (element) {
            element.remove();
        }
    }
}

// Open script in full editor window
function expandScript(id) {
    const script = scripts.find(s => s.id === id);
    if (script) {
        ipcRenderer.send('open-script-editor', script);
    }
}

// ===== SCRIPT EXECUTION ENGINE =====

// Track running scripts and their timers/intervals
const runningScripts = new Map(); // scriptId -> { timeouts: Set, intervals: Set, running: boolean, paused: boolean, intervalCallbacks: Map }

// Pause all script intervals when OVERLAY window is hidden/minimized
let scriptsPaused = false;

// Listen for overlay visibility changes from main process
ipcRenderer.on('overlay-visibility-changed', (event, isHidden) => {
    if (isHidden) {
        // Overlay is hidden/minimized - pause all scripts
        scriptsPaused = true;
        
        runningScripts.forEach((state, scriptId) => {
            if (state.running && !state.paused) {
                state.paused = true;
                // Clear all intervals but keep track of their callbacks
                state.intervals.forEach(intervalId => {
                    clearInterval(intervalId);
                });
            }
        });
    } else {
        // Overlay is visible again - resume all scripts
        scriptsPaused = false;
        
        runningScripts.forEach((state, scriptId) => {
            if (state.paused) {
                state.paused = false;
                // Restart intervals from stored callbacks
                const newIntervals = new Set();
                state.intervalCallbacks.forEach((data) => {
                    const intervalId = setInterval(data.callback, data.delay);
                    newIntervals.add(intervalId);
                });
                state.intervals = newIntervals;
            }
        });
    }
});

// Script API - Functions available to user scripts
function createScriptAPI(scriptId) {
    const api = {        // Create a new text object
        createTextObject: function(config) {
            // First, check if this script already created a text object
            let existingObj = textObjects.find(obj => obj.createdByScript === scriptId);
            
            // If not found by script, try to find by name
            if (!existingObj && config.name) {
                existingObj = textObjects.find(obj => obj.name === config.name);
            }
            
            // If not found by name, try to find by ID
            if (!existingObj && config.id !== undefined) {
                existingObj = textObjects.find(obj => obj.id === config.id);
            }
            
            if (existingObj) {
                // Text object already exists, update it instead of creating new
                logScriptMessage(scriptId, `Reusing text object "${existingObj.name}" at saved position`, 'log');
                
                // Update properties if provided (but NOT position - keep saved position)
                if (config.text !== undefined) {
                    existingObj.text = config.text;
                }
                if (config.fontSize !== undefined) existingObj.fontSize = config.fontSize;
                if (config.color !== undefined) existingObj.color = config.color;
                if (config.fontFamily !== undefined) existingObj.fontFamily = config.fontFamily;
                
                // Send update to overlay (NOT create) to refresh the existing object
                ipcRenderer.send('update-text-object', { 
                    id: existingObj.id, 
                    text: existingObj.text,
                    instant: true // Don't animate when script restarts
                });
                
                // Update visual properties
                ipcRenderer.send('update-text-object-settings', { 
                    id: existingObj.id,
                    fontSize: existingObj.fontSize,
                    color: existingObj.color,
                    fontFamily: existingObj.fontFamily,
                    silent: true
                });
                
                return existingObj.id;
            }
            
            // Create new object
            const id = config.id !== undefined ? config.id : nextObjectId++;
            
            // Get defaults from settings if not provided
            const defaultFontSize = parseInt(document.getElementById('default-font-size')?.value) || 48;            const textObject = {
                id: id,
                name: config.name || `Text Object ${id}`,
                inputMode: 'manual',
                text: config.text || 'New Text',
                filePath: null,
                positionX: config.x !== undefined ? config.x : null,
                positionY: config.y !== undefined ? config.y : null,
                fontSize: config.fontSize || defaultFontSize,
                fontFamily: config.fontFamily || 'Instrument Serif',
                color: config.color || 0xFFFFFF,
                loopAnimation: false, // Scripts control animation, disable preset looping
                outlineEnabled: config.outlineEnabled !== undefined ? config.outlineEnabled : true,
                outlineColor: config.outlineColor || 0x000000,
                outlineWidth: config.outlineWidth || 4,
                animationPreset: null, // No animation preset for script-created objects
                createdByScript: scriptId, // Track which script created this
                collapsed: false
            };
            
            textObjects.push(textObject);
            renderTextObject(textObject);
            
            // Send to overlay
            ipcRenderer.send('create-text-object', textObject);
            
            logScriptMessage(scriptId, `Created text object with ID ${id}`, 'log');
            return id;
        },        // Update an existing text object
        updateTextObject: function(id, updates) {
            const textObject = textObjects.find(obj => obj.id === id);
            if (!textObject) {
                logScriptMessage(scriptId, `Text object ${id} not found`, 'error');
                return false;
            }
            
            // If script is updating position/text, disable animations to prevent conflicts
            if (updates.x !== undefined || updates.y !== undefined || updates.text !== undefined) {
                if (textObject.animationPreset !== null || textObject.loopAnimation !== false) {
                    textObject.animationPreset = null;
                    textObject.loopAnimation = false;
                    logScriptMessage(scriptId, `Disabled animation for text object ${id} (script control)`, 'log');
                }
            }            // Update properties
            if (updates.text !== undefined) {
                textObject.text = updates.text;
                ipcRenderer.send('update-text-object', { id, text: updates.text, instant: true });
            }            if (updates.x !== undefined || updates.y !== undefined) {
                if (updates.x !== undefined) textObject.positionX = updates.x;
                if (updates.y !== undefined) textObject.positionY = updates.y;
                ipcRenderer.send('update-text-object-position', {
                    id,
                    x: textObject.positionX,
                    y: textObject.positionY,
                    silent: true // Don't re-trigger animation on position updates from scripts
                });
            }
            
            if (updates.fontSize !== undefined) {
                textObject.fontSize = updates.fontSize;
            }
            
            if (updates.color !== undefined) {
                textObject.color = updates.color;
            }
            
            if (updates.fontFamily !== undefined) {
                textObject.fontFamily = updates.fontFamily;
            }
            
            if (updates.outlineEnabled !== undefined) {
                textObject.outlineEnabled = updates.outlineEnabled;
            }
            
            if (updates.outlineColor !== undefined) {
                textObject.outlineColor = updates.outlineColor;
            }
            
            if (updates.outlineWidth !== undefined) {
                textObject.outlineWidth = updates.outlineWidth;
            }
            
            // Send ONLY the changed settings to overlay
            const settingsToSend = { id, silent: true };

            if (updates.fontSize !== undefined) settingsToSend.fontSize = textObject.fontSize;
            if (updates.color !== undefined) settingsToSend.color = textObject.color;
            if (updates.fontFamily !== undefined) settingsToSend.fontFamily = textObject.fontFamily;
            if (updates.outlineEnabled !== undefined) settingsToSend.outlineEnabled = textObject.outlineEnabled;
            if (updates.outlineColor !== undefined) settingsToSend.outlineColor = textObject.outlineColor;
            if (updates.outlineWidth !== undefined) settingsToSend.outlineWidth = textObject.outlineWidth;

            // Only send if there are actual settings changes (more than just id and silent)
            if (Object.keys(settingsToSend).length > 2) {
                ipcRenderer.send('update-text-object-settings', settingsToSend);
            }
            
            return true;
        },
        
        // Delete a text object
        deleteTextObject: function(id) {
            const index = textObjects.findIndex(obj => obj.id === id);
            if (index === -1) {
                logScriptMessage(scriptId, `Text object ${id} not found`, 'error');
                return false;
            }
            
            textObjects.splice(index, 1);
            const element = document.getElementById(`text-object-${id}`);
            if (element) {
                element.remove();
            }
            
            ipcRenderer.send('delete-text-object', id);
            logScriptMessage(scriptId, `Deleted text object ${id}`, 'log');
            return true;
        },        // Utility: Generate random color
        randomColor: function() {
            return Math.floor(Math.random() * 0xFFFFFF);
        },        // Set per-character offsets (for wave effects on properly kerned text)
        setCharacterOffsets: function(id, offsets) {
            const textObject = textObjects.find(obj => obj.id === id);            if (!textObject) {
                logScriptMessage(scriptId, `Text object ${id} not found`, 'error');
                return false;
            }
            
            // Send to overlay
            ipcRenderer.send('update-character-offsets', {
                id,
                offsets
            });
            
            return true;
        },
        
        // Set per-character colors (for ombré effects)
        setCharacterColors: function(id, colors) {
            const textObject = textObjects.find(obj => obj.id === id);
            if (!textObject) {
                logScriptMessage(scriptId, `Text object ${id} not found`, 'error');
                return false;
            }
            
            // Send to overlay
            ipcRenderer.send('update-character-colors', {
                id,
                colors
            });
            
            return true;
        },
        
        // Wrapped setTimeout that tracks timers for cleanup
        setTimeout: function(callback, delay) {
            const timeoutId = setTimeout(() => {
                try {
                    callback();
                } catch (error) {
                    logScriptMessage(scriptId, `Error in setTimeout: ${error.message}`, 'error');
                }
                // Remove from tracking after execution
                const scriptState = runningScripts.get(scriptId);
                if (scriptState) {
                    scriptState.timeouts.delete(timeoutId);
                }
            }, delay);
            
            // Track timeout
            const scriptState = runningScripts.get(scriptId);
            if (scriptState) {
                scriptState.timeouts.add(timeoutId);
            }
            
            return timeoutId;
        },        // Wrapped setInterval that tracks intervals for cleanup
        setInterval: function(callback, delay) {
            const wrappedCallback = () => {
                try {
                    callback();
                } catch (error) {
                    logScriptMessage(scriptId, `Error in setInterval: ${error.message}`, 'error');
                    // Clear interval on error
                    clearInterval(intervalId);
                    const scriptState = runningScripts.get(scriptId);
                    if (scriptState) {
                        scriptState.intervals.delete(intervalId);
                        scriptState.intervalCallbacks.delete(intervalId);
                    }
                }
            };
            
            const intervalId = setInterval(wrappedCallback, delay);
            
            // Track interval and its callback for pause/resume
            const scriptState = runningScripts.get(scriptId);
            if (scriptState) {
                scriptState.intervals.add(intervalId);
                scriptState.intervalCallbacks.set(intervalId, {
                    callback: wrappedCallback,
                    delay: delay
                });
            }
            
            return intervalId;
        },
        
        // Console logging
        console: {
            log: (msg) => logScriptMessage(scriptId, msg, 'log'),
            warn: (msg) => logScriptMessage(scriptId, msg, 'warning'),
            error: (msg) => logScriptMessage(scriptId, msg, 'error')
        }
    };    // Helper functions that use the api methods (created after api so they can reference it)
    api.waveEffect = function(id, amplitude = 30, frequency = 0.5, speed = 0.1) {
        // Get the text object to find the text
        const textObject = textObjects.find(obj => obj.id === id);
        if (!textObject) {
            logScriptMessage(scriptId, `Text object ${id} not found`, 'error');
            return null;
        }
        
        let time = 0;
        const textLength = textObject.text.length;
        
        const intervalId = api.setInterval(() => {
            const offsets = [];
            for (let i = 0; i < textLength; i++) {
                offsets.push({
                    x: 0,
                    y: Math.sin((i * frequency) + time) * amplitude
                });
            }
            api.setCharacterOffsets(id, offsets);
            time += speed;
        }, 16);
        
        return intervalId;
    };
    
    api.bounceEffect = function(id, height = 50, speed = 0.1) {
        // Get the text object to find the text
        const textObject = textObjects.find(obj => obj.id === id);
        if (!textObject) {
            logScriptMessage(scriptId, `Text object ${id} not found`, 'error');
            return null;
        }
        
        let time = 0;
        const textLength = textObject.text.length;
        
        const intervalId = api.setInterval(() => {
            const offsets = [];
            for (let i = 0; i < textLength; i++) {
                const delay = i * 0.2;
                offsets.push({
                    x: 0,
                    y: Math.abs(Math.sin(time + delay)) * height
                });
            }
            api.setCharacterOffsets(id, offsets);
            time += speed;
        }, 16);
        
        return intervalId;
    };
    
    api.shakeEffect = function(id, intensity = 5) {
        // Get the text object to find the text
        const textObject = textObjects.find(obj => obj.id === id);
        if (!textObject) {
            logScriptMessage(scriptId, `Text object ${id} not found`, 'error');
            return null;
        }
        
        const textLength = textObject.text.length;
        
        const intervalId = api.setInterval(() => {
            const offsets = [];
            for (let i = 0; i < textLength; i++) {
                offsets.push({
                    x: (Math.random() - 0.5) * intensity * 2,
                    y: (Math.random() - 0.5) * intensity * 2
                });
            }
            api.setCharacterOffsets(id, offsets);
        }, 50);        return intervalId;
    };
    
    // Fade out text (smooth opacity transition)
    api.fadeOut = function(id, duration = 1000) {
        const textObject = textObjects.find(obj => obj.id === id);
        if (!textObject) {
            logScriptMessage(scriptId, `Text object ${id} not found`, 'error');
            return null;
        }
        
        const steps = 60; // 60 frames for smooth animation
        const interval = duration / steps;
        let currentStep = 0;
        
        const fadeInterval = api.setInterval(() => {
            currentStep++;
            const opacity = 1 - (currentStep / steps);
            
            // Fade each character
            const colors = [];
            const textLength = textObject.text.length;
            const baseColor = textObject.color;
            
            for (let i = 0; i < textLength; i++) {
                // Convert hex to RGB, apply opacity, convert back
                const r = (baseColor >> 16) & 0xFF;
                const g = (baseColor >> 8) & 0xFF;
                const b = baseColor & 0xFF;
                
                // Lerp towards background (0x000000 for now)
                const newR = Math.floor(r * opacity);
                const newG = Math.floor(g * opacity);
                const newB = Math.floor(b * opacity);
                
                colors.push((newR << 16) | (newG << 8) | newB);
            }
            
            api.setCharacterColors(id, colors);
            
            if (currentStep >= steps) {
                clearInterval(fadeInterval);
            }
        }, interval);
        
        return fadeInterval;
    };
    
    // Fade in text (smooth opacity transition)
    api.fadeIn = function(id, duration = 1000) {
        const textObject = textObjects.find(obj => obj.id === id);
        if (!textObject) {
            logScriptMessage(scriptId, `Text object ${id} not found`, 'error');
            return null;
        }
        
        const steps = 60;
        const interval = duration / steps;
        let currentStep = 0;
        
        const fadeInterval = api.setInterval(() => {
            currentStep++;
            const opacity = currentStep / steps;
            
            const colors = [];
            const textLength = textObject.text.length;
            const baseColor = textObject.color;
            
            for (let i = 0; i < textLength; i++) {
                const r = (baseColor >> 16) & 0xFF;
                const g = (baseColor >> 8) & 0xFF;
                const b = baseColor & 0xFF;
                
                const newR = Math.floor(r * opacity);
                const newG = Math.floor(g * opacity);
                const newB = Math.floor(b * opacity);
                
                colors.push((newR << 16) | (newG << 8) | newB);
            }
            
            api.setCharacterColors(id, colors);
            
            if (currentStep >= steps) {
                clearInterval(fadeInterval);
                // Reset to normal colors after fade complete
                api.setCharacterColors(id, []);
            }
        }, interval);
        
        return fadeInterval;
    };
    
    // Fade transition - fade out, change text, fade in
    api.fadeTransition = function(id, newText, fadeOutDuration = 800, fadeInDuration = 800) {
        const textObject = textObjects.find(obj => obj.id === id);
        if (!textObject) {
            logScriptMessage(scriptId, `Text object ${id} not found`, 'error');
            return null;
        }
        
        // Fade out
        api.fadeOut(id, fadeOutDuration);        // Change text in the middle
        api.setTimeout(() => {
            api.updateTextObject(id, { text: newText });            // Fade in with new text
            api.setTimeout(() => {
                api.fadeIn(id, fadeInDuration);
            }, 50); // Small delay to ensure text is updated
            
        }, fadeOutDuration);
    };    // Draw a triangle in world space
    api.drawTriangle = function(x1, y1, x2, y2, x3, y3, color) {
        ipcRenderer.send('draw-triangle', {
            x1, y1, x2, y2, x3, y3, color
        });
    };
    
    // Clear all triangles (for animation frames)
    api.clearTriangles = function() {
        ipcRenderer.send('clear-triangles');
    };    // Batch draw multiple triangles (better for animation)
    api.drawTriangles = function(triangles) {
        ipcRenderer.send('draw-triangles-batch', { triangles });
    };    // Start an animation loop that runs in sync with PixiJS rendering
    api.startAnimation = function(callback) {
        // Get the full script code (includes variables in scope)
        const script = scripts.find(s => s.id === scriptId);
        if (script) {
            ipcRenderer.send('start-animation', {
                scriptId: scriptId,
                code: script.code  // Send full script code, not just callback
            });
        }
    };
    
    // Stop animation loop
    api.stopAnimation = function() {
        ipcRenderer.send('stop-animation', { scriptId: scriptId });
    };
    // 3D Math Helpers
    api.rotateX = function(x, y, z, angle) {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        return {
            x: x,
            y: y * cos - z * sin,
            z: y * sin + z * cos
        };
    };
    
    api.rotateY = function(x, y, z, angle) {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        return {
            x: x * cos + z * sin,
            y: y,
            z: -x * sin + z * cos
        };
    };
    
    api.rotateZ = function(x, y, z, angle) {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        return {
            x: x * cos - y * sin,
            y: x * sin + y * cos,
            z: z
        };
    };
    
    api.project3D = function(x, y, z, distance = 500) {
        const scale = distance / (distance + z);
        return {
            x: x * scale + 640, // Center at 640 (half of 1280)
            y: y * scale + 360  // Center at 360 (half of 720)
        };
    };

    return api;
}

// Log script messages to console and send to script editor window
function logScriptMessage(scriptId, message, type = 'log') {
    ipcRenderer.send('script-console-to-editor', {
        scriptId,
        message,
        type
    });
}

// Execute a script
function runScript(id) {
    const script = scripts.find(s => s.id === id);
    if (!script) return;
    
    // Check if already running
    if (runningScripts.has(id)) {
        showToast(`Script "${script.name}" is already running`, 'warning');
        return;
    }    // Initialize script state
    runningScripts.set(id, {
        timeouts: new Set(),
        intervals: new Set(),
        intervalCallbacks: new Map(),
        running: true,
        paused: false
    });
    
    try {
        // Create the script API
        const api = createScriptAPI(id);        const scriptFunction = new Function(
            'createTextObject', 
            'updateTextObject', 
            'deleteTextObject',
            'randomColor',
            'setCharacterOffsets',
            'setCharacterColors',
            'waveEffect',
            'bounceEffect',
            'shakeEffect',
            'drawTriangle',
            'clearTriangles',
            'drawTriangles',
            'startAnimation',
            'stopAnimation',
            'rotateX',
            'rotateY',
            'rotateZ',
            'project3D',
            'setTimeout',
            'setInterval',
            'console',
            script.code  // This is the function BODY, not a parameter
        );        // Execute the script with API functions
        scriptFunction(
            api.createTextObject,
            api.updateTextObject,
            api.deleteTextObject,
            api.randomColor,
            api.setCharacterOffsets,
            api.setCharacterColors,
            api.waveEffect,
            api.bounceEffect,
            api.shakeEffect,
            api.drawTriangle,
            api.clearTriangles,
            api.drawTriangles,
            api.startAnimation,
            api.stopAnimation,
            api.rotateX,
            api.rotateY,
            api.rotateZ,
            api.project3D,
            api.setTimeout,
            api.setInterval,
            api.console
        );
        
        logScriptMessage(id, `Script "${script.name}" started`, 'log');
        showToast(`Running: ${script.name}`, 'success');
        
    } catch (error) {
        // Handle syntax/runtime errors
        logScriptMessage(id, `Error: ${error.message}`, 'error');
        ipcRenderer.send('script-error-to-editor', {
            scriptId: id,
            error: error.message
        });
        showToast(`Script error: ${error.message}`, 'error');
        
        // Clean up on error
        stopScript(id);
    }
}

// Stop a running script
function stopScript(id) {
    const script = scripts.find(s => s.id === id);
    if (!script) return;
    
    const scriptState = runningScripts.get(id);
    if (!scriptState) {
        showToast(`Script "${script.name}" is not running`, 'info');
        return;
    }
    
    // Clear all timeouts
    scriptState.timeouts.forEach(timeoutId => {
        clearTimeout(timeoutId);
    });    // Clear all intervals
    scriptState.intervals.forEach(intervalId => {
        clearInterval(intervalId);
    });    // Clear callback tracking
    scriptState.intervalCallbacks.clear();
    
    // Clear all triangles when script stops
    ipcRenderer.send('clear-triangles');
    
    // Stop any running animations
    ipcRenderer.send('stop-animation', { scriptId: id });
    
    // Remove from running scripts
    runningScripts.delete(id);
    
    logScriptMessage(id, `Script "${script.name}" stopped`, 'log');
    showToast(`Stopped: ${script.name}`, 'info');
}

// Project file tracking
let currentProjectFile = null;
let autoSaveInterval = null;
let autoSaveEnabled = false;

// Tab switching
document.querySelectorAll('.sidebar-icon').forEach(icon => {
    icon.addEventListener('click', () => {
        const tab = icon.getAttribute('data-tab');
        
        // Update active icon
        document.querySelectorAll('.sidebar-icon').forEach(i => i.classList.remove('active'));
        icon.classList.add('active');
        
        // Update visible tab
        document.querySelectorAll('.tab-content').forEach(t => t.style.display = 'none');
        document.getElementById(`tab-${tab}`).style.display = 'flex';
        
        // Reposition suffixes immediately after paint
        requestAnimationFrame(() => {
            requestAnimationFrame(positionSuffixes);
        });
    });
});

// Global background settings
const globalSettings = {
    backgroundColor: 0x000000,
    backgroundTransparent: false,
    // Global animation settings
    hopMin: 1,
    hopMax: 3,
    charDelayStep: 0.023,
    animationDuration: 0.4
};

// Background color controls
const bgColorPicker = document.getElementById('bg-color');
const bgTransparentCheckbox = document.getElementById('bg-transparent');

bgColorPicker.addEventListener('input', (e) => {
    globalSettings.backgroundColor = parseInt(e.target.value.replace('#', '0x'));
    if (!globalSettings.backgroundTransparent) {
        ipcRenderer.send('update-background', globalSettings);
    }
});

bgTransparentCheckbox.addEventListener('change', (e) => {
    globalSettings.backgroundTransparent = e.target.checked;
    ipcRenderer.send('update-background', globalSettings);
});

// Add text object button
document.getElementById('add-object-btn').addEventListener('click', () => {
    createTextObject();
});

// Add animation preset button
document.getElementById('add-animation-btn').addEventListener('click', () => {
    createAnimationPreset();
});

// Add script button
document.getElementById('add-script-btn').addEventListener('click', () => {
    createScript();
});

// Import OBJ button
document.getElementById('import-obj-btn').addEventListener('click', () => {
    ipcRenderer.send('open-obj-dialog');
});

function createTextObject() {
    const id = nextObjectId++;
    
    // Get default settings from UI
    const defaultFontSize = parseInt(document.getElementById('default-font-size')?.value) || 48;
    const defaultText = document.getElementById('default-starting-text')?.value || 'New Text Object';
    
    // Always use the first animation preset if available, otherwise null
    const defaultAnimationPreset = animationPresets.length > 0 ? animationPresets[0].id : null;
    
    const textObject = {
        id: id,
        name: `Text Object ${id}`,
        inputMode: 'manual',
        text: id === 1 ? 'Love all, trust a few, do wrong to none.' : defaultText,
        filePath: null,
        positionX: null, // Let overlay center it automatically
        positionY: null,
        fontSize: defaultFontSize,
        fontFamily: 'Instrument Serif',
        color: 0xFFFFFF,
        loopAnimation: true,
        outlineEnabled: true, // Default to true
        outlineColor: 0x000000,
        outlineWidth: 4,
        animationPreset: defaultAnimationPreset,
        collapsed: false
    };    textObjects.push(textObject);
    renderTextObject(textObject);
    
    // Send to overlay
    ipcRenderer.send('create-text-object', textObject);
    
    // Apply animation preset settings immediately
    if (textObject.animationPreset) {
        const preset = animationPresets.find(p => p.id === textObject.animationPreset);
        if (preset) {
            ipcRenderer.send('update-text-object-settings', { 
                id: textObject.id, 
                hopMin: preset.hopMin,
                hopMax: preset.hopMax,
                hopVariation: preset.hopVariation,
                charDelayStep: preset.charDelay,
                animationSpeed: preset.animSpeed,
                fadeIn: preset.fadeIn,
                fadeOut: preset.fadeOut,
                loopAnimation: preset.loopAnimation
            });
        }
    }
}

function renderTextObject(obj) {
    const container = document.getElementById('text-objects-list');
    
    const objectDiv = document.createElement('div');
    objectDiv.className = 'text-object';
    objectDiv.id = `text-object-${obj.id}`;    objectDiv.innerHTML = `        <div class="text-object-header" onclick="toggleCollapse(${obj.id})">
            <span class="collapse-arrow"></span>
            <input type="text" class="text-object-name" value="${obj.name}" onchange="updateObjectName(${obj.id}, this.value)" onclick="event.stopPropagation()">
            <button class="delete-btn" onclick="deleteTextObject(${obj.id}, event)">×</button>
        </div>
        <div class="text-object-body">
            <div class="control-group dark-bg">
                <label>Input Mode</label>
                <select id="input-mode-${obj.id}" onchange="updateInputMode(${obj.id}, this.value)">
                    <option value="manual">Manual Text Input</option>
                    <option value="file">Watch Text File</option>
                    <option value="stream">Stream Data</option>
                </select>
            </div>
            
            <div class="control-group" id="manual-input-${obj.id}">
                <label>Text Input</label>
                <textarea id="text-input-${obj.id}">${obj.text}</textarea>
                <button onclick="updateText(${obj.id})" style="margin-top: 5px;">Update Text</button>
            </div>
            
            <div class="control-group dark-bg" id="file-input-${obj.id}" style="display: none;">
                <label>Text File to Watch</label>
                <input type="text" id="file-path-${obj.id}" placeholder="No file selected" readonly>
                <button onclick="selectFile(${obj.id})" style="margin-top: 5px;" class="secondary">Select File</button>
            </div>            <div class="control-group" id="stream-input-${obj.id}" style="display: none;">
                <label>Stream Service</label>
                <select id="stream-service-${obj.id}">
                    <option value="">Select Service</option>
                    <option value="twitch">Twitch</option>
                    <option value="streamlabs">Streamlabs</option>
                </select>
                
                <label style="margin-top: 8px;">Data Type</label>
                <select id="stream-data-type-${obj.id}">
                    <option value="">Select Data Type</option>
                    <option value="follower_count">Follower Count</option>
                    <option value="viewer_count">Viewer Count</option>
                    <option value="latest_follower">Latest Follower</option>
                    <option value="latest_donation">Latest Donation</option>
                </select>
                
                <button onclick="connectStream(${obj.id})" style="margin-top: 8px;" class="secondary">Connect Stream</button>
            </div>            <div class="control-group">
                <div class="position-container">
                    <div class="position-label">Position</div>
                    <div class="position-inputs">                        <div class="position-row">
                            <label>X</label>
                            ${createNumberInput(`pos-x-${obj.id}`, '', '', '1', obj.positionX || '', `updatePosition(${obj.id})`)}
                        </div>
                        <div class="position-row">
                            <label>Y</label>
                            ${createNumberInput(`pos-y-${obj.id}`, '', '', '1', obj.positionY || '', `updatePosition(${obj.id})`)}
                        </div>
                        <button onclick="resetPosition(${obj.id})" style="margin-top: 6px;" class="secondary">Reset Position</button>
                    </div>
                </div>
            </div>            <div class="control-group dark-bg">
                <label>Font</label>
                <div class="font-picker" id="font-picker-${obj.id}">
                    <div class="font-picker-selected" onclick="toggleFontPicker(${obj.id})">
                        <span class="font-picker-selected-text" id="font-selected-${obj.id}">${obj.fontFamily}</span>
                        <span class="font-picker-arrow">▼</span>
                    </div>
                    <div class="font-picker-dropdown" id="font-dropdown-${obj.id}" style="display: none;">
                        <input type="text" class="font-picker-search" id="font-search-${obj.id}" placeholder="Search fonts..." onkeyup="filterFonts(${obj.id}, this.value)">
                        <div class="font-picker-list" id="font-list-${obj.id}">
                            <!-- Populated by renderFontList() -->
                        </div>
                    </div>
                </div>
                <button onclick="importCustomFont(${obj.id})" style="margin-top: 6px; width: 100%;" class="secondary">+ Import Custom Font</button>
            </div>            <div class="control-group dark-bg">
                <div class="position-container">
                    <div class="position-label">Font Size</div>
                    <div class="position-inputs">
                        <div class="position-row">
                            <label></label>
                            ${createNumberInput(`font-size-${obj.id}`, '12', '144', '1', obj.fontSize, `updateFontSize(${obj.id}, this.value)`, 'px')}
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="control-group">
                <div class="compact-row">
                    <label>Text Color</label>
                    <input type="color" id="text-color-${obj.id}" value="#ffffff" onchange="updateColor(${obj.id}, this.value)">
                </div>
            </div>            <div class="collapsible-section collapsed" id="outline-section-${obj.id}">
                <div class="collapsible-header" onclick="toggleOutlineSection(${obj.id})">
                    <span class="collapsible-arrow"></span>
                    <label>Outline</label>
                </div>
                <div class="collapsible-content">
                    <div class="checkbox-row">
                        <input type="checkbox" id="outline-enabled-${obj.id}" ${obj.outlineEnabled ? 'checked' : ''} onchange="updateOutlineEnabled(${obj.id}, this.checked)">
                        <label for="outline-enabled-${obj.id}">Enable Outline</label>
                    </div>
                    
                    <div id="outline-controls-${obj.id}" style="display: ${obj.outlineEnabled ? 'block' : 'none'}; margin-top: 6px;">
                        <label>Outline Color</label>
                        <input type="color" id="outline-color-${obj.id}" value="#000000" onchange="updateOutlineColor(${obj.id}, this.value)">
                        
                        <label style="margin-top: 8px;">Outline Thickness</label>
                        <div class="range-row">
                            <input type="range" id="outline-width-${obj.id}" min="1" max="20" value="${obj.outlineWidth}" oninput="updateOutlineWidth(${obj.id}, this.value)">
                            <span class="range-value" id="outline-width-value-${obj.id}">${obj.outlineWidth}x</span>
                        </div>
                    </div>                </div>            </div>
            
            <div class="collapsible-section collapsed" id="animation-section-${obj.id}">
                <div class="collapsible-header" onclick="toggleAnimationSection(${obj.id})">
                    <span class="collapsible-arrow"></span>
                    <label>Animation</label>
                </div>                <div class="collapsible-content">                    <label>Animation Preset</label>
                    <select id="animation-preset-${obj.id}" onchange="updateAnimationPreset(${obj.id}, this.value)">
                        <option value="">None</option>
                        ${animationPresets.map(preset => {
                            return `<option value="${preset.id}" ${preset.id === obj.animationPreset ? 'selected' : ''}>${preset.name}</option>`;
                        }).join('')}
                    </select>
                </div>
            </div>
        </div>    `;
    
    container.appendChild(objectDiv);
    
    // Position suffixes after rendering
    requestAnimationFrame(() => {
        requestAnimationFrame(positionSuffixes);
    });
}

function toggleCollapse(id) {
    const obj = textObjects.find(o => o.id === id);
    if (obj) {
        obj.collapsed = !obj.collapsed;
        const element = document.getElementById(`text-object-${id}`);
        if (obj.collapsed) {
            element.classList.add('collapsed');
        } else {
            element.classList.remove('collapsed');
        }
    }
}

function toggleAnimationSection(id) {
    const section = document.getElementById(`animation-section-${id}`);
    section.classList.toggle('collapsed');
}

function updateAnimationPreset(id, presetId) {
    const obj = textObjects.find(o => o.id === id);
    if (obj) {
        obj.animationPreset = presetId || null;
        
        if (!presetId) {
            // "None" selected - stop animation
            ipcRenderer.send('update-text-object-settings', { 
                id, 
                loopAnimation: false
            });
            // Don't re-render - that would trigger animation again
            return;
        }
        
        // Find the animation preset
        const preset = animationPresets.find(p => p.id === presetId);
        if (preset) {
            // Apply animation settings to the text object
            ipcRenderer.send('update-text-object-settings', { 
                id, 
                hopMin: preset.hopMin,
                hopMax: preset.hopMax,
                hopVariation: preset.hopVariation,
                charDelayStep: preset.charDelay,
                animationSpeed: preset.animSpeed,
                fadeIn: preset.fadeIn,
                fadeOut: preset.fadeOut,
                loopAnimation: preset.loopAnimation
            });
            
            // Trigger re-render to show new animation settings
            const shouldAnimate = obj.animationPreset !== null && obj.loopAnimation !== false;
            ipcRenderer.send('update-text-object', { 
                id: obj.id, 
                text: obj.text,
                shouldAnimate: shouldAnimate
            });
        }
    }
}

function createAnimationPreset() {
    const id = nextAnimationId++;
    
    const preset = {
        id: `animation-${id}`,
        name: `Animation ${id}`,
        animationType: 'hop',
        hopMax: 3,
        hopMin: -2,
        hopVariation: 3,
        charDelay: 0.03,
        animSpeed: 1.0,
        fadeIn: 0.4,
        fadeOut: 0,
        loopAnimation: true,
        collapsed: false
    };    animationPresets.push(preset);
    renderAnimationPreset(preset);
    updateAnimationDropdowns();
    
    // Position suffixes after rendering
    requestAnimationFrame(() => {
        requestAnimationFrame(positionSuffixes);
    });
}

function renderAnimationPreset(preset) {
    const container = document.getElementById('animation-presets-list');
    
    const presetDiv = document.createElement('div');
    presetDiv.className = 'text-object';
    presetDiv.id = `animation-preset-${preset.id}`;
    
    presetDiv.innerHTML = `<div class="text-object-header" onclick="toggleAnimationCollapse('${preset.id}')">
            <span class="collapse-arrow"></span>
            <input type="text" class="text-object-name" value="${preset.name}" 
                   onchange="updateAnimationName('${preset.id}', this.value)"
                   onclick="event.stopPropagation()">
            <button class="delete-btn" onclick="deleteAnimationPreset('${preset.id}', event)">×</button>
        </div>        <div class="text-object-body">
            <div class="control-group dark-bg">
                <label>Preset</label>
                <select id="anim-type-${preset.id}" onchange="updateAnimationType('${preset.id}', this.value)">
                    <option value="hop" ${preset.animationType === 'hop' ? 'selected' : ''}>Hop</option>
                    <option value="slide" ${preset.animationType === 'slide' ? 'selected' : ''}>Slide</option>
                    <option value="bounce" ${preset.animationType === 'bounce' ? 'selected' : ''}>Bounce</option>
                    <option value="fade" ${preset.animationType === 'fade' ? 'selected' : ''}>Fade</option>
                    <option value="custom" ${preset.animationType === 'custom' ? 'selected' : ''}>Custom</option>
                </select>
            </div>            <div id="hop-controls-${preset.id}" class="control-group" style="display: ${preset.animationType === 'hop' ? 'block' : 'none'}">
                <div class="position-container">
                    <div class="position-label">Hop Max</div>
                    <div class="position-inputs">
                        <div class="position-row">
                            <label></label>
                            ${createNumberInput(`hop-max-${preset.id}`, '0', '50', '1', preset.hopMax, `updateAnimationSetting('${preset.id}', 'hopMax', this.value)`, 'px')}
                        </div>
                    </div>
                </div>
                
                <div class="position-container">
                    <div class="position-label">Hop Min</div>
                    <div class="position-inputs">
                        <div class="position-row">
                            <label></label>
                            ${createNumberInput(`hop-min-${preset.id}`, '-50', '50', '1', preset.hopMin, `updateAnimationSetting('${preset.id}', 'hopMin', this.value)`, 'px')}
                        </div>
                    </div>
                </div>
                
                <div class="position-container">
                    <div class="position-label">Hop Variation</div>
                    <div class="position-inputs">
                        <div class="position-row">
                            <label></label>
                            ${createNumberInput(`hop-variation-${preset.id}`, '0', '50', '1', preset.hopVariation, `updateAnimationSetting('${preset.id}', 'hopVariation', this.value)`, 'px')}
                        </div>
                    </div>
                </div>
                
                <div class="position-container">
                    <div class="position-label">Char Delay</div>
                    <div class="position-inputs">
                        <div class="position-row">
                            <label></label>
                            ${createNumberInput(`char-delay-${preset.id}`, '0', '0.2', '0.01', preset.charDelay, `updateAnimationSetting('${preset.id}', 'charDelay', this.value)`, 's')}
                        </div>
                    </div>
                </div>                <div class="position-container">
                    <div class="position-label">Hop Speed</div>
                    <div class="position-inputs">
                        <div class="position-row">
                            <label></label>
                            ${createNumberInput(`anim-speed-${preset.id}`, '0.1', '5', '0.1', preset.animSpeed, `updateAnimationSetting('${preset.id}', 'animSpeed', this.value)`, 'x')}
                        </div>
                    </div>
                </div>
                
                <div class="position-container">
                    <div class="position-label">Fade In</div>
                    <div class="position-inputs">
                        <div class="position-row">
                            <label></label>
                            ${createNumberInput(`fade-in-${preset.id}`, '0', '2', '0.1', preset.fadeIn, `updateAnimationSetting('${preset.id}', 'fadeIn', this.value)`, 's')}
                        </div>
                    </div>
                </div>
                
                <div class="position-container">
                    <div class="position-label">Fade Out</div>
                    <div class="position-inputs">
                        <div class="position-row">
                            <label></label>
                            ${createNumberInput(`fade-out-${preset.id}`, '0', '2', '0.1', preset.fadeOut, `updateAnimationSetting('${preset.id}', 'fadeOut', this.value)`, 's')}
                        </div>
                    </div>
                </div>
                
                <div class="checkbox-row" style="margin-top: 8px;">
                    <input type="checkbox" id="loop-${preset.id}" ${preset.loopAnimation ? 'checked' : ''}
                           onchange="updateAnimationSetting('${preset.id}', 'loopAnimation', this.checked)">
                    <label for="loop-${preset.id}">Loop Animation</label>
                </div>
            </div>
            
            <div id="slide-controls-${preset.id}" class="control-group" style="display: ${preset.animationType === 'slide' ? 'block' : 'none'}">
                <p style="color: #666; font-size: 11px;">Slide controls coming soon...</p>
            </div>
            
            <div id="bounce-controls-${preset.id}" class="control-group" style="display: ${preset.animationType === 'bounce' ? 'block' : 'none'}">
                <p style="color: #666; font-size: 11px;">Bounce controls coming soon...</p>
            </div>
            
            <div id="fade-controls-${preset.id}" class="control-group" style="display: ${preset.animationType === 'fade' ? 'block' : 'none'}">
                <p style="color: #666; font-size: 11px;">Fade controls coming soon...</p>
            </div>            <div id="custom-controls-${preset.id}" class="control-group" style="display: ${preset.animationType === 'custom' ? 'block' : 'none'}">
                <!-- Transform -->
                <div class="collapsible-section collapsed" style="margin-bottom: 8px;">
                    <div class="collapsible-header">
                        <span class="collapsible-arrow"></span>
                        <label>Transform</label>
                    </div>
                    <div class="collapsible-content">
                        <p style="color: #666; font-size: 11px; padding: 8px 0;">Position, rotation, scale controls...</p>
                    </div>
                </div>
                
                <!-- Opacity -->
                <div class="collapsible-section collapsed" style="margin-bottom: 8px;">
                    <div class="collapsible-header">
                        <span class="collapsible-arrow"></span>
                        <label>Opacity</label>
                    </div>
                    <div class="collapsible-content">
                        <p style="color: #666; font-size: 11px; padding: 8px 0;">Fade, transparency controls...</p>
                    </div>
                </div>
                
                <!-- Motion -->
                <div class="collapsible-section collapsed" style="margin-bottom: 8px;">
                    <div class="collapsible-header">
                        <span class="collapsible-arrow"></span>
                        <label>Motion</label>
                    </div>
                    <div class="collapsible-content">
                        <p style="color: #666; font-size: 11px; padding: 8px 0;">Velocity, easing, path controls...</p>
                    </div>
                </div>
                
                <!-- Timing -->
                <div class="collapsible-section collapsed" style="margin-bottom: 8px;">
                    <div class="collapsible-header">
                        <span class="collapsible-arrow"></span>
                        <label>Timing</label>
                    </div>
                    <div class="collapsible-content">
                        <p style="color: #666; font-size: 11px; padding: 8px 0;">Duration, delay, frame rate controls...</p>
                    </div>
                </div>
                
                <!-- Sequencing -->
                <div class="collapsible-section collapsed" style="margin-bottom: 8px;">
                    <div class="collapsible-header">
                        <span class="collapsible-arrow"></span>
                        <label>Sequencing</label>
                    </div>
                    <div class="collapsible-content">
                        <p style="color: #666; font-size: 11px; padding: 8px 0;">Chain, sync, stagger controls...</p>
                    </div>
                </div>
                
                <!-- Effects -->
                <div class="collapsible-section collapsed" style="margin-bottom: 8px;">
                    <div class="collapsible-header">
                        <span class="collapsible-arrow"></span>
                        <label>Effects</label>
                    </div>
                    <div class="collapsible-content">
                        <p style="color: #666; font-size: 11px; padding: 8px 0;">Blur, glow, distortion, particles...</p>
                    </div>
                </div>
                
                <!-- Color -->
                <div class="collapsible-section collapsed" style="margin-bottom: 8px;">
                    <div class="collapsible-header">
                        <span class="collapsible-arrow"></span>
                        <label>Color</label>
                    </div>
                    <div class="collapsible-content">
                        <p style="color: #666; font-size: 11px; padding: 8px 0;">Gradient, tint, color shift controls...</p>
                    </div>
                </div>
                
                <!-- Physics -->
                <div class="collapsible-section collapsed" style="margin-bottom: 8px;">
                    <div class="collapsible-header">
                        <span class="collapsible-arrow"></span>
                        <label>Physics</label>
                    </div>
                    <div class="collapsible-content">
                        <p style="color: #666; font-size: 11px; padding: 8px 0;">Gravity, bounce, friction controls...</p>
                    </div>
                </div>
            </div>
        </div>
    `;    container.appendChild(presetDiv);
    
    // Add click handlers for collapsible sections in custom controls
    if (preset.animationType === 'custom') {
        const customControls = document.getElementById(`custom-controls-${preset.id}`);
        const collapsibleHeaders = customControls.querySelectorAll('.collapsible-header');
        collapsibleHeaders.forEach(header => {
            header.addEventListener('click', () => {
                const section = header.parentElement;
                section.classList.toggle('collapsed');
            });
        });
    }
}

function toggleAnimationCollapse(id) {
    const preset = animationPresets.find(p => p.id === id);
    if (preset) {
        preset.collapsed = !preset.collapsed;
        const element = document.getElementById(`animation-preset-${id}`);
        if (preset.collapsed) {
            element.classList.add('collapsed');
        } else {
            element.classList.remove('collapsed');
        }
    }
}

function deleteAnimationPreset(id, event) {
    event.stopPropagation();
    
    const index = animationPresets.findIndex(p => p.id === id);
    if (index !== -1) {
        animationPresets.splice(index, 1);
        document.getElementById(`animation-preset-${id}`).remove();        // Clear animation from any text objects using this preset
        textObjects.forEach(obj => {
            if (obj.animationPreset === id) {
                obj.animationPreset = null;
                // Stop animation on overlay
                ipcRenderer.send('update-text-object-settings', { 
                    id: obj.id, 
                    loopAnimation: false
                });
                // Don't re-render - that would trigger animation again
            }
        });
        
        updateAnimationDropdowns();
    }
}

function updateAnimationName(id, name) {
    const preset = animationPresets.find(p => p.id === id);
    if (preset) {
        preset.name = name;
        updateAnimationDropdowns();
    }
}

function updateAnimationSetting(id, setting, value) {
    const preset = animationPresets.find(p => p.id === id);
    if (preset) {
        // Round to 2 decimal places to avoid floating point precision issues
        if (setting === 'loopAnimation') {
            preset[setting] = value;
        } else {
            preset[setting] = Math.round(parseFloat(value) * 100) / 100;
        }
        
        // Apply to all text objects using this preset
        textObjects.forEach(obj => {
            if (obj.animationPreset === id) {                const settingsMap = {
                    hopMin: 'hopMin',
                    hopMax: 'hopMax',
                    hopVariation: 'hopVariation',
                    charDelay: 'charDelayStep',
                    animSpeed: 'animationSpeed',
                    fadeIn: 'fadeIn',
                    fadeOut: 'fadeOut',
                    loopAnimation: 'loopAnimation'
                };
                
                const settingKey = settingsMap[setting];
                if (settingKey) {
                    ipcRenderer.send('update-text-object-settings', { 
                        id: obj.id, 
                        [settingKey]: preset[setting]                    });
                    
                    // Trigger re-render to show new animation settings
                    const shouldAnimate = obj.animationPreset !== null && obj.loopAnimation !== false;
                    ipcRenderer.send('update-text-object', { 
                        id: obj.id, 
                        text: obj.text,
                        shouldAnimate: shouldAnimate
                    });
                }
            }
        });
    }
}

function updateAnimationDropdowns() {
    // Update all animation preset dropdowns in text objects
    textObjects.forEach(obj => {
        const dropdown = document.getElementById(`animation-preset-${obj.id}`);
        if (dropdown) {
            const currentValue = dropdown.value;            // Always include a "None" option at the top
            const options = ['<option value="">None</option>'];
            
            options.push(...animationPresets.map(preset => {
                return `<option value="${preset.id}">${preset.name}</option>`;
            }));
            
            dropdown.innerHTML = options.join('');
            
            // If the object's preset was deleted or doesn't exist, select "None"
            if (!obj.animationPreset || !animationPresets.find(p => p.id === obj.animationPreset)) {
                dropdown.value = '';
                obj.animationPreset = null;
            } else {
                dropdown.value = obj.animationPreset;
            }
        }
    });

}


function toggleOutlineSection(id) {
    const section = document.getElementById(`outline-section-${id}`);
    if (section) {
        section.classList.toggle('collapsed');
    }
}

function updateObjectName(id, name) {
    const obj = textObjects.find(o => o.id === id);
    if (obj) {
        obj.name = name;
    }
}

function deleteTextObject(id, event) {
    event.stopPropagation();
    
    const index = textObjects.findIndex(o => o.id === id);
    if (index !== -1) {
        textObjects.splice(index, 1);
        document.getElementById(`text-object-${id}`).remove();
        ipcRenderer.send('delete-text-object', id);
    }
}

function updateInputMode(id, mode) {
    const obj = textObjects.find(o => o.id === id);
    if (obj) {
        // If switching away from file mode, stop file watching
        if (obj.inputMode === 'file' && mode !== 'file') {
            ipcRenderer.send('stop-file-watch');
        }
        
        obj.inputMode = mode;
        
        // Show/hide mode-specific controls
        document.getElementById(`manual-input-${id}`).style.display = mode === 'manual' ? 'block' : 'none';
        document.getElementById(`file-input-${id}`).style.display = mode === 'file' ? 'block' : 'none';
        document.getElementById(`stream-input-${id}`).style.display = mode === 'stream' ? 'block' : 'none';
    }
}

function updateText(id) {
    const obj = textObjects.find(o => o.id === id);
    if (obj) {
        const text = document.getElementById(`text-input-${id}`).value;
        obj.text = text;
        
        // Determine if this text object should animate
        const shouldAnimate = obj.animationPreset !== null && obj.loopAnimation !== false;
        
        ipcRenderer.send('update-text-object', { 
            id, 
            text,
            shouldAnimate: shouldAnimate
        });
    }
}

function selectFile(id) {
    ipcRenderer.send('open-file-dialog', id);
}

function connectStream(id) {
    const service = document.getElementById(`stream-service-${id}`).value;    const dataType = document.getElementById(`stream-data-type-${id}`).value;
    
    if (!service || !dataType) {
        return;
    }
    
    // Check if API key is configured
    const apiKeyField = service === 'twitch' ? 'twitch-api-key' : 'streamlabs-api-key';
    const apiKey = document.getElementById(apiKeyField).value;
    
    if (!apiKey) {
        return;
    }
    
    // TODO: Implement actual stream connection
}

function saveProject(autoSave = false) {
    // Gather all project data (NO API KEYS - they're in keychain now)
    const projectData = {
        version: '1.0',
        textObjects: textObjects,
        animationObjects: animationPresets,
        scripts: scripts.map(script => ({
            ...script,
            isRunning: runningScripts.has(script.id)
        })),
        globalSettings: globalSettings,
        savedAt: new Date().toISOString()
    };
    
    if (autoSave && currentProjectFile) {
        // Auto-save to existing file without dialog
        ipcRenderer.send('save-project-to-path', { projectData, filePath: currentProjectFile });
    } else {
        // Show save dialog
        ipcRenderer.send('save-project', projectData);
    }
}

function loadProject() {
    // Send to main process to open file dialog
    ipcRenderer.send('load-project');
}

// Show auto-save notification
function showAutoSaveNotification() {
    showToast('Project auto-saved', 'success');
}

// Generic toast notification function
function showToast(message, type = 'info') {
    const colors = {
        success: '#4ade80',
        error: '#ff5555',
        info: '#5e94ce',
        warning: '#ffaa55'
    };
    
    const icons = {
        success: '✓',
        error: '✕',
        info: 'ⓘ',
        warning: '⚠'
    };    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: #2e2e2e;
        color: ${colors[type] || colors.info};
        padding: 12px 20px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 600;
        z-index: 10000;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        animation: slideIn 0.3s ease-out;
        display: flex;
        align-items: center;
        gap: 8px;
    `;
    
    const icon = document.createElement('span');
    icon.style.cssText = `
        font-size: 14px;
        font-weight: bold;
    `;
    icon.textContent = icons[type] || icons.info;
    
    const text = document.createElement('span');
    text.textContent = message;
    
    toast.appendChild(icon);
    toast.appendChild(text);
    
    // Add animation styles if not already present
    if (!document.getElementById('toast-animations')) {
        const style = document.createElement('style');
        style.id = 'toast-animations';
        style.textContent = `
            @keyframes slideIn {
                from { transform: translateX(400px); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
            @keyframes slideOut {
                from { transform: translateX(0); opacity: 1; }
                to { transform: translateX(400px); opacity: 0; }
            }
        `;
        document.head.appendChild(style);
    }
    
    document.body.appendChild(toast);
    
    // Remove after 2 seconds
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => toast.remove(), 300);
    }, 2000);
}

// Handle project loaded from main process
ipcRenderer.on('project-loaded', (event, { projectData, filePath }) => {
    try {
        // Track the loaded file path
        currentProjectFile = filePath;        // Clear existing text objects
        textObjects.forEach(obj => {
            ipcRenderer.send('delete-text-object', obj.id);
        });
        textObjects = [];
        document.getElementById('text-objects-list').innerHTML = '';
        
        // Clear existing animation presets
        animationPresets = [];
        document.getElementById('animation-presets-list').innerHTML = '';        // Clear existing scripts
        scripts.forEach(s => {
            if (monacoEditors[s.id]) {
                monacoEditors[s.id].dispose();
                delete monacoEditors[s.id];
            }
        });
        scripts = [];
        document.getElementById('scripts-list').innerHTML = '';
        
        // Load global settings
        if (projectData.globalSettings) {
            globalSettings.backgroundColor = projectData.globalSettings.backgroundColor;
            globalSettings.backgroundTransparent = projectData.globalSettings.backgroundTransparent;
            
            // Update UI
            const hexColor = '#' + projectData.globalSettings.backgroundColor.toString(16).padStart(6, '0');
            document.getElementById('bg-color').value = hexColor;
            document.getElementById('bg-transparent').checked = projectData.globalSettings.backgroundTransparent;            // Send to overlay
            ipcRenderer.send('update-background', globalSettings);
        }
        
        // API keys are now loaded from keychain on startup, not from project files        // Load animation objects first
        if (projectData.animationObjects && projectData.animationObjects.length > 0) {
            nextAnimationId = Math.max(...projectData.animationObjects.map(a => parseInt(a.id.replace('animation-', '')))) + 1;
            
            projectData.animationObjects.forEach(preset => {
                animationPresets.push(preset);
                renderAnimationPreset(preset);
            });
        } else {
            // Create default animation preset if none loaded
            createAnimationPreset();
        }        // Load scripts
        if (projectData.scripts && projectData.scripts.length > 0) {
            nextScriptId = Math.max(...projectData.scripts.map(s => s.id)) + 1;
            
            projectData.scripts.forEach(script => {
                scripts.push(script);
                renderScript(script);
            });
            
            // Auto-run scripts that were running when project was saved
            setTimeout(() => {
                projectData.scripts.forEach(script => {
                    if (script.isRunning) {
                        runScript(script.id);
                    }
                });
            }, 500); // Small delay to ensure everything is initialized
        } else {
            // Create default blank script if none loaded
            createScript();
        }        // Load text objects
        if (projectData.textObjects && projectData.textObjects.length > 0) {
            nextObjectId = Math.max(...projectData.textObjects.map(o => o.id)) + 1;            projectData.textObjects.forEach(obj => {
                textObjects.push(obj);
                renderTextObject(obj);
                ipcRenderer.send('create-text-object', obj);
                
                // Apply animation preset settings if object has one
                if (obj.animationPreset) {
                    const preset = animationPresets.find(p => p.id === obj.animationPreset);
                    if (preset) {
                        ipcRenderer.send('update-text-object-settings', { 
                            id: obj.id, 
                            hopMin: preset.hopMin,
                            hopMax: preset.hopMax,
                            hopVariation: preset.hopVariation,
                            charDelayStep: preset.charDelay,
                            animationSpeed: preset.animSpeed,
                            fadeIn: preset.fadeIn,
                            fadeOut: preset.fadeOut,
                            loopAnimation: preset.loopAnimation
                        });
                    }
                }
            });
            
            // Refresh font dropdowns to include custom fonts
            refreshAllFontDropdowns();
        } else {
            // Create default object if none loaded
            createTextObject();
        }
        
        showToast('Project loaded', 'success');
    } catch (error) {
        console.error('Error loading project:', error);
        showToast('Error loading project', 'error');
    }
});

ipcRenderer.on('project-saved', (event, { filePath, autoSave }) => {
    const wasFirstSave = !currentProjectFile;
    currentProjectFile = filePath;
    
    if (autoSave) {
        // Show brief toast notification for auto-save
        showAutoSaveNotification();
    } else {
        // Show success toast for manual saves
        showToast('Project saved', 'success');
        
        // If this was the first save and auto-save is checked, start the interval
        if (wasFirstSave) {
            const autoSaveCheckbox = document.getElementById('auto-save-enabled');
            if (autoSaveCheckbox && autoSaveCheckbox.checked) {
                // Trigger the change event to start auto-save
                autoSaveCheckbox.dispatchEvent(new Event('change'));
            }
        }
    }
});

ipcRenderer.on('project-save-error', (event, error) => {
    console.error('Save error:', error);
    showToast('Failed to save project', 'error');
});

function updatePosition(id, silent = false) {
    const obj = textObjects.find(o => o.id === id);
    if (obj) {
        const xValue = document.getElementById(`pos-x-${id}`).value;
        const yValue = document.getElementById(`pos-y-${id}`).value;
        
        obj.positionX = (xValue === 'auto' || xValue === '') ? null : parseInt(xValue);
        obj.positionY = (yValue === 'auto' || yValue === '') ? null : parseInt(yValue);
        
        ipcRenderer.send('update-text-object-position', { id, x: obj.positionX, y: obj.positionY, silent });
    }
}

function resetPosition(id) {
    const obj = textObjects.find(o => o.id === id);
    if (obj) {
        // Request overlay to calculate and return center position
        ipcRenderer.send('reset-text-position', { id });
    }
}

// Handle center position response from overlay
ipcRenderer.on('center-position-calculated', (event, { id, x, y }) => {
    const obj = textObjects.find(o => o.id === id);
    if (obj) {
        obj.positionX = x;
        obj.positionY = y;
        document.getElementById(`pos-x-${id}`).value = x;
        document.getElementById(`pos-y-${id}`).value = y;
    }
});

async function updateFont(id, fontFamily) {
    const obj = textObjects.find(o => o.id === id);
    if (obj) {
        obj.fontFamily = fontFamily;
        
        // Track font usage
        fontUsageCount[fontFamily] = (fontUsageCount[fontFamily] || 0) + 1;
        ipcRenderer.send('update-user-setting', {
            path: 'fontUsageCount',
            value: fontUsageCount
        });
        
        // Load Google Font if needed and WAIT for it to finish
        if (GOOGLE_FONTS.includes(fontFamily) && !loadedGoogleFonts.has(fontFamily)) {
            await loadGoogleFont(fontFamily);
        }
        
        // Font changes should be silent - don't re-trigger animation
        ipcRenderer.send('update-text-object-settings', { id, fontFamily, silent: true });
    }
}

// Load a Google Font dynamically
async function loadGoogleFont(fontFamily) {
    if (loadedGoogleFonts.has(fontFamily)) return;
    
    try {
        // Load from local fonts folder - try multiple formats
        const fontFileName = fontFamily.replace(/ /g, '-');
        
        const style = document.createElement('style');
        style.textContent = `
            @font-face {
                font-family: "${fontFamily}";
                src: url("fonts/${fontFileName}.woff2") format("woff2"),
                     url("fonts/${fontFileName}.woff") format("woff"),
                     url("fonts/${fontFileName}.ttf") format("truetype"),
                     url("fonts/${fontFileName}.otf") format("opentype");
                font-weight: 400 700;
                font-display: swap;
            }
        `;
        document.head.appendChild(style);
        
        // Wait for font to actually load        await document.fonts.load(`12px "${fontFamily}"`);
        
        loadedGoogleFonts.add(fontFamily);
        
        // Don't send to overlay - fonts already loaded at startup via IPC (lines 152-206)
        // ipcRenderer.send('load-google-font', { fontFamily, fontFileName });
    } catch (error) {
        console.error(`Failed to load font ${fontFamily}:`, error);
    }
}

// Load a custom font file
async function loadCustomFont(fontFamily, fontPath) {
    try {
        // Use CSS @font-face to load the font
        const style = document.createElement('style');
        style.textContent = `
            @font-face {
                font-family: "${fontFamily}";
                src: url("file://${fontPath.replace(/\\/g, '/')}");
            }
        `;
        document.head.appendChild(style);
        
        // CRITICAL: Force browser to actually load the font
        // Create invisible text to trigger font load
        const testDiv = document.createElement('div');
        testDiv.style.fontFamily = fontFamily;
        testDiv.style.position = 'absolute';
        testDiv.style.opacity = '0';
        testDiv.textContent = 'Font Load Test';
        document.body.appendChild(testDiv);
        
        // Wait for font to actually load
        await document.fonts.load(`12px "${fontFamily}"`);
        
        // Clean up test element
        document.body.removeChild(testDiv);
        
        // Also send to overlay
        ipcRenderer.send('load-custom-font', { fontFamily, fontPath });
    } catch (error) {
        console.error(`[Fonts] Failed to load ${fontFamily}:`, error);
    }
}

// Import a custom font from file
async function importCustomFont(textObjectId) {
    ipcRenderer.send('open-font-dialog', textObjectId);
}

// Refresh font dropdown for a specific text object
function refreshFontDropdown(textObjectId) {
    const select = document.getElementById(`font-family-${textObjectId}`);
    if (!select) return;
    
    const currentValue = select.value;
    
    // Rebuild options
    let options = `
        <option value="Inter">Inter</option>
        <option value="Instrument Serif">Instrument Serif</option>
        <option value="Arial">Arial</option>
        <option value="Courier New">Courier New</option>
        <option value="Times New Roman">Times New Roman</option>
        <option value="Comic Sans MS">Comic Sans MS</option>
        <option value="Impact">Impact</option>
    `;
    
    // Add custom fonts
    customFonts.forEach(font => {
        options += `<option value="${font.family}">${font.family}</option>`;
    });
    
    select.innerHTML = options;
    select.value = currentValue;
}

// Refresh all font dropdowns
function refreshAllFontDropdowns() {
    textObjects.forEach(obj => {
        refreshFontDropdown(obj.id);
    });
}

function updateFontSize(id, size) {
    const obj = textObjects.find(o => o.id === id);
    if (obj) {
        obj.fontSize = parseInt(size);
        // Use silent: true to prevent re-animating on every change
        ipcRenderer.send('update-text-object-settings', { id, fontSize: obj.fontSize, silent: true });
    }
}

function updateColor(id, color) {
    const obj = textObjects.find(o => o.id === id);
    if (obj) {
        obj.color = parseInt(color.replace('#', '0x'));
        ipcRenderer.send('update-text-object-settings', { id, color: obj.color });
    }
}

function updateLoop(id, loop) {
    const obj = textObjects.find(o => o.id === id);
    if (obj) {
        obj.loopAnimation = loop;
        ipcRenderer.send('update-text-object-settings', { id, loopAnimation: loop });
    }
}

function updateOutlineEnabled(id, enabled) {
    const obj = textObjects.find(o => o.id === id);
    if (obj) {
        obj.outlineEnabled = enabled;
        // Show/hide outline controls
        document.getElementById(`outline-controls-${id}`).style.display = enabled ? 'block' : 'none';
        ipcRenderer.send('update-text-object-settings', { id, outlineEnabled: enabled });
    }
}

function updateOutlineColor(id, color) {
    const obj = textObjects.find(o => o.id === id);
    if (obj) {
        obj.outlineColor = parseInt(color.replace('#', '0x'));
        ipcRenderer.send('update-text-object-settings', { id, outlineColor: obj.outlineColor });
    }
}

function updateOutlineWidth(id, width) {
    const obj = textObjects.find(o => o.id === id);
    if (obj) {
        obj.outlineWidth = parseInt(width);
        document.getElementById(`outline-width-value-${id}`).textContent = width + 'x';
        ipcRenderer.send('update-text-object-settings', { id, outlineWidth: obj.outlineWidth });
    }
}

// Make functions globally accessible
window.toggleCollapse = toggleCollapse;
window.toggleOutlineSection = toggleOutlineSection;
window.toggleDefaultSettings = () => {
    const section = document.getElementById('default-settings-section');
    if (section) {
        section.classList.toggle('collapsed');
    }
};
window.updateObjectName = updateObjectName;
window.deleteTextObject = deleteTextObject;
window.updateInputMode = updateInputMode;
window.updateText = updateText;
window.selectFile = selectFile;
window.connectStream = connectStream;
window.updatePosition = updatePosition;
window.resetPosition = resetPosition;
window.updateFont = updateFont;
window.updateFontSize = updateFontSize;
window.updateColor = updateColor;
window.updateLoop = updateLoop;
window.updateOutlineEnabled = updateOutlineEnabled;
window.updateOutlineColor = updateOutlineColor;
window.updateOutlineWidth = updateOutlineWidth;
window.toggleAnimationSection = toggleAnimationSection;
window.updateAnimationPreset = updateAnimationPreset;
function updateAnimationType(id, type) {
    const preset = animationPresets.find(p => p.id === id);
    if (preset) {
        preset.animationType = type;
        
        // Hide all control groups
        document.getElementById(`hop-controls-${id}`).style.display = 'none';
        document.getElementById(`slide-controls-${id}`).style.display = 'none';
        document.getElementById(`bounce-controls-${id}`).style.display = 'none';
        document.getElementById(`fade-controls-${id}`).style.display = 'none';
        document.getElementById(`custom-controls-${id}`).style.display = 'none';
        
        // Show the selected type's controls
        document.getElementById(`${type}-controls-${id}`).style.display = 'block';
    }
}

window.updateAnimationType = updateAnimationType;
window.toggleAnimationCollapse = toggleAnimationCollapse;
window.deleteAnimationPreset = deleteAnimationPreset;
window.updateAnimationName = updateAnimationName;
window.updateAnimationSetting = updateAnimationSetting;

// ===== FONT PICKER FUNCTIONS =====

// Toggle font picker dropdown
function toggleFontPicker(id) {
    const dropdown = document.getElementById(`font-dropdown-${id}`);
    const isVisible = dropdown.style.display === 'block';
    
    // Close all other font pickers
    document.querySelectorAll('.font-picker-dropdown').forEach(d => {
        d.style.display = 'none';
    });
    
    if (!isVisible) {
        dropdown.style.display = 'block';
        renderFontList(id);
        // Focus search input
        const searchInput = document.getElementById(`font-search-${id}`);
        if (searchInput) {
            setTimeout(() => searchInput.focus(), 10);
        }
    }
}

// Render font list with sections
function renderFontList(id, filter = '') {
    const listContainer = document.getElementById(`font-list-${id}`);
    if (!listContainer) return;
    
    const filterLower = filter.toLowerCase();
    let html = '';
    
    // Get recent fonts (top 3 most used)
    const recentFonts = Object.entries(fontUsageCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([font]) => font)
        .filter(font => !filter || font.toLowerCase().includes(filterLower));
    
    // Filter and SORT system fonts alphabetically
    const systemFiltered = SYSTEM_FONTS
        .filter(font => !filter || font.toLowerCase().includes(filterLower))
        .sort((a, b) => a.localeCompare(b));
    
    // Filter and SORT Google fonts alphabetically
    const googleFiltered = GOOGLE_FONTS
        .filter(font => !filter || font.toLowerCase().includes(filterLower))
        .sort((a, b) => a.localeCompare(b));
    
    // Filter and SORT custom fonts alphabetically
    const customFiltered = customFonts
        .filter(font => !filter || font.family.toLowerCase().includes(filterLower))
        .sort((a, b) => a.family.localeCompare(b.family));
    
    // Recent section (don't sort - keep by usage)
    if (recentFonts.length > 0 && !filter) {
        html += '<div class="font-section-header">⭐ Recent</div>';
        recentFonts.forEach(font => {
            html += `<div class="font-option" onclick="selectFont(${id}, '${font}')">${font}</div>`;
        });
    }
    
    // System fonts section
    if (systemFiltered.length > 0) {
        html += '<div class="font-section-header">📦 System Fonts</div>';
        systemFiltered.forEach(font => {
            html += `<div class="font-option" onclick="selectFont(${id}, '${font}')">${font}</div>`;
        });
    }
    
    // Google fonts section
    if (googleFiltered.length > 0) {
        html += '<div class="font-section-header">🌐 Google Fonts</div>';
        googleFiltered.forEach(font => {
            html += `<div class="font-option" onclick="selectFont(${id}, '${font}')">${font}</div>`;
        });
    }
    
    // Custom fonts section
    if (customFiltered.length > 0) {
        html += '<div class="font-section-header">✨ Custom Fonts</div>';
        customFiltered.forEach(font => {
            html += `<div class="font-option" onclick="selectFont(${id}, '${font.family}')">${font.family}</div>`;
        });
    }
    
    if (!html) {
        html = '<div style="padding: 10px; color: #666; text-align: center;">No fonts found</div>';
    }
    
    listContainer.innerHTML = html;
}

// Filter fonts based on search
function filterFonts(id, query) {
    renderFontList(id, query);
}

// Select a font
function selectFont(id, fontFamily) {
    // Update display
    const selectedText = document.getElementById(`font-selected-${id}`);
    if (selectedText) {
        selectedText.textContent = fontFamily;
    }
    
    // Close dropdown
    const dropdown = document.getElementById(`font-dropdown-${id}`);
    if (dropdown) {
        dropdown.style.display = 'none';
    }
    
    // Clear search
    const searchInput = document.getElementById(`font-search-${id}`);
    if (searchInput) {
        searchInput.value = '';
    }
    
    // Update font
    updateFont(id, fontFamily);
}

// Close font pickers when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.font-picker')) {
        document.querySelectorAll('.font-picker-dropdown').forEach(d => {
            d.style.display = 'none';
        });
    }
});

// Make functions globally accessible
window.toggleFontPicker = toggleFontPicker;
window.renderFontList = renderFontList;
window.filterFonts = filterFonts;
window.selectFont = selectFont;

// File selection response
ipcRenderer.on('file-selected', (event, { id, filePath }) => {
    const obj = textObjects.find(o => o.id === id);
    if (obj) {
        obj.filePath = filePath;
        document.getElementById(`file-path-${id}`).value = filePath;
        ipcRenderer.send('start-file-watch', { id, filePath });
    }
});

// Font selection response
ipcRenderer.on('font-selected', (event, { textObjectId, fontPath, fontName }) => {
    const fontFamily = fontName; // Already the correct name from opentype.js parsing
    
    // Check if already imported
    if (customFonts.find(f => f.family === fontFamily)) {
        showToast(`Font "${fontFamily}" already imported`, 'info');
        return;
    }
    
    customFonts.push({ family: fontFamily, path: fontPath });
    
    // Load the font
    loadCustomFont(fontFamily, fontPath);
    
    // Save to user settings
    ipcRenderer.send('update-user-setting', {
        path: 'customFonts',
        value: customFonts
    });
    
    // Refresh all font dropdowns
    setTimeout(() => {
        refreshAllFontDropdowns();
        
        // Auto-select the new font for this text object
        const obj = textObjects.find(o => o.id === textObjectId);
        if (obj) {
            obj.fontFamily = fontFamily;
            const select = document.getElementById(`font-family-${textObjectId}`);
            if (select) {
                select.value = fontFamily;
            }
            ipcRenderer.send('update-text-object-settings', { id: textObjectId, fontFamily });
        }        showToast(`Font "${fontFamily}" imported!`, 'success');
    }, 100);
});

// OBJ file parser
function parseOBJ(objText) {
    const lines = objText.split('\n');
    const vertices = [];
    const faces = [];
    
    for (let line of lines) {
        line = line.trim();
        
        // Skip comments and empty lines
        if (line.startsWith('#') || line === '') continue;
        
        const parts = line.split(/\s+/);
        const type = parts[0];
        
        if (type === 'v') {
            // Vertex: v x y z
            const x = parseFloat(parts[1]);
            const y = parseFloat(parts[2]);
            const z = parseFloat(parts[3]);
            vertices.push([x, y, z]);
        } else if (type === 'f') {
            // Face: f v1/vt1/vn1 v2/vt2/vn2 v3/vt3/vn3
            // We only care about vertex indices
            const v1 = parseInt(parts[1].split('/')[0]) - 1; // OBJ indices start at 1
            const v2 = parseInt(parts[2].split('/')[0]) - 1;
            const v3 = parseInt(parts[3].split('/')[0]) - 1;
            faces.push([v1, v2, v3]);
            
            // If face has 4 vertices (quad), split into two triangles
            if (parts.length > 4) {
                const v4 = parseInt(parts[4].split('/')[0]) - 1;
                faces.push([v1, v3, v4]);
            }
        }
    }
    
    return { vertices, faces };
}

// Generate JavaScript code from parsed OBJ
function generateOBJCode(vertices, faces, modelName) {
    // Auto-scale: find the largest dimension and scale to ~200 units
    let maxDim = 0;
    for (let v of vertices) {
        maxDim = Math.max(maxDim, Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2]));
    }    const scale = maxDim > 0 ? 150 / maxDim : 100;
    
    let code = `// 3D Model: ${modelName}\n`;
    code += `// Auto-scaled by ${scale.toFixed(2)}x\n`;
    code += `const ${modelName}Vertices = [\n`;
    
    // Add vertices with scaling (flip Y to fix upside down)
    for (let i = 0; i < vertices.length; i++) {
        const v = vertices[i];
        code += `    [${(v[0] * scale).toFixed(2)}, ${(-v[1] * scale).toFixed(2)}, ${(v[2] * scale).toFixed(2)}]`;
        if (i < vertices.length - 1) code += ',';
        code += '\n';
    }
    code += '];\n\n';
    
    code += `const ${modelName}Faces = [\n`;
    
    // Add faces
    for (let i = 0; i < faces.length; i++) {
        const f = faces[i];
        code += `    [${f[0]}, ${f[1]}, ${f[2]}]`;
        if (i < faces.length - 1) code += ',';
        code += '\n';
    }
    code += '];\n\n';    // Add example animation code
    code += `// Simple horizontal rotation\n`;
    code += `let angle = 0;\n\n`;
    code += `startAnimation(function() {\n`;
    code += `    const projected = ${modelName}Vertices.map(v => {\n`;
    code += `        let rotated = rotateY(v[0], v[1], v[2], angle);\n`;
    code += `        return project3D(rotated.x, rotated.y, rotated.z);\n`;
    code += `    });\n\n`;
    code += `    const triangles = [];\n`;
    code += `    ${modelName}Faces.forEach(face => {\n`;
    code += `        const v1 = projected[face[0]];\n`;
    code += `        const v2 = projected[face[1]];\n`;
    code += `        const v3 = projected[face[2]];\n`;
    code += `        triangles.push({\n`;
    code += `            x1: v1.x, y1: v1.y,\n`;
    code += `            x2: v2.x, y2: v2.y,\n`;
    code += `            x3: v3.x, y3: v3.y,\n`;
    code += `            color: 0xCCCCCC  // Gray/white color\n`;
    code += `        });\n`;
    code += `    });\n\n`;
    code += `    drawTriangles(triangles);\n`;
    code += `    angle += 0.01;  // Slower rotation\n`;
    code += `});\n`;
    
    return code;
}

// OBJ file selection response
ipcRenderer.on('obj-file-selected', (event, { filePath, content }) => {
    try {        // Parse OBJ file
        const { vertices, faces } = parseOBJ(content);
        
        // Get model name from filename (path is already required at top of file)
        const fileName = path.basename(filePath, '.obj');
        const modelName = fileName.replace(/[^a-zA-Z0-9]/g, ''); // Remove special chars
        
        // Generate JavaScript code
        const code = generateOBJCode(vertices, faces, modelName);
        
        // Create a new script with the generated code
        const id = nextScriptId++;
        const script = {
            id: id,
            name: `${fileName} Model`,
            code: code,
            isRunning: false        };
        
        scripts.push(script);
        renderScript(script);
        
        showToast(`Imported ${vertices.length} vertices, ${faces.length} faces`, 'success');
        
    } catch (error) {
        showToast(`Error parsing OBJ file: ${error.message}`, 'error');
    }
});

// File content updates
ipcRenderer.on('file-content-update', (event, { id, content }) => {
    const obj = textObjects.find(o => o.id === id);
    if (obj) {
        obj.text = content;
        
        // Determine if this text object should animate
        const shouldAnimate = obj.animationPreset !== null && obj.loopAnimation !== false;
        
        ipcRenderer.send('update-text-object', { 
            id, 
            text: content,
            shouldAnimate: shouldAnimate
        });
    }
});

// Position updates from overlay (during drag)
ipcRenderer.on('position-updated', (event, { id, x, y }) => {
    const obj = textObjects.find(o => o.id === id);
    if (obj) {
        obj.positionX = x;
        obj.positionY = y;
        // Update the input fields
        const xInput = document.getElementById(`pos-x-${id}`);
        const yInput = document.getElementById(`pos-y-${id}`);
        if (xInput) xInput.value = x;
        if (yInput) yInput.value = y;
    }
});

// Position drag ended - record for undo
ipcRenderer.on('position-drag-ended', (event, { id, oldX, oldY, newX, newY }) => {
    recordPositionChange(id, oldX, oldY, newX, newY);
});

// Undo/Redo triggered from overlay window
ipcRenderer.on('trigger-undo', () => {
    undoPosition();
});

ipcRenderer.on('trigger-redo', () => {
    redoPosition();
});

// API Key management
ipcRenderer.on('all-api-keys-retrieved', (event, keys) => {
    // Load API keys into UI
    if (keys.twitch) {
        document.getElementById('twitch-api-key').value = keys.twitch;
    }
    if (keys.streamlabs) {
        document.getElementById('streamlabs-api-key').value = keys.streamlabs;
    }
});

ipcRenderer.on('api-key-saved', (event, { keyType, success }) => {
    if (success) {
        showToast('API key saved securely', 'success');
    } else {
        showToast('Failed to save API key', 'error');
    }
});

// Accent color functionality
function applyAccentColor(color) {
    // Update all SVG icons
    document.querySelectorAll('.sidebar-icon svg').forEach(svg => {
        svg.setAttribute('stroke', color);
    });

    // Update button backgrounds
    document.documentElement.style.setProperty('--accent-color', color);
    const buttons = document.querySelectorAll('button:not(.secondary):not(.window-btn)');
    buttons.forEach(btn => {
        btn.style.backgroundColor = color;
    });

    // Update checkboxes
    const style = document.createElement('style');
    style.id = 'accent-color-override';
    const existingStyle = document.getElementById('accent-color-override');
    if (existingStyle) existingStyle.remove();

    style.textContent = `
            .checkbox-row input[type="checkbox"]:checked {
                background: ${color} !important;
            }
            input[type="range"]::-webkit-slider-thumb {
                background: ${color} !important;
            }
            .range-value {
                color: ${color} !important;
            }
        `;
    document.head.appendChild(style);
}  

// User settings management
ipcRenderer.on('user-settings-loaded', (event, loadedSettings) => {

    // Load custom fonts FIRST
    if (loadedSettings.customFonts && Array.isArray(loadedSettings.customFonts)) {
        customFonts = loadedSettings.customFonts;
        // Load each custom font asynchronously
        Promise.all(customFonts.map(font => loadCustomFont(font.family, font.path))).then(() => {
            // After all fonts loaded, refresh any existing dropdowns
            refreshAllFontDropdowns();
        });
    }
    
    // Load font usage stats
    if (loadedSettings.fontUsageCount) {
        fontUsageCount = loadedSettings.fontUsageCount;
    }

    // Apply UI settings
    if (loadedSettings.ui) {
        if (loadedSettings.ui.accentColor) {
            document.getElementById('accent-color').value = loadedSettings.ui.accentColor;
            applyAccentColor(loadedSettings.ui.accentColor);
        }        if (loadedSettings.ui.showOverlayControls !== undefined) {
            document.getElementById('show-overlay-controls').checked = loadedSettings.ui.showOverlayControls;
        }
        // ALWAYS start with click-through disabled for safety
        document.getElementById('enable-click-through').checked = false;
        ipcRenderer.send('toggle-click-through', false);
    }
    
    // Apply default settings
    if (loadedSettings.defaults) {
        if (loadedSettings.defaults.fontSize !== undefined) {
            const elem = document.getElementById('default-font-size');
        
            if (elem) {
                elem.value = loadedSettings.defaults.fontSize;
            }
        } else {
            document.getElementById('default-font-size').value = 48;
        }
        if (loadedSettings.defaults.startingText) {
            document.getElementById('default-starting-text').value = loadedSettings.defaults.startingText;
        }
        if (loadedSettings.defaults.animationPreset) {
            document.getElementById('default-animation-preset').value = loadedSettings.defaults.animationPreset;
        }
    } else {
        document.getElementById('default-font-size').value = 48;
    }    // Apply auto-save settings
    if (loadedSettings.autoSave) {
        if (loadedSettings.autoSave.enabled) {
            document.getElementById('auto-save-enabled').checked = loadedSettings.autoSave.enabled;
        }
        if (loadedSettings.autoSave.interval) {
            document.getElementById('auto-save-interval').value = loadedSettings.autoSave.interval;
        }
    }
    
    // Load last project file if it exists
    if (loadedSettings.lastProjectFile) {
        currentProjectFile = loadedSettings.lastProjectFile;
    }
});
// Handle text object focus from overlay
ipcRenderer.on('text-object-focused', (event, id) => {
    // Remove focus from all items
    document.querySelectorAll('.text-object').forEach(el => {
        el.classList.remove('focused');
    });
    
    if (id !== null) {
        const textObj = textObjects.find(obj => obj.id === id);
        
        if (textObj) {
            // Always highlight the text object itself
            const textElement = document.getElementById(`text-object-${id}`);
            if (textElement) {
                textElement.classList.add('focused');
            }
            
            // Also highlight animation if it has one
            if (textObj.animationPreset !== null) {
                const animElement = document.getElementById(`animation-preset-${textObj.animationPreset}`);
                if (animElement) {
                    animElement.classList.add('focused');
                }
            }
            
            // Also highlight script if created by one
            if (textObj.createdByScript !== undefined) {
                const scriptElement = document.getElementById(`script-${textObj.createdByScript}`);
                if (scriptElement) {
                    scriptElement.classList.add('focused');
                }
            }
        }
    }
});

// Create initial text object on startup
window.addEventListener('DOMContentLoaded', () => {
    // Load API keys from keychain
    ipcRenderer.send('get-all-api-keys');    // LOAD ALL LOCAL FONTS FROM fonts/ DIRECTORY
    loadLocalFontsFromDirectory();
    
    // CRITICAL: Always initialize click-through as disabled on startup
    document.getElementById('enable-click-through').checked = false;
    
    // Settings will be automatically sent via did-finish-load event in main.js    // Create default animation preset first
    createAnimationPreset();
    
    // Create default blank script
    createScript();
    
    // Create text object after a short delay to ensure animation is ready
    // Use requestAnimationFrame to ensure DOM updates are complete
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            createTextObject();
        });
    });    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Ctrl+S to save
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            saveProject();
        }
        // Ctrl+Z to undo position
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            undoPosition();
        }
        // Ctrl+Y to redo position
        if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
            e.preventDefault();
            redoPosition();
        }
    });
    
    // Tab switching
    document.querySelectorAll('.sidebar-icon').forEach(icon => {
        icon.addEventListener('click', () => {
            const tab = icon.getAttribute('data-tab');
            
            // Update active icon
            document.querySelectorAll('.sidebar-icon').forEach(i => i.classList.remove('active'));
            icon.classList.add('active');
            
            // Update visible tab
            document.querySelectorAll('.tab-content').forEach(t => t.style.display = 'none');
            document.getElementById(`tab-${tab}`).style.display = 'flex';
        });
    });
});

function updateAccentColor(color) {
        // Update all sidebar icon SVG strokes
        document.querySelectorAll('.sidebar-icon svg').forEach(svg => {
            svg.setAttribute('stroke', color);
        });
        
        // Update checkbox accent color
        document.documentElement.style.setProperty('--accent-color', color);
    }
    
    // Apply initial accent color on load
    const initialAccentColor = document.getElementById('accent-color').value;
    updateAccentColor(initialAccentColor);
    // Menu bar handlers from Electron menu
    ipcRenderer.on('menu-save-project', () => {
        saveProject();
    });
    
    ipcRenderer.on('menu-open-project', () => {
        loadProject();
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 's') {
            e.preventDefault();
            saveProject();
        }
        if (e.ctrlKey && e.key === 'o') {
            e.preventDefault();
            loadProject();
        }
    });
    // API key input handlers - save to keychain on change
    document.getElementById('twitch-api-key').addEventListener('change', (e) => {
        const value = e.target.value.trim();
        if (value) {
            ipcRenderer.send('save-api-key', { keyType: 'twitch-api-key', value });
        }
    });
    
    document.getElementById('streamlabs-api-key').addEventListener('change', (e) => {
        const value = e.target.value.trim();
        if (value) {
            ipcRenderer.send('save-api-key', { keyType: 'streamlabs-api-key', value });
        }
    });
    
    // API key test handlers
    document.getElementById('test-twitch-btn').addEventListener('click', () => {
        const apiKey = document.getElementById('twitch-api-key').value;
        if (!apiKey) {            return;
        }
        // TODO: Implement Twitch connection test
    });
    
    document.getElementById('test-streamlabs-btn').addEventListener('click', () => {
        const apiKey = document.getElementById('streamlabs-api-key').value;
        if (!apiKey) {
            return;
        }
        // TODO: Implement Streamlabs connection test
    });    // Settings handlers
    document.getElementById('show-overlay-controls').addEventListener('change', (e) => {
        ipcRenderer.send('toggle-overlay-controls', e.target.checked);
    });    document.getElementById('enable-click-through').addEventListener('change', (e) => {
        const enabled = e.target.checked;
        ipcRenderer.send('toggle-click-through', enabled);
        
        // When click-through is enabled, unfocus all text objects in overlay
        if (enabled) {
            ipcRenderer.send('unfocus-all-text-objects');
        }
    });

    // Auto-save functionality
    document.getElementById('auto-save-enabled').addEventListener('change', (e) => {
        if (e.target.checked) {
            // Check if we have a project file to save to
            if (!currentProjectFile) {
                // No project file yet - just open save dialog
                e.target.checked = false;
                // Trigger save dialog
                setTimeout(() => saveProject(false), 100);
                return;
            }
            
            const intervalMinutes = parseInt(document.getElementById('auto-save-interval').value);
            autoSaveInterval = setInterval(() => {
                saveProject(true); // Auto-save without dialog
            }, intervalMinutes * 60 * 1000);
            
            showToast('Auto-save enabled', 'success');
        } else {
            if (autoSaveInterval) {
                clearInterval(autoSaveInterval);
                autoSaveInterval = null;
            }
        }
    });
    
    document.getElementById('auto-save-interval').addEventListener('change', (e) => {
        // If auto-save is enabled, restart the interval with new timing
        if (document.getElementById('auto-save-enabled').checked) {
            if (autoSaveInterval) {
                clearInterval(autoSaveInterval);
            }            const intervalMinutes = parseInt(e.target.value);
            autoSaveInterval = setInterval(() => {
                saveProject();
            }, intervalMinutes * 60 * 1000);
        }
    });
    
    document.getElementById('accent-color').addEventListener('change', (e) => {
        applyAccentColor(e.target.value);
        // Auto-save to user settings
        ipcRenderer.send('update-user-setting', { path: 'ui.accentColor', value: e.target.value });
    });    // Auto-save all settings controls with debouncing
    let saveDebounceTimer = null;
    
    function debouncedSave(path, value) {
        clearTimeout(saveDebounceTimer);
        saveDebounceTimer = setTimeout(() => {
            ipcRenderer.send('update-user-setting', { path, value });
        }, 500); // Wait 500ms after last change
    }    document.getElementById('show-overlay-controls').addEventListener('change', (e) => {
        debouncedSave('ui.showOverlayControls', e.target.checked);
    });
    
    document.getElementById('enable-click-through').addEventListener('change', (e) => {
        debouncedSave('ui.clickThrough', e.target.checked);
    });
    document.getElementById('default-font-size').addEventListener('change', (e) => {
        debouncedSave('defaults.fontSize', parseInt(e.target.value));
    });
    
    document.getElementById('default-starting-text').addEventListener('change', (e) => {
        debouncedSave('defaults.startingText', e.target.value);
    });
    
    document.getElementById('default-animation-preset').addEventListener('change', (e) => {
        debouncedSave('defaults.animationPreset', e.target.value);
    });
    
    document.getElementById('auto-save-enabled').addEventListener('change', (e) => {
        debouncedSave('autoSave.enabled', e.target.checked);
    });    document.getElementById('auto-save-interval').addEventListener('change', (e) => {
        debouncedSave('autoSave.interval', parseInt(e.target.value));
    });
    
    // Apply initial accent color
    applyAccentColor(document.getElementById('accent-color').value);
    // Handle arrow button clicks
    document.addEventListener('click', (e) => {
        if (e.target.closest('.number-arrow')) {
            const arrow = e.target.closest('.number-arrow');
            const inputId = arrow.getAttribute('data-input-id');
            const action = arrow.getAttribute('data-action');
            const input = document.getElementById(inputId);            if (input) {
                const step = parseFloat(input.step) || 1;
                const currentValue = parseFloat(input.value) || 0;
                const min = input.min !== '' ? parseFloat(input.min) : -Infinity;
                const max = input.max !== '' ? parseFloat(input.max) : Infinity;
                
                let newValue;
                if (action === 'increment') {
                    newValue = Math.min(max, currentValue + step);
                } else if (action === 'decrement') {
                    newValue = Math.max(min, currentValue - step);
                }
                
                // Round to 2 decimal places to avoid floating point issues
                input.value = Math.round(newValue * 100) / 100;
                
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    });    // Add drag-to-change for number inputs (Blender style)
    document.addEventListener('mousedown', (e) => {
        if (e.target.type === 'number') {
            const input = e.target;
            const startX = e.clientX;
            const startValue = parseFloat(input.value) || 0;
            const isPositionInput = input.id.includes('pos-x-') || input.id.includes('pos-y-');
            
            let isDragging = false;
            
            const onMouseMove = (moveEvent) => {
                const deltaX = Math.abs(moveEvent.clientX - startX);
                
                // Start dragging if moved more than 3 pixels
                if (!isDragging && deltaX > 3) {
                    isDragging = true;
                    input.style.cursor = 'ew-resize';
                    input.style.backgroundColor = '#161616';
                    input.blur();
                }                if (isDragging) {
                    const delta = moveEvent.clientX - startX;
                    const step = parseFloat(input.step) || 1;
                    const sensitivity = isPositionInput ? 5 : 1;
                    
                    // Invert Y direction so dragging right = UP (smaller Y value)
                    const isYInput = input.id.includes('pos-y-');
                    const multiplier = isYInput ? -1 : 1;
                    
                    const newValue = startValue + (delta * step * sensitivity * multiplier);
                    
                    const min = input.min !== '' ? parseFloat(input.min) : -Infinity;
                    const max = input.max !== '' ? parseFloat(input.max) : Infinity;
                    const clampedValue = Math.max(min, Math.min(max, newValue));
                    
                    input.value = Math.round(clampedValue * 100) / 100;
                    
                    if (isPositionInput) {
                        const match = input.id.match(/pos-[xy]-(\d+)/);
                        if (match) {
                            const id = parseInt(match[1]);
                            updatePosition(id, true);
                        }
                    } else {
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                }
            };
            
            const onMouseUp = () => {
                if (isDragging) {
                    input.style.cursor = '';
                    input.style.backgroundColor = '';
                    
                    if (isPositionInput) {
                        const match = input.id.match(/pos-[xy]-(\d+)/);
                        if (match) {
                            const id = parseInt(match[1]);
                            updatePosition(id, false);
                        }
                    }
                } else {
                    // Just clicked without dragging - select the text
                    input.select();
                }
                
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };
            
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        }
    });

// Function to position suffix labels dynamically after number values
function positionSuffixes() {
    document.querySelectorAll('.number-input-wrapper').forEach(wrapper => {
        const input = wrapper.querySelector('input[type="number"]');
        const suffix = wrapper.querySelector('.number-suffix');
        
        if (!input || !suffix) return;
        
        const hasSuffix = suffix.textContent.trim();
        
        // If no suffix, just center the number text normally
        if (!hasSuffix) {
            input.style.textIndent = '0';
            input.style.textAlign = 'center';
            return;
        }
        
        // Has suffix - calculate positioning for both number and suffix
        input.style.textAlign = 'left'; // Reset to left for suffix positioning
        
        // Create a temporary span to measure text width
        const measureSpan = document.createElement('span');
        measureSpan.style.cssText = `
            position: absolute;
            visibility: hidden;
            white-space: nowrap;
            font-family: ${getComputedStyle(input).fontFamily};
            font-size: ${getComputedStyle(input).fontSize};
            font-weight: ${getComputedStyle(input).fontWeight};
        `;
        measureSpan.textContent = input.value || '0';
        document.body.appendChild(measureSpan);
        
        const textWidth = measureSpan.offsetWidth;
        
        // Also measure suffix width
        measureSpan.textContent = suffix.textContent;
        const suffixWidth = measureSpan.offsetWidth;
        document.body.removeChild(measureSpan);
        
        // Calculate total width of number + suffix
        const gap = 3; // 3px gap between number and suffix
        const totalWidth = textWidth + gap + suffixWidth;
        
        // Center the entire combo in the input
        const inputWidth = input.offsetWidth;
        const startOffset = (inputWidth - totalWidth) / 2;
        
        // Set text-indent to center the number text
        // Account for left padding (24px) and add the calculated offset
        input.style.textIndent = `${startOffset - 24}px`;
        
        // Position suffix after the number
        suffix.style.left = `${startOffset + textWidth + gap}px`;
    });
}

// Update suffix positions on input change
document.addEventListener('input', (e) => {
    if (e.target.type === 'number') {
        positionSuffixes();
    }
});

// Initial positioning
requestAnimationFrame(() => {
    requestAnimationFrame(positionSuffixes);
});

// Reposition on any value change via arrows or drag
const originalDispatchEvent = HTMLInputElement.prototype.dispatchEvent;
HTMLInputElement.prototype.dispatchEvent = function(event) {
    const result = originalDispatchEvent.call(this, event);
    if (event.type === 'change' && this.type === 'number') {
        setTimeout(positionSuffixes, 0);
    }    return result;
};

// ===== SCRIPT EDITOR IPC HANDLERS =====

// Handle script updates from editor window
ipcRenderer.on('script-updated-from-editor', (event, { id, name, code }) => {
    const script = scripts.find(s => s.id === id);
    if (script) {
        script.name = name;
        script.code = code;
        
        // Update Monaco editor in control window if it exists
        if (monacoEditors[id]) {
            const currentValue = monacoEditors[id].getValue();
            if (currentValue !== code) {
                monacoEditors[id].setValue(code);
            }
        }        // Update script name input
        const nameInput = document.querySelector(`#script-${id} .text-object-name`);
        if (nameInput) {
            nameInput.value = name;
        }
        
        // Trigger project auto-save (not user settings)
        if (autoSaveEnabled && currentProjectPath) {
            triggerAutoSave();
        }
    }
});

// Handle run script command from editor window
ipcRenderer.on('run-script-from-editor', (event, scriptId) => {
    runScript(scriptId);
});

// Handle stop script command from editor window
ipcRenderer.on('stop-script-from-editor', (event, scriptId) => {
    stopScript(scriptId);
});

// Handle close confirmation request
ipcRenderer.on('request-close-confirmation', async () => {
    // Check if there are unsaved changes or running scripts
    const hasUnsavedChanges = currentProjectFile === null && (textObjects.length > 0 || scripts.length > 0);
    const hasRunningScripts = runningScripts.size > 0;
    
    if (hasUnsavedChanges || hasRunningScripts) {
        let message = '';
        if (hasUnsavedChanges && hasRunningScripts) {
            message = 'You have unsaved changes and running scripts. Are you sure you want to quit?';
        } else if (hasUnsavedChanges) {
            message = 'You have unsaved changes. Are you sure you want to quit without saving?';
        } else if (hasRunningScripts) {
            message = 'You have running scripts. Are you sure you want to quit?';
        }
        
        const choice = confirm(message);
        
        if (choice) {
            ipcRenderer.send('confirm-close');
        } else {
            ipcRenderer.send('cancel-close');
        }
    } else {
        // No unsaved changes, close immediately
        ipcRenderer.send('confirm-close');
    }
});