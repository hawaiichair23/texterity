const { app, BrowserWindow, ipcMain, dialog, screen, Menu, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');
const keychain = require('./keychain-manager');
const settings = require('./settings-manager');
const opentype = require('opentype.js');

let controlWindow;
let overlayWindow;
let scriptEditorWindows = {}; // Track script editor windows by script ID
let fileWatcher = null;
let userSettings = null; // Global settings object

function createControlWindow() {
    const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
    
    // Scale down on smaller monitors (base size for 1920px width)
    const scale = Math.min(1, screenWidth / 1920);
    const controlWidth = Math.floor(400 * scale);
    const controlHeight = Math.floor(726 * scale);
    const overlayWidth = Math.floor(1280 * scale);
    const controlX = 100 + overlayWidth - 8;  // 8px closer
    
    controlWindow = new BrowserWindow({
        width: controlWidth,
        height: controlHeight,
        x: controlX,
        y: 100,
        transparent: false,
        frame: true,
        alwaysOnTop: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });    controlWindow.loadFile('control.html');
    
    // Create menu bar
    const menuTemplate = [
        {
            label: 'File',
            submenu: [
                {
                    label: 'Open Project',
                    accelerator: 'CmdOrCtrl+O',
                    click: () => {
                        controlWindow.webContents.send('menu-open-project');
                    }
                },
                {
                    label: 'Save Project',
                    accelerator: 'CmdOrCtrl+S',
                    click: () => {
                        controlWindow.webContents.send('menu-save-project');
                    }
                },
                { type: 'separator' },
                {
                    label: 'Exit',
                    click: () => {
                        app.quit();
                    }
                }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                {
                    label: 'Undo',
                    accelerator: 'CmdOrCtrl+Z',
                    enabled: false
                },
                {
                    label: 'Redo',
                    accelerator: 'CmdOrCtrl+Y',
                    enabled: false
                }
            ]
        }
    ];
    
    const menu = Menu.buildFromTemplate(menuTemplate);
    Menu.setApplicationMenu(menu);  // Use application menu instead of window menu
    // Send settings AFTER DOM is fully loaded
    controlWindow.webContents.on('did-finish-load', () => {
        controlWindow.webContents.send('user-settings-loaded', userSettings);
    });    // Open dev tools with Ctrl+Shift+I
    controlWindow.webContents.on('before-input-event', (event, input) => {
        if (input.control && input.shift && input.key.toLowerCase() === 'i') {
            controlWindow.webContents.toggleDevTools();
        }
    });
    
    // Prevent closing without save confirmation
    controlWindow.on('close', (e) => {
        e.preventDefault();
        controlWindow.webContents.send('request-close-confirmation');
    });
    
    controlWindow.on('closed', () => {
        controlWindow = null;
        if (overlayWindow) overlayWindow.close();
    });
}

function createScriptEditorWindow(scriptData) {
    // Check if window already exists for this script
    if (scriptEditorWindows[scriptData.id]) {
        scriptEditorWindows[scriptData.id].focus();
        return;
    }
    
    const editorWindow = new BrowserWindow({
        width: 1000,
        height: 700,
        minWidth: 600,
        minHeight: 400,
        title: `Script Editor - ${scriptData.name}`,
        backgroundColor: '#1e1e1e',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });    editorWindow.loadFile('script-editor.html');
    
    // Create minimal menu with Edit for copy/paste support
    const editorMenuTemplate = [
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'selectAll' }
            ]
        }
    ];
    
    const editorMenu = Menu.buildFromTemplate(editorMenuTemplate);
    editorWindow.setMenu(editorMenu);
    
    // Send script data after window loads
    editorWindow.webContents.on('did-finish-load', () => {
        editorWindow.webContents.send('load-script', scriptData);
    });
    
    // Track window
    scriptEditorWindows[scriptData.id] = editorWindow;
    
    // Clean up on close
    editorWindow.on('closed', () => {
        delete scriptEditorWindows[scriptData.id];
    });
    
    // Dev tools shortcut
    editorWindow.webContents.on('before-input-event', (event, input) => {
        if (input.control && input.shift && input.key.toLowerCase() === 'i') {
            editorWindow.webContents.toggleDevTools();
        }
    });
}

