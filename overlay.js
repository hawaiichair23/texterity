const PIXI = require('pixi.js');
const { ipcRenderer } = require('electron');

let app;
let textContainer;
let backgroundRect;
let lastText = ''; // Store last rendered text
let loopTimeout = null; // Track the loop timeout
let hoverBox = null; // White hover box
let dragData = null; // Store drag event data
let customPosition = null; // Store custom dragged position
let isDragging = false; // Track drag state
let dragOffset = { x: 0, y: 0 }; // Store drag offset

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

async function initPixi() {
    app = new PIXI.Application();

    await app.init({
        width: window.innerWidth,
        height: window.innerHeight,
        backgroundAlpha: 0,  // TRANSPARENT!
        antialias: true,
        autoStart: true,
        resizeTo: window
    });

    document.getElementById('pixi-container').appendChild(app.canvas);

    backgroundRect = new PIXI.Graphics();
    backgroundRect.zIndex = -1;
    app.stage.addChild(backgroundRect);

    // Set initial background to black
    drawBackground(settings.backgroundColor);    textContainer = new PIXI.Container();
    textContainer.zIndex = 0;
    textContainer.eventMode = 'static';
    textContainer.cursor = 'pointer';
    app.stage.addChild(textContainer);
    
    // Make stage interactive for drag events
    app.stage.eventMode = 'static';
    app.stage.hitArea = app.screen;

    // Create hover box (initially invisible)
    hoverBox = new PIXI.Graphics();
    hoverBox.zIndex = 1;
    hoverBox.visible = false;
    app.stage.addChild(hoverBox);

    // Add hover listeners to text container
    textContainer.on('pointerover', () => {
        if (textContainer.children.length > 0) {
            const bounds = textContainer.getBounds();
            hoverBox.clear();
            hoverBox.rect(bounds.x - 7, bounds.y, bounds.width + 20, bounds.height + 5);
            hoverBox.stroke({ width: 1, color: 0xFFFFFF });
            hoverBox.visible = true;
        }
    });

    textContainer.on('pointerout', () => {
        if (!isDragging) {
            hoverBox.visible = false;
        }
    });    // Drag and drop functionality (official PixiJS pattern)
    function onDragStart(event) {
        isDragging = true;
        textContainer.alpha = 0.7;
        const position = event.data.global;
        const bounds = textContainer.getBounds();
        dragOffset.x = position.x - bounds.x;
        dragOffset.y = position.y - bounds.y;
        app.stage.on('pointermove', onDragMove);
    }    function onDragMove(event) {
        if (isDragging) {
            const position = event.data.global;
            const bounds = textContainer.getBounds();

            const newX = position.x - dragOffset.x;
            const newY = position.y - dragOffset.y;
            const deltaX = newX - bounds.x;
            const deltaY = newY - bounds.y;

            textContainer.children.forEach(child => {
                child.x += deltaX;
                child.y += deltaY;
            });

            // Update customPosition continuously during drag
            const newBounds = textContainer.getBounds();
            customPosition = {
                x: newBounds.x + newBounds.width / 2,
                y: newBounds.y + newBounds.height / 2
            };

            // Update hover box position
            hoverBox.clear();
            hoverBox.rect(newBounds.x - 7, newBounds.y, newBounds.width + 20, newBounds.height + 5);
            hoverBox.stroke({ width: 1, color: 0xFFFFFF });
        }
    }

    function onDragEnd() {
        if (isDragging) {
            app.stage.off('pointermove', onDragMove);
            const bounds = textContainer.getBounds();
            customPosition = {
                x: bounds.x + bounds.width / 2,
                y: bounds.y + bounds.height / 2
            };
            isDragging = false;
            textContainer.alpha = 1;
        }
    }

    textContainer.on('pointerdown', onDragStart);
    app.stage.on('pointerup', onDragEnd);
    app.stage.on('pointerupoutside', onDragEnd);

    app.stage.sortableChildren = true;

    // Preload fonts to fix kerning issue on first render
    await document.fonts.load(`${settings.fontSize}px "Instrument Serif"`);
    await document.fonts.load(`${settings.fontSize}px "Inter"`);

    // Listen for resize events to reposition text
    app.renderer.on('resize', (width, height) => {
        // Re-animate current text to recenter it
        const lastText = textContainer.children.length > 0 ?
            textContainer.children[0].text : '';
        if (lastText) {
            animateText(lastText);
        }
    });

}

