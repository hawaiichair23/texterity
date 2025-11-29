const { app, BrowserWindow, ipcMain, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');

let controlWindow;
let overlayWindow;
let fileWatcher = null;

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
    });
    
    controlWindow.loadFile('control.html');
    controlWindow.setMenu(null);  // Remove menu bar
    // controlWindow.webContents.openDevTools(); // Disabled for production
    
    controlWindow.on('closed', () => {
        controlWindow = null;
        if (overlayWindow) overlayWindow.close();
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
    // overlayWindow.webContents.openDevTools(); // Disabled for production
    
    overlayWindow.on('closed', () => {
        overlayWindow = null;
    });
}

app.whenReady().then(() => {
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
    console.log('Minimize overlay triggered');
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.minimize();
    }
});

ipcMain.on('maximize-overlay', () => {
    console.log('Maximize overlay triggered');
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        if (overlayWindow.isMaximized()) {
            overlayWindow.unmaximize();
        } else {
            overlayWindow.maximize();
        }
    }
});

ipcMain.on('close-overlay', () => {
    console.log('Close overlay triggered');
    if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.close();
    }
});

// File dialog for selecting text file to watch
ipcMain.on('open-file-dialog', (event) => {
    dialog.showOpenDialog(controlWindow, {
        properties: ['openFile'],
        filters: [
            { name: 'Text Files', extensions: ['txt'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    }).then(result => {
        if (!result.canceled && result.filePaths.length > 0) {
            const filePath = result.filePaths[0];
            event.sender.send('file-selected', filePath);
        }
    });
});

// Start watching a file
ipcMain.on('start-file-watch', (event, filePath) => {
    console.log('Starting file watch:', filePath);
    
    // Stop existing watcher if any
    if (fileWatcher) {
        fileWatcher.close();
    }
    
    // Read initial content
    fs.readFile(filePath, 'utf-8', (err, data) => {
        if (!err) {
            event.sender.send('file-content-update', data);
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
        console.log('File changed!');
        fs.readFile(filePath, 'utf-8', (err, data) => {
            if (!err && controlWindow && !controlWindow.isDestroyed()) {
                controlWindow.webContents.send('file-content-update', data);
            }
        });
    });
});

// Stop watching file
ipcMain.on('stop-file-watch', () => {
    console.log('Stopping file watch');
    if (fileWatcher) {
        fileWatcher.close();
        fileWatcher = null;
    }
});