function createOverlayWindow() {
    const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
    
    // Scale down on smaller monitors
    const scale = Math.min(1, screenWidth / 1920);
    const overlayWidth = Math.floor(1280 * scale);
    const overlayHeight = Math.floor(720 * scale);
    const overlayX = 100;
    
    overlayWindow = new BrowserWindow({
        width: overlayWidth,
        height: overlayHeight,
        x: overlayX,
        y: 100,
        transparent: true,
        frame: false,
        alwaysOnTop: false,
        skipTaskbar: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });    overlayWindow.loadFile('overlay.html');
    overlayWindow.setMenu(null);  // Remove "File Edit View" menu but keep title bar buttons
    
    overlayWindow.on('closed', () => {
        overlayWindow = null;
    });
}

app.whenReady().then(() => {
    // Load user settings
    userSettings = settings.loadSettings();
    
    // Force dark theme for native menus
    nativeTheme.themeSource = 'dark';
    
    createControlWindow();
    createOverlayWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// Forward settings from control to overlay
ipcMain.on('update-settings', (event, settings) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('update-settings', settings);
    }
});

// Forward text updates from control to overlay
ipcMain.on('render-text', (event, text) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('render-text', text);
    }
});

// Window controls for overlay
ipcMain.on('minimize-overlay', () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.minimize();
    }
});

ipcMain.on('maximize-overlay', () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        if (overlayWindow.isMaximized()) {
            overlayWindow.unmaximize();
        } else {
            overlayWindow.maximize();
        }
    }
});

ipcMain.on('close-overlay', () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.close();
    }
});

// File dialog for selecting text file to watch
ipcMain.on('open-file-dialog', (event, id) => {
    dialog.showOpenDialog(controlWindow, {
        properties: ['openFile'],
        filters: [
            { name: 'Text Files', extensions: ['txt'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    }).then(result => {
        if (!result.canceled && result.filePaths.length > 0) {
            const filePath = result.filePaths[0];
            event.sender.send('file-selected', { id, filePath });
        }
    });
});

// Font dialog for selecting custom font file
ipcMain.on('open-font-dialog', (event, textObjectId) => {
    dialog.showOpenDialog(controlWindow, {
        properties: ['openFile'],
        filters: [
            { name: 'Font Files', extensions: ['ttf', 'otf', 'woff', 'woff2'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    }).then(result => {
        if (!result.canceled && result.filePaths.length > 0) {
            const fontPath = result.filePaths[0];
            
            // Parse the font file to get the REAL font family name
            try {
                const font = opentype.loadSync(fontPath);
                const fontFamily = font.names.fontFamily.en || font.names.fullName.en || path.basename(fontPath, path.extname(fontPath));
                
                event.sender.send('font-selected', { textObjectId, fontPath, fontName: fontFamily });
            } catch (error) {
                console.error('Error parsing font:', error);
                // Fallback to filename if parsing fails
                const fontName = path.basename(fontPath, path.extname(fontPath));
                event.sender.send('font-selected', { textObjectId, fontPath, fontName });
            }
        }
    });
});

// Load custom font in overlay
ipcMain.on('load-custom-font', (event, { fontFamily, fontPath }) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('load-custom-font', { fontFamily, fontPath });
    }
});

// Load Google Font in overlay
ipcMain.on('load-google-font', (event, { fontFamily }) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('load-google-font', { fontFamily });
    }
});

// Start watching a file
ipcMain.on('start-file-watch', (event, { id, filePath }) => {
    
    // Stop existing watcher if any
    if (fileWatcher) {
        fileWatcher.close();
    }
    
    // Read initial content
    fs.readFile(filePath, 'utf-8', (err, data) => {
        if (!err) {
            event.sender.send('file-content-update', { id, content: data });
        } else {
            console.error('Error reading file:', err);
        }
    });
    
    // Start watching for changes
    fileWatcher = chokidar.watch(filePath, {
        persistent: true,
        ignoreInitial: true
    });
    
    fileWatcher.on('change', () => {
        fs.readFile(filePath, 'utf-8', (err, data) => {
            if (!err && controlWindow && !controlWindow.isDestroyed()) {
                controlWindow.webContents.send('file-content-update', { id, content: data });
            }
        });
    });
});

// Stop watching file
ipcMain.on('stop-file-watch', () => {
    if (fileWatcher) {
        fileWatcher.close();
        fileWatcher = null;
    }
});

// Handle close confirmation
ipcMain.on('confirm-close', () => {
    // Actually close the window
    if (controlWindow) {
        controlWindow.removeAllListeners('close');
        controlWindow.close();
    }
});

ipcMain.on('cancel-close', () => {
    // Do nothing, window stays open
});

// NEW: Multiple text object handlers
ipcMain.on('create-text-object', (event, textObject) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('create-text-object', textObject);
    }
});