function drawBackground(color) {
    backgroundRect.clear();
    backgroundRect.rect(0, 0, app.screen.width, app.screen.height);
    backgroundRect.fill(color);
}

function clearBackground() {
    backgroundRect.clear();
}

function animateText(inputText) {
    lastText = inputText; // Store for re-rendering on settings change
    textContainer.removeChildren();

    // Clear any existing loop timeout to prevent multiple loops
    if (loopTimeout) {
        clearTimeout(loopTimeout);
        loopTimeout = null;
    }

    const lines = inputText.split('\n');

    // Use custom position if set, otherwise center
    let centerX, centerY;
    if (customPosition) {
        centerX = customPosition.x;
        centerY = customPosition.y;
    } else {
        centerX = app.screen.width / 2;
        centerY = app.screen.height / 2;
    }

    const totalHeight = lines.length * (settings.fontSize + 20);
    const startY = centerY - (totalHeight / 2);
    const maxWidth = app.screen.width - 100; // 50px padding on each side

    let totalChars = 0;

    lines.forEach((line, lineIndex) => {
        const splitText = new PIXI.SplitText({
            text: line,
            style: {
                fontFamily: settings.fontFamily,
                fontSize: settings.fontSize,
                fill: settings.color,
                align: 'center',
                wordWrap: true,
                wordWrapWidth: maxWidth,
                breakWords: true
            }
        });

        const yPos = startY + (lineIndex * (settings.fontSize + 20));
        splitText.x = centerX - (splitText.width / 2);
        splitText.y = yPos;

        textContainer.addChild(splitText);

        let globalCharIndex = lineIndex * 100;

        splitText.chars.forEach((char, charIndex) => {
            char.alpha = 0;
            const delay = (globalCharIndex + charIndex) * settings.charDelayStep * 1000;
            const hopOffset = Math.random() * (settings.hopMax - settings.hopMin) + settings.hopMin;

            setTimeout(() => {
                animateCharacter(char, hopOffset);
            }, delay);

            totalChars = globalCharIndex + charIndex + 1;
        });
    });

    if (settings.loopAnimation && inputText.trim()) {
        // Calculate total animation time: (last char delay) + (animation duration) + (2 second pause)
        const totalAnimTime = (totalChars * settings.charDelayStep * 1000) + (settings.animationDuration * 1000) + 2000;
        loopTimeout = setTimeout(() => {
            animateText(inputText);
        }, totalAnimTime);
    }
}

function animateCharacter(charText, hopOffset) {
    const startY = charText.y;
    let time = 0;
    const duration = settings.animationDuration;

    const ticker = (delta) => {
        time += delta.deltaTime / 60;

        if (time >= duration) {
            charText.alpha = 1;
            charText.y = startY;
            app.ticker.remove(ticker);
            return;
        }

        const progress = time / duration;
        charText.alpha = progress;
        const hopProgress = Math.sin(progress * Math.PI);
        charText.y = startY - (hopOffset * hopProgress);
    };

    app.ticker.add(ticker);
}

// Listen for messages from control window
ipcRenderer.on('render-text', (event, text) => {
    animateText(text);
});

ipcRenderer.on('update-settings', (event, newSettings) => {
    Object.assign(settings, newSettings);

    // Update background
    if (newSettings.backgroundTransparent) {
        clearBackground();
    } else {
        drawBackground(newSettings.backgroundColor);
    }

    // Re-render text with new settings if text exists
    if (lastText.trim()) {
        animateText(lastText);
    }
});

// Initialize
(async () => {
    await initPixi();
    console.log('Overlay ready!');
})();