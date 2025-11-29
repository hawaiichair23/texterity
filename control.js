const { ipcRenderer } = require('electron');

const settings = {
    charDelayStep: 0.023,
    fontSize: 48,
    fontFamily: 'Instrument Serif',
    color: 0xFFFFFF,
    hopMin: 1,
    hopMax: 3,
    animationDuration: 0.4,
    autoClearDuration: 0,
    loopAnimation: true,
    backgroundColor: 0x000000,
    backgroundTransparent: false
};

let currentInputMode = 'manual';
let watchedFilePath = null;

// Input mode switcher
const inputModeSelect = document.getElementById('input-mode');
const manualInputGroup = document.getElementById('manual-input-group');
const fileInputGroup = document.getElementById('file-input-group');

inputModeSelect.addEventListener('change', (e) => {
    currentInputMode = e.target.value;
    
    if (currentInputMode === 'manual') {
        manualInputGroup.style.display = 'block';
        fileInputGroup.style.display = 'none';
        // Stop watching file
        if (watchedFilePath) {
            ipcRenderer.send('stop-file-watch');
            watchedFilePath = null;
        }
    } else {
        manualInputGroup.style.display = 'none';
        fileInputGroup.style.display = 'block';
    }
});

// File selection
const selectFileBtn = document.getElementById('select-file-btn');
const filePathDisplay = document.getElementById('file-path-display');

selectFileBtn.addEventListener('click', () => {
    ipcRenderer.send('open-file-dialog');
});

// Receive selected file path
ipcRenderer.on('file-selected', (event, filePath) => {
    watchedFilePath = filePath;
    filePathDisplay.value = filePath;
    
    // Start watching the file
    ipcRenderer.send('start-file-watch', filePath);
});

// Receive file content updates
ipcRenderer.on('file-content-update', (event, content) => {
    console.log('File updated:', content);
    ipcRenderer.send('render-text', content);
});

// Font size slider
const fontSizeSlider = document.getElementById('font-size');
const fontSizeValue = document.getElementById('font-size-value');

fontSizeSlider.addEventListener('input', (e) => {
    settings.fontSize = parseInt(e.target.value);
    fontSizeValue.textContent = settings.fontSize + 'px';
    ipcRenderer.send('update-settings', settings);
});

// Text color picker
const textColorPicker = document.getElementById('text-color');
textColorPicker.addEventListener('input', (e) => {
    settings.color = parseInt(e.target.value.replace('#', '0x'));
    ipcRenderer.send('update-settings', settings);
});

// Background color picker
const bgColorPicker = document.getElementById('bg-color');
const bgTransparentCheckbox = document.getElementById('bg-transparent');

bgColorPicker.addEventListener('input', (e) => {
    settings.backgroundColor = parseInt(e.target.value.replace('#', '0x'));
    if (!settings.backgroundTransparent) {
        ipcRenderer.send('update-settings', settings);
    }
});

bgTransparentCheckbox.addEventListener('change', (e) => {
    settings.backgroundTransparent = e.target.checked;
    ipcRenderer.send('update-settings', settings);
});

// Loop animation toggle
const loopAnimationCheckbox = document.getElementById('loop-animation');
loopAnimationCheckbox.addEventListener('change', (e) => {
    settings.loopAnimation = e.target.checked;
    ipcRenderer.send('update-settings', settings);
});

// Font family selector
const fontFamilySelect = document.getElementById('font-family');
fontFamilySelect.addEventListener('change', (e) => {
    settings.fontFamily = e.target.value;
    ipcRenderer.send('update-settings', settings);
});

// Manual text input
const textInput = document.getElementById('text-input');
const updateTextBtn = document.getElementById('update-text-btn');

updateTextBtn.addEventListener('click', () => {
    const text = textInput.value;
    if (text.trim()) {
        ipcRenderer.send('render-text', text);
    }
});

// Custom font import
const importFontBtn = document.getElementById('import-font-btn');
const fontFileInput = document.getElementById('font-file-input');

importFontBtn.addEventListener('click', () => {
    fontFileInput.click();
});

fontFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const fontName = file.name.replace(/\.(ttf|otf|woff|woff2)$/, '');
    const fontURL = URL.createObjectURL(file);
    
    const newFont = new FontFace(fontName, `url(${fontURL})`);
    
    try {
        await newFont.load();
        document.fonts.add(newFont);
        
        const option = document.createElement('option');
        option.value = fontName;
        option.textContent = fontName + ' (Custom)';
        fontFamilySelect.appendChild(option);
        fontFamilySelect.value = fontName;
        
        settings.fontFamily = fontName;
        ipcRenderer.send('update-settings', settings);
        
        console.log('Font loaded:', fontName);
    } catch (error) {
        console.error('Failed to load font:', error);
        alert('Failed to load font. Make sure it\'s a valid font file.');
    }
});

// Auto-render default text on startup
window.addEventListener('DOMContentLoaded', () => {
    const defaultText = textInput.value;
    if (defaultText.trim()) {
        setTimeout(() => {
            ipcRenderer.send('render-text', defaultText);
        }, 500); // Small delay to ensure overlay is ready
    }
});