ipcMain.on('delete-text-object', (event, id) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('delete-text-object', id);
    }
});

ipcMain.on('update-text-object', (event, data) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('update-text-object', data);
    }
});

ipcMain.on('update-text-object-position', (event, data) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('update-text-object-position', data);
    }
});

ipcMain.on('update-character-offsets', (event, data) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('update-character-offsets', data);
    }
});

ipcMain.on('overlay-visibility-changed', (event, isHidden) => {
    if (controlWindow && !controlWindow.isDestroyed()) {
        controlWindow.webContents.send('overlay-visibility-changed', isHidden);
    }
});

ipcMain.on('update-text-object-settings', (event, data) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('update-text-object-settings', data);
    }
});

ipcMain.on('update-background', (event, bgSettings) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('update-background', bgSettings);
    }
});

// Save project
ipcMain.on('save-project', (event, projectData) => {
    dialog.showSaveDialog(controlWindow, {
        title: 'Save Texterity Project',
        defaultPath: 'texterity-project.json',
        filters: [
            { name: 'Texterity Project', extensions: ['json'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    }).then(result => {
        if (!result.canceled && result.filePath) {
            fs.writeFile(result.filePath, JSON.stringify(projectData, null, 2), (err) => {
                if (err) {
                    event.sender.send('project-save-error', err.message);
                } else {
                    event.sender.send('project-saved', { filePath: result.filePath, autoSave: false });
                }
            });
        }
    });
});

// Save project to specific path (for auto-save)
ipcMain.on('save-project-to-path', (event, { projectData, filePath }) => {
    fs.writeFile(filePath, JSON.stringify(projectData, null, 2), (err) => {
        if (err) {
            event.sender.send('project-save-error', err.message);
        } else {
            event.sender.send('project-saved', { filePath, autoSave: true });
        }
    });
});

// Load project
ipcMain.on('load-project', (event) => {
    dialog.showOpenDialog(controlWindow, {
        title: 'Load Texterity Project',
        filters: [
            { name: 'Texterity Project', extensions: ['json'] },
            { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['openFile']
    }).then(result => {
        if (!result.canceled && result.filePaths.length > 0) {
            const filePath = result.filePaths[0];
            fs.readFile(filePath, 'utf-8', (err, data) => {
                if (err) {
                    event.sender.send('project-save-error', err.message);
                } else {
                    try {
                        const projectData = JSON.parse(data);
                        event.sender.send('project-loaded', { projectData, filePath });
                    } catch (parseErr) {
                        event.sender.send('project-save-error', 'Invalid project file');
                    }
                }
            });
        }
    });
});

ipcMain.on('position-updated', (event, data) => {
    if (controlWindow && !controlWindow.isDestroyed()) {
        controlWindow.webContents.send('position-updated', data);
    }
});

ipcMain.on('position-drag-ended', (event, data) => {
    if (controlWindow && !controlWindow.isDestroyed()) {
        controlWindow.webContents.send('position-drag-ended', data);
    }
});

// Undo/Redo requests from overlay window
ipcMain.on('request-undo', () => {
    if (controlWindow && !controlWindow.isDestroyed()) {
        controlWindow.webContents.send('trigger-undo');
    }
});

ipcMain.on('request-redo', () => {
    if (controlWindow && !controlWindow.isDestroyed()) {
        controlWindow.webContents.send('trigger-redo');
    }
});

// Save user settings
ipcMain.on('save-user-settings', (event, newSettings) => {
    userSettings = newSettings;
    settings.saveSettings(userSettings);
});


ipcMain.on('update-animation-settings', (event, settings) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('update-animation-settings', settings);
    }
});

// Toggle overlay window controls visibility
ipcMain.on('toggle-overlay-controls', (event, show) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('toggle-overlay-controls', show);
    }
});

// Keychain API key management
ipcMain.on('save-api-key', async (event, { keyType, value }) => {
    const success = await keychain.saveKey(keyType, value);
    event.sender.send('api-key-saved', { keyType, success });
});

ipcMain.on('get-api-key', async (event, keyType) => {
    const value = await keychain.getKey(keyType);
    event.sender.send('api-key-retrieved', { keyType, value });
});

ipcMain.on('get-all-api-keys', async (event) => {
    const keys = await keychain.getAllKeys();
    event.sender.send('all-api-keys-retrieved', keys);
});

ipcMain.on('delete-api-key', async (event, keyType) => {
    const success = await keychain.deleteKey(keyType);
    event.sender.send('api-key-deleted', { keyType, success });
});

// User settings management
ipcMain.on('get-user-settings', (event) => {
    // console.log('Sending settings:', JSON.stringify(userSettings, null, 2));
    event.sender.send('user-settings-loaded', userSettings);
});

// Update a specific user setting and auto-save
ipcMain.on('update-user-setting', (event, data) => {
    // Safety check for data structure
    if (!data || !data.path) {
        console.error('update-user-setting: invalid data', data);
        return;
    }
    
    const { path, value } = data;
    userSettings = settings.updateSetting(userSettings, path, value);
    settings.saveSettings(userSettings);
});

// Reset text position to center of overlay window
ipcMain.on('reset-text-position', (event, data) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('reset-text-position', data);
    }
});

