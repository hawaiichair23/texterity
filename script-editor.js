const { ipcRenderer } = require('electron');
const path = require('path');
const React = require('react');
const ReactDOM = require('react-dom/client');
const { Allotment } = require('allotment');

let monaco = null;
let editor = null;
let scriptId = null;
let scriptData = null;
let isRunning = false;

// Load Monaco Editor
function loadMonaco() {
    const loaderScript = document.createElement('script');
    loaderScript.src = path.join(__dirname, 'node_modules/monaco-editor/min/vs/loader.js');
    
    loaderScript.onload = () => {
        window.require.config({
            paths: {
                'vs': path.join(__dirname, 'node_modules/monaco-editor/min/vs')
            }
        });
        
        window.require(['vs/editor/editor.main'], function() {
            monaco = window.monaco;
            console.log('[Monaco] Editor loaded in script editor window');
            initSplitView();
        });
    };
    
    loaderScript.onerror = (error) => {
        console.error('[Monaco] Failed to load:', error);
    };
    
    document.head.appendChild(loaderScript);
}

// Initialize split view with Allotment
function initSplitView() {
    const container = document.getElementById('content-area');
    
    // Create React root
    const root = ReactDOM.createRoot(container);
    
    // Render Allotment component
    root.render(
        React.createElement(Allotment, {
            vertical: true, // Split horizontally (top/bottom)
            defaultSizes: [70, 30] // 70% editor, 30% console
        }, [
            // Editor pane
            React.createElement(Allotment.Pane, {
                key: 'editor',
                minSize: 200,
                preferredSize: '70%'
            }, React.createElement('div', {
                id: 'monaco-editor-container',
                ref: (el) => {
                    if (el && !editor) {
                        setTimeout(() => initMonacoEditor(el), 0);
                    }
                }
            })),
            
            // Console pane
            React.createElement(Allotment.Pane, {
                key: 'console',
                minSize: 100,
                preferredSize: '30%',
                snap: true // Allow snapping to closed
            }, React.createElement('div', {
                className: 'console-panel'
            }, [
                React.createElement('div', {
                    key: 'header',
                    className: 'console-header'
                }, [
                    React.createElement('span', { key: 'title' }, 'Console Output'),
                    React.createElement('button', {
                        key: 'clear',
                        id: 'clear-console-btn',
                        className: 'secondary',
                        onClick: clearConsole
                    }, 'Clear')
                ]),
                React.createElement('div', {
                    key: 'content',
                    className: 'console-content',
                    id: 'console-content'
                }, React.createElement('div', {
                    className: 'console-line log'
                }, 'Console ready...'))
            ]))
        ])
    );
}

// Update button states based on running status
function updateButtonStates() {
    const runBtn = document.getElementById('run-btn');
    const stopBtn = document.getElementById('stop-btn');
    
    if (isRunning) {
        runBtn.disabled = true;
        runBtn.style.opacity = '0.5';
        runBtn.style.cursor = 'not-allowed';
        stopBtn.disabled = false;
        stopBtn.style.opacity = '1';
        stopBtn.style.cursor = 'pointer';
    } else {
        runBtn.disabled = false;
        runBtn.style.opacity = '1';
        runBtn.style.cursor = 'pointer';
        stopBtn.disabled = true;
        stopBtn.style.opacity = '0.5';
        stopBtn.style.cursor = 'not-allowed';
    }
}

// Initialize Monaco Editor
function initMonacoEditor(container) {
    if (editor || !container) return;    editor = monaco.editor.create(container, {
        value: scriptData?.code || '',
        language: 'javascript',
        theme: 'vs-dark',
        automaticLayout: true,
        fontSize: 14,
        fontFamily: 'Consolas, Monaco, Courier New, monospace',
        minimap: { enabled: true },
        lineNumbers: 'on',
        roundedSelection: false,
        scrollBeyondLastLine: false,
        readOnly: false,
        tabSize: 2,
        insertSpaces: true,
        wordWrap: 'off',
        folding: true,
        lineDecorationsWidth: 10,
        lineNumbersMinChars: 4,
        renderLineHighlight: 'all',        scrollbar: {
            vertical: 'auto',
            horizontal: 'auto',
            useShadows: true,
            verticalHasArrows: false,
            horizontalHasArrows: false,
            verticalScrollbarSize: 14,
            horizontalScrollbarSize: 14,
            arrowSize: 30
        },
        suggestOnTriggerCharacters: true,
        quickSuggestions: true,
        parameterHints: {
            enabled: true
        }
    });    // FIX: Manual clipboard handling for Electron
    // Override default clipboard actions with navigator.clipboard API
    
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
    
    // Redo (Ctrl+Y or Ctrl+Shift+Z)
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
    
    // Listen for error/warning changes
    monaco.editor.onDidChangeMarkers(([uri]) => {
        if (!editor || !editor.getModel()) return;
        
        // Only process markers for our editor's model
        if (editor.getModel().uri.toString() !== uri.toString()) return;
        
        const markers = monaco.editor.getModelMarkers({ resource: uri });
        
        // Filter for errors only
        const errors = markers.filter(m => m.severity === monaco.MarkerSeverity.Error);
        
        if (errors.length > 0) {
            // Log first error to console
            const firstError = errors[0];
            logToConsole(
                `Error on line ${firstError.startLineNumber}: ${firstError.message}`,
                'error'
            );
        }
    });
    
    // Auto-save on changes
    let saveTimeout;
    editor.onDidChangeModelContent(() => {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            saveScript();
        }, 500);
    });
    
    // Update editor info
    editor.onDidChangeCursorPosition((e) => {
        const position = e.position;
        document.getElementById('editor-info').textContent = 
            `Ln ${position.lineNumber}, Col ${position.column}`;
    });
    
    console.log('[Monaco] Editor initialized');
}