// Forward text object focus from overlay to control
ipcMain.on('text-object-focused', (event, id) => {
    if (controlWindow && !controlWindow.isDestroyed()) {
        controlWindow.webContents.send('text-object-focused', id);
    }
});

// Script Editor IPC Handlers

// Open script editor window
ipcMain.on('open-script-editor', (event, scriptData) => {
    createScriptEditorWindow(scriptData);
});

// Script editor updates script
ipcMain.on('script-editor-update', (event, { id, name, code }) => {
    if (controlWindow && !controlWindow.isDestroyed()) {
        controlWindow.webContents.send('script-updated-from-editor', { id, name, code });
    }
});

// Script editor runs script
ipcMain.on('script-editor-run', (event, scriptId) => {
    if (controlWindow && !controlWindow.isDestroyed()) {
        controlWindow.webContents.send('run-script-from-editor', scriptId);
    }
});

// Script editor stops script
ipcMain.on('script-editor-stop', (event, scriptId) => {
    if (controlWindow && !controlWindow.isDestroyed()) {
        controlWindow.webContents.send('stop-script-from-editor', scriptId);
    }
});

// Forward console logs to script editor
ipcMain.on('script-console-to-editor', (event, { scriptId, message, type }) => {
    if (scriptEditorWindows[scriptId] && !scriptEditorWindows[scriptId].isDestroyed()) {
        scriptEditorWindows[scriptId].webContents.send('script-console-log', { message, type });
    }
});

// Forward script errors to script editor
ipcMain.on('script-error-to-editor', (event, { scriptId, error }) => {
    if (scriptEditorWindows[scriptId] && !scriptEditorWindows[scriptId].isDestroyed()) {
        scriptEditorWindows[scriptId].webContents.send('script-error', error);
    }
});