// Load script data
ipcRenderer.on('load-script', (event, data) => {
    scriptId = data.id;
    scriptData = data;
    
    // Update UI
    document.getElementById('script-name').value = data.name;
    document.title = `Script Editor - ${data.name}`;
    
    // Update editor if already loaded
    if (editor) {
        editor.setValue(data.code || '');
    }
    
    // Initialize button states
    updateButtonStates();
});

// Save script back to control window
function saveScript() {
    if (!editor || !scriptId) return;
    
    const code = editor.getValue();
    const name = document.getElementById('script-name').value;
    
    ipcRenderer.send('script-editor-update', {
        id: scriptId,
        name: name,
        code: code
    });
}

// Script name changes
document.getElementById('script-name').addEventListener('input', () => {
    const name = document.getElementById('script-name').value;
    document.title = `Script Editor - ${name}`;
    saveScript();
});

// Run script
document.getElementById('run-btn').addEventListener('click', () => {
    if (isRunning) return; // Prevent multiple runs
    
    saveScript();
    ipcRenderer.send('script-editor-run', scriptId);
    isRunning = true;
    updateButtonStates();
    updateStatus('running', 'Script Running...');
    logToConsole('▶ Script started', 'log');
});

// Stop script
document.getElementById('stop-btn').addEventListener('click', () => {
    if (!isRunning) return; // Prevent multiple stops
    
    ipcRenderer.send('script-editor-stop', scriptId);
    isRunning = false;
    updateButtonStates();
    updateStatus('stopped', 'Script Stopped');
    logToConsole('⏹ Script stopped', 'log');
});

// Clear console
function clearConsole() {
    const consoleContent = document.getElementById('console-content');
    if (consoleContent) {
        consoleContent.innerHTML = '';
        logToConsole('Console cleared', 'log');
    }
}

// Update status bar
function updateStatus(state, text) {
    const statusBar = document.getElementById('status-bar');
    statusBar.className = `status-bar ${state}`;
    document.getElementById('status-text').textContent = text;
}

// Log to console
function logToConsole(message, type = 'log') {
    const consoleContent = document.getElementById('console-content');
    if (!consoleContent) return;
    
    const line = document.createElement('div');
    line.className = `console-line ${type}`;
    line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    consoleContent.appendChild(line);
    consoleContent.scrollTop = consoleContent.scrollHeight;
}

// Receive console logs from script execution
ipcRenderer.on('script-console-log', (event, { message, type }) => {
    logToConsole(message, type);
});

// Receive script errors
ipcRenderer.on('script-error', (event, error) => {
    logToConsole(`Error: ${error}`, 'error');
    updateStatus('stopped', 'Script Error');
    isRunning = false;
    updateButtonStates();
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    // Don't intercept shortcuts when Monaco editor has focus
    const monacoHasFocus = document.activeElement?.classList.contains('monaco-editor') ||
                          document.querySelector('.monaco-editor')?.contains(document.activeElement);
    
    // Ctrl+S or Cmd+S - Save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveScript();
        logToConsole('Script saved', 'log');
    }
    
    // F5 - Run (only if not typing in editor)
    if (e.key === 'F5' && !monacoHasFocus) {
        e.preventDefault();
        if (!isRunning) {
            document.getElementById('run-btn').click();
        }
    }
    
    // Shift+F5 - Stop (only if not typing in editor)
    if (e.shiftKey && e.key === 'F5' && !monacoHasFocus) {
        e.preventDefault();
        if (isRunning) {
            document.getElementById('stop-btn').click();
        }
    }
});

// Load Monaco on startup
loadMonaco();

// Save before closing
window.addEventListener('beforeunload', () => {
    saveScript();
});
