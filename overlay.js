const PIXI = require('pixi.js');
const { ipcRenderer } = require('electron');

let app;
let backgroundRect;
let textObjects = new Map(); // Store multiple text objects by ID
let globalLoopTimer = null; // Single global loop timer for all objects

// Color pool for unique pastel colors
let usedColors = new Set();
const pastelColors = [
    0xFFB3BA, // pastel pink
    0xFFDFBA, // pastel peach
    0xFFFFBA, // pastel yellow
    0xBAFFC9, // pastel green
    0xBAE1FF, // pastel blue
    0xD4BAFF, // pastel purple
    0xFFBAE3, // pastel magenta
    0xBAFFFF, // pastel cyan
];

const globalSettings = {
    backgroundColor: 0x000000,
    backgroundTransparent: false
};

class TextObject {
    constructor(id, settings) {
        this.id = id;
        this.container = new PIXI.Container();
        this.container.zIndex = 0;
        this.container.eventMode = 'static';
        this.container.cursor = 'pointer';
        
        this.hoverBox = new PIXI.Graphics();
        this.hoverBox.zIndex = 1;
        this.hoverBox.visible = false;
        
        // Assign a random pastel color
        this.pastelColor = this.getRandomPastelColor();
        
        // Create an invisible hitbox that matches the hover box
        this.hitBox = new PIXI.Graphics();
        this.hitBox.eventMode = 'static';
        this.hitBox.cursor = 'pointer';
        this.hitBox.alpha = 0; // Invisible but still interactive        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        this.customPosition = null;
        this.savedLinePositions = []; // Save exact Y position of each line
        this.lastRenderedText = ''; // Track what text we last positioned for
        this.lastText = '';
        this.loopTimeout = null;
        this.isFocused = false;        this.settings = {
            fontSize: settings.fontSize || 48,
            fontFamily: settings.fontFamily || 'Instrument Serif',
            color: settings.color || 0xFFFFFF,
            loopAnimation: settings.loopAnimation !== false,
            outlineEnabled: settings.outlineEnabled !== false,
            outlineColor: settings.outlineColor || 0x000000,
            outlineWidth: settings.outlineWidth || 4,
            // DEFAULT: NO ANIMATION - must be explicitly set for animation
            charDelayStep: settings.charDelayStep || 0,
            hopMax: settings.hopMax || 0,
            hopMin: settings.hopMin || 0,
            hopVariation: settings.hopVariation || 0,
            animationDuration: settings.animationDuration || 0,
            fadeIn: settings.fadeIn || 0,
            fadeOut: settings.fadeOut || 0
        };
        
        // Set initial position
        if (settings.positionX && settings.positionY) {
            this.customPosition = {
                x: settings.positionX,
                y: settings.positionY
            };
        }
        
        this.setupDragging();
        this.setupHover();
    }    getRandomPastelColor() {
        // Get available colors (not yet used)
        const availableColors = pastelColors.filter(color => !usedColors.has(color));
        
        // If all colors used, reset the pool
        if (availableColors.length === 0) {
            usedColors.clear();
            availableColors.push(...pastelColors);
        }
        
        // Pick random from available
        const color = availableColors[Math.floor(Math.random() * availableColors.length)];
        usedColors.add(color);
        return color;
    }    setupHover() {
        // Use hitBox for hover detection instead of container
        this.hitBox.on('pointerover', () => {
            if (this.container.children.length > 0) {
                this.hoverBox.visible = true;
            }
        });
        
        this.hitBox.on('pointerout', () => {
            if (!this.isDragging && !this.isFocused) {
                this.hoverBox.visible = false;
            }
        });        // Click to focus
        this.hitBox.on('pointerdown', () => {
            // Unfocus all other text objects first
            textObjects.forEach(textObj => {
                if (textObj.id !== this.id) {
                    textObj.setFocused(false);
                }
            });
            
            this.setFocused(true);
            // Notify control panel of focus
            ipcRenderer.send('text-object-focused', this.id);
        });
    }
    
    setFocused(focused) {
        this.isFocused = focused;
        this.hoverBox.visible = focused || this.isDragging;
    }    updateHitboxAndHoverbox() {
        if (this.container.children.length > 0) {
            const bounds = this.container.getBounds();
            const padding = 10;
            
            // Update hover box (visible outline)
            this.hoverBox.clear();
            this.hoverBox.rect(bounds.x - padding, bounds.y - padding, bounds.width + padding * 2, bounds.height + padding * 2);
            this.hoverBox.stroke({ width: 1, color: this.pastelColor });
            
            // Update hitbox (invisible but same size as hover box)
            this.hitBox.clear();
            this.hitBox.rect(bounds.x - padding, bounds.y - padding, bounds.width + padding * 2, bounds.height + padding * 2);
            this.hitBox.fill({ color: 0x000000, alpha: 0.01 }); // Nearly invisible but interactive
        }
    }    setupDragging() {
        const onDragStart = (event) => {
            this.isDragging = true;
            this.container.alpha = 0.7;
            const position = event.data.global;
            const bounds = this.container.getBounds();
            this.dragOffset.x = position.x - bounds.x;
            this.dragOffset.y = position.y - bounds.y;
            
            // Store starting position for undo
            this.dragStartX = this.customPosition.x;
            this.dragStartY = this.customPosition.y;
            
            app.stage.on('pointermove', onDragMove);
        };
        
        const onDragMove = (event) => {
            if (this.isDragging) {
                const position = event.data.global;
                const bounds = this.container.getBounds();
                
                const newX = position.x - this.dragOffset.x;
                const newY = position.y - this.dragOffset.y;
                const deltaX = newX - bounds.x;
                const deltaY = newY - bounds.y;                this.container.children.forEach(child => {
                    child.x += deltaX;
                    child.y += deltaY;
                });
                
                // Update customPosition continuously during drag
                const newBounds = this.container.getBounds();
                this.customPosition = {
                    x: Math.round(newBounds.x + newBounds.width / 2),
                    y: Math.round(newBounds.y + newBounds.height / 2)
                };
                
                // Update saved line positions during drag so they stay locked
                this.container.children.forEach((child, index) => {
                    this.savedLinePositions[index] = child.y;
                });
                
                // Send position update to control panel
                ipcRenderer.send('position-updated', {
                    id: this.id,
                    x: this.customPosition.x,
                    y: this.customPosition.y
                });
                
                // Update both boxes
                this.updateHitboxAndHoverbox();
            }
        };        const onDragEnd = () => {
            if (this.isDragging) {
                app.stage.off('pointermove', onDragMove);
                // Position is already saved during drag, just mark we're done
                this.lastRenderedText = this.lastText; // Mark current text as positioned
                this.isDragging = false;
                this.container.alpha = 1;
                // Keep focused after drag
                this.hoverBox.visible = this.isFocused;
                
                // Send drag end event with start and end positions for undo history
                ipcRenderer.send('position-drag-ended', {
                    id: this.id,
                    oldX: this.dragStartX,
                    oldY: this.dragStartY,
                    newX: this.customPosition.x,
                    newY: this.customPosition.y
                });
            }
        };
        
        this.hitBox.on('pointerdown', onDragStart);
        app.stage.on('pointerup', onDragEnd);
        app.stage.on('pointerupoutside', onDragEnd);
    }    animateText(inputText, skipLoopSetup = false) {
        this.lastText = inputText;
        this.container.removeChildren();
        
        // Don't clear individual loop timeouts anymore - handled globally
        if (this.loopTimeout) {
            clearTimeout(this.loopTimeout);
            this.loopTimeout = null;
        }

        // Check if we should use instant rendering (no animation params set)
        const hasAnimation = this.settings.hopMax !== 0 || this.settings.hopMin !== 0 || 
                            this.settings.fadeIn !== 0 || this.settings.charDelayStep !== 0;
        
        if (!hasAnimation) {
            // Use instant rendering - no animation
            this.setTextInstant(inputText);
            return;
        }

        const lines = inputText.split('\n');
        
        const totalHeight = lines.length * (this.settings.fontSize + 20);
        const maxWidth = app.screen.width - 100;
        
        // Determine center X
        let centerX;
        if (this.customPosition) {
            centerX = this.customPosition.x;
        } else {
            centerX = app.screen.width / 2;
        }

        // If text content changed (not just a loop), recalculate positions
        if (this.lastRenderedText !== inputText) {
            const centerY = this.customPosition ? this.customPosition.y : app.screen.height / 2;
            const startY = centerY - (totalHeight / 2);
            
            // Save Y position for each line
            this.savedLinePositions = [];
            for (let i = 0; i < lines.length; i++) {
                this.savedLinePositions[i] = startY + (i * (this.settings.fontSize + 20));
            }
            
            this.lastRenderedText = inputText;
        }
        
        let totalChars = 0;
        
        // Track animation completion for event-based looping
        this.animatingChars = 0;
        this.completedChars = 0;
        
        lines.forEach((line, lineIndex) => {
            const textStyle = {
                fontFamily: this.settings.fontFamily,
                fontSize: this.settings.fontSize,
                fill: this.settings.color,
                align: 'center',
                wordWrap: true,
                wordWrapWidth: maxWidth,
                breakWords: true
            };
            
            // Add outline if enabled
            if (this.settings.outlineEnabled) {
                // Better scaling curve: more thickness at small sizes, less at large
                // Uses square root to scale more gently as font size increases
                const baseThickness = Math.sqrt(this.settings.fontSize) * 0.6;
                const scaledWidth = baseThickness * (this.settings.outlineWidth / 4);
                
                textStyle.stroke = {
                    color: this.settings.outlineColor,
                    width: scaledWidth
                };
            }

            const splitText = new PIXI.SplitText({
                text: line,
                style: textStyle
            });
            
            // Use saved Y position for this line - no calculation!
            const yPos = this.savedLinePositions[lineIndex];
            splitText.x = centerX - (splitText.width / 2);
            splitText.y = yPos;
            
            this.container.addChild(splitText);            // Animate all characters across all lines at once (no line delay)
            splitText.chars.forEach((char, charIndex) => {
                char.alpha = 0;
                const delay = (totalChars + charIndex) * this.settings.charDelayStep * 1000;
                const hopUp = this.settings.hopMax + (Math.random() * this.settings.hopVariation);
                const hopDown = this.settings.hopMin;
                
                this.animatingChars++; // Track total characters to animate
                
                setTimeout(() => {
                    this.animateCharacter(char, hopUp, hopDown, () => {
                        // Character animation completed
                        this.completedChars++;
                        
                        // Check if all characters are done
                        if (this.completedChars >= this.animatingChars) {
                            this.onAnimationComplete();
                        }
                    });
                }, delay);
            });

            // Track total characters for next line
            totalChars += splitText.chars.length;
        });

        
        
        // Update hitbox after a small delay to ensure bounds are calculated
        setTimeout(() => {
            this.updateHitboxAndHoverbox();
        }, 100);
        
        // Save the actual bounding box center as customPosition for next loop
        // This ensures position stays consistent across re-renders
        if (!this.customPosition) {
            const bounds = this.container.getBounds();
            this.customPosition = {
                x: Math.round(bounds.x + bounds.width / 2),
                y: Math.round(bounds.y + bounds.height / 2)
            };
            // Send initial position to control panel
            ipcRenderer.send('position-updated', {
                id: this.id,
                x: this.customPosition.x,
                y: this.customPosition.y
            });
        }
    }    onAnimationComplete() {
        // All characters finished animating
        // Update hitbox/hoverbox now that text is fully settled
        this.updateHitboxAndHoverbox();
        // Trigger global loop check instead of individual loop
        setupGlobalLoop();
    }    animateCharacter(charText, hopUp, hopDown, onComplete) {
        const startY = charText.y;
        let time = 0;
        const duration = this.settings.animationDuration;
        const fadeInDuration = this.settings.fadeIn || 0;
        const totalDuration = Math.max(duration, fadeInDuration); // Animation continues until BOTH are done
        
        const ticker = (delta) => {
            time += delta.deltaTime / 60;
            
            // Check if everything is complete
            if (time >= totalDuration) {
                charText.alpha = 1;
                charText.y = startY;
                app.ticker.remove(ticker);
                
                // Call completion callback if provided
                if (onComplete) {
                    onComplete();
                }
                return;
            }
            
            const progress = time / duration;
            
            // Fade in based on fadeInDuration setting
            if (fadeInDuration > 0) {
                charText.alpha = Math.min(1, time / fadeInDuration);
            } else {
                charText.alpha = 1; // No fade, instant visible
            }
            
            // Two-phase animation: up then down (only runs during hop duration)
            if (time < duration) {
                if (progress < 0.6) {
                    // Phase 1: Hop up (0 to 0.6)
                    const upProgress = progress / 0.6;
                    const hopProgress = Math.sin(upProgress * Math.PI);
                    charText.y = startY - (hopUp * hopProgress);
                } else {
                    // Phase 2: Dip down then settle (0.6 to 1.0)
                    const downProgress = (progress - 0.6) / 0.4;
                    const dipProgress = Math.sin(downProgress * Math.PI);
                    charText.y = startY - (hopDown * dipProgress);
                }
            } else {
                // Hop animation is done, stay at rest position
                charText.y = startY;
            }
        };
        
        app.ticker.add(ticker);
    }    async updateSettings(newSettings, silent = false) {
        // Check if we're turning off animation
        const disablingAnimation = newSettings.loopAnimation === false && this.settings.loopAnimation === true;
        
        // Handle font changes silently - just update settings and re-render text instantly
        if (newSettings.fontFamily !== undefined && this.settings.fontFamily !== newSettings.fontFamily) {
            this.settings.fontFamily = newSettings.fontFamily;
            
            // FORCE LOAD THE FONT BEFORE RENDERING
            try {
                await document.fonts.load(`${this.settings.fontSize}px "${newSettings.fontFamily}"`);
                await document.fonts.load(`12px "${newSettings.fontFamily}"`);
                await document.fonts.load(`48px "${newSettings.fontFamily}"`);
                await document.fonts.load(`72px "${newSettings.fontFamily}"`);
            } catch (err) {
                console.error(`[Overlay] Failed to load font ${newSettings.fontFamily}:`, err);
            }
            
            // Wait a bit to ensure PixiJS can access it
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Re-render text instantly with new font (no animation)
            if (this.lastText.trim()) {
                this.setTextInstant(this.lastText);
            }
            return; // Don't continue to animation logic
        }
        
        // Handle font size changes smoothly with scaling
        if (silent && newSettings.fontSize !== undefined && this.settings.fontSize !== newSettings.fontSize) {
            const oldSize = this.settings.fontSize;
            const newSize = newSettings.fontSize;
            const scaleFactor = newSize / oldSize;
            
            // Scale existing text around its center instead of re-rendering
            if (this.container.children.length > 0) {
                // Get the center point of all text before scaling
                const bounds = this.container.getBounds();
                const centerX = bounds.x + bounds.width / 2;
                const centerY = bounds.y + bounds.height / 2;
                
                // Scale each child
                this.container.children.forEach(child => {
                    // Get child's current center
                    const childBounds = child.getBounds();
                    const childCenterX = childBounds.x + childBounds.width / 2;
                    const childCenterY = childBounds.y + childBounds.height / 2;
                    
                    // Scale the child
                    child.scale.x *= scaleFactor;
                    child.scale.y *= scaleFactor;
                    
                    // Get new bounds after scaling
                    const newChildBounds = child.getBounds();
                    const newChildCenterX = newChildBounds.x + newChildBounds.width / 2;
                    const newChildCenterY = newChildBounds.y + newChildBounds.height / 2;
                    
                    // Adjust position to keep center in the same place
                    child.x += (childCenterX - newChildCenterX);
                    child.y += (childCenterY - newChildCenterY);
                });
            }            // Update the fontSize setting
            this.settings.fontSize = newSize;
            
            // Update customPosition to maintain center after scaling
            if (this.customPosition && this.container.children.length > 0) {
                const newBounds = this.container.getBounds();
                this.customPosition = {
                    x: Math.round(newBounds.x + newBounds.width / 2),
                    y: Math.round(newBounds.y + newBounds.height / 2)
                };
            }            // Clear saved positions so next animation uses correct size
            this.savedLinePositions = [];
            this.lastRenderedText = '';
            
            return; // Don't re-render
        }
        
        // Handle color changes when silent (live update without re-render)
        if (silent && newSettings.color !== undefined && this.settings.color !== newSettings.color) {
            // Update color on all existing text sprites
            this.container.children.forEach(child => {
                if (child.style) {
                    child.style.fill = newSettings.color;
                }
            });
        }
        
        Object.assign(this.settings, newSettings);
        
        // If font size changed (non-silent), clear saved positions so it recalculates
        if (newSettings.fontSize !== undefined) {
            this.savedLinePositions = [];
            this.lastRenderedText = '';
        }
        
        // If we're disabling animation, kill all tweens immediately and reset positions
        if (disablingAnimation) {
            // Kill all GSAP tweens for this text object's characters
            if (this.textContainer) {
                this.textContainer.children.forEach(char => {
                    gsap.killTweensOf(char);
                    // Reset to baseline position
                    char.y = 0;
                    char.alpha = 1;
                });
            }
            return; // Don't re-animate
        }
        
        // Re-animate if not silent
        if (!silent && this.lastText.trim()) {
            this.animateText(this.lastText);
        }
    }    updatePosition(x, y, silent = false) {
        this.customPosition = { x, y };
        
        if (silent) {
            // Just move existing text without re-animating
            if (this.container.children.length > 0) {
                const currentBounds = this.container.getBounds();
                const currentCenterX = currentBounds.x + currentBounds.width / 2;
                const currentCenterY = currentBounds.y + currentBounds.height / 2;
                
                const deltaX = x - currentCenterX;
                const deltaY = y - currentCenterY;
                
                this.container.children.forEach(child => {
                    child.x += deltaX;
                    child.y += deltaY;
                });
                
                // Update saved line positions
                this.container.children.forEach((child, index) => {
                    this.savedLinePositions[index] = child.y;
                });
                
                this.updateHitboxAndHoverbox();
            }
        } else {
            // Full re-animation
            this.savedLinePositions = [];
            this.lastRenderedText = '';
            if (this.lastText.trim()) {
                this.animateText(this.lastText);
            }
        }    }
    
    setTextInstant(inputText) {
        // Set text instantly without animation (for script control)
        this.lastText = inputText;
        this.container.removeChildren();
        
        const lines = inputText.split('\n');
        const totalHeight = lines.length * (this.settings.fontSize + 20);
        const maxWidth = app.screen.width - 100;
        
        // Determine center position
        const centerX = this.customPosition ? this.customPosition.x : app.screen.width / 2;
        const centerY = this.customPosition ? this.customPosition.y : app.screen.height / 2;
        const startY = centerY - (totalHeight / 2);
        
        // Save Y position for each line
        this.savedLinePositions = [];
        for (let i = 0; i < lines.length; i++) {
            this.savedLinePositions[i] = startY + (i * (this.settings.fontSize + 20));
        }
        
        this.lastRenderedText = inputText;
        
        lines.forEach((line, lineIndex) => {
            const textStyle = {
                fontFamily: this.settings.fontFamily,
                fontSize: this.settings.fontSize,
                fill: this.settings.color,
                align: 'center',
                wordWrap: true,
                wordWrapWidth: maxWidth,
                breakWords: true
            };
            
            // Add outline if enabled
            if (this.settings.outlineEnabled) {
                const baseThickness = Math.sqrt(this.settings.fontSize) * 0.6;
                const scaledWidth = baseThickness * (this.settings.outlineWidth / 4);
                
                textStyle.stroke = {
                    color: this.settings.outlineColor,
                    width: scaledWidth
                };
            }

            const splitText = new PIXI.SplitText({
                text: line,
                style: textStyle
            });
            
            const yPos = this.savedLinePositions[lineIndex];
            splitText.x = centerX - (splitText.width / 2);
            splitText.y = yPos;
            
            // Make all characters instantly visible (no animation)
            splitText.chars.forEach(char => {
                char.alpha = 1;
            });
            
            this.container.addChild(splitText);
        });
        
        // Update hitbox
        setTimeout(() => {
            this.updateHitboxAndHoverbox();
        }, 10);    }    // Set per-character offsets for script control
    setCharacterOffsets(offsets) {
        // offsets is an array of {x, y} objects, one per character
        if (!this.container.children.length) return;
        
        let charIndex = 0;
        this.container.children.forEach(splitText => {
            if (splitText.chars) {
                splitText.chars.forEach(char => {
                    if (offsets[charIndex]) {
                        const offset = offsets[charIndex];
                        // Store original position if not already stored
                        if (!char.userData) {
                            char.userData = {
                                originalX: char.x,
                                originalY: char.y
                            };
                        }
                        // Apply offset from original position
                        char.x = char.userData.originalX + (offset.x || 0);
                        char.y = char.userData.originalY + (offset.y || 0);
                    }
                    charIndex++;
                });
            }
        });
    }    // Set per-character colors for ombré effects
    setCharacterColors(colors) {
        // colors is an array of color values (0xRRGGBB), one per character
        if (!this.container.children.length) return;
        
        let charIndex = 0;
        this.container.children.forEach(splitText => {
            if (splitText.chars) {
                splitText.chars.forEach(char => {
                    if (colors[charIndex] !== undefined && char.style) {
                        char.style.fill = colors[charIndex];
                    }
                    charIndex++;
                });
            }
        });
    }
    
    destroy() {
        if (this.loopTimeout) {
            clearTimeout(this.loopTimeout);
        }
        // Return color to the pool when object is destroyed
        usedColors.delete(this.pastelColor);
        app.stage.removeChild(this.container);
        app.stage.removeChild(this.hoverBox);
        app.stage.removeChild(this.hitBox);
    }
}

// Notify control window when overlay visibility changes
document.addEventListener('visibilitychange', () => {
    ipcRenderer.send('overlay-visibility-changed', document.hidden);
});

// Keyboard shortcuts in overlay window
document.addEventListener('keydown', (e) => {
    // Ctrl+Z to undo position
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        ipcRenderer.send('request-undo');
    }
    // Ctrl+Y to redo position
    if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        ipcRenderer.send('request-redo');
    }
});

// Global loop management - restarts ONLY text objects with loopAnimation enabled
function setupGlobalLoop() {
    if (globalLoopTimer) {
        clearTimeout(globalLoopTimer);
    }
    
    // Check if all text objects with looping enabled are done animating
    let allDone = true;
    let hasLoopingObjects = false;
    
    textObjects.forEach(textObj => {
        if (textObj.settings.loopAnimation && textObj.lastText.trim()) {
            hasLoopingObjects = true;
            // Check if this object is still animating
            if (textObj.completedChars < textObj.animatingChars) {
                allDone = false;
            }
        }
    });
    
    // Only set up loop if there are actually objects that should loop
    if (allDone && hasLoopingObjects) {
        // All animations complete - wait 2 seconds then restart ONLY looping objects
        globalLoopTimer = setTimeout(() => {
            textObjects.forEach(textObj => {
                // ONLY restart if loopAnimation is true (excludes script-controlled text)
                if (textObj.settings.loopAnimation && textObj.lastText.trim()) {
                    textObj.animateText(textObj.lastText, true);
                }
            });
        }, 2000);
    }
}

async function initPixi() {
    app = new PIXI.Application();
    
    await app.init({
        width: window.innerWidth,
        height: window.innerHeight,
        backgroundAlpha: 0,
        antialias: true,
        autoStart: true,
        resizeTo: window
    });
    
    document.getElementById('pixi-container').appendChild(app.canvas);
    
    backgroundRect = new PIXI.Graphics();
    backgroundRect.zIndex = -1;
    app.stage.addChild(backgroundRect);
    
    drawBackground(globalSettings.backgroundColor);    app.stage.eventMode = 'static';
    app.stage.hitArea = app.screen;
    app.stage.sortableChildren = true;
    
    // Click on background to unfocus all
    app.stage.on('pointerdown', (event) => {
        // Check if we clicked on background (not on any text object)
        if (event.target === app.stage) {
            textObjects.forEach(textObj => {
                textObj.setFocused(false);
            });
            ipcRenderer.send('text-object-focused', null);
        }
    });
    
    await document.fonts.load(`48px "Instrument Serif"`).catch(err => 
        console.warn('Failed to preload Instrument Serif:', err)
    );
    document.fonts.load(`48px "Inter"`).catch(err => 
        console.warn('Failed to preload Inter:', err)
    );
}

function drawBackground(color) {
    backgroundRect.clear();
    backgroundRect.rect(0, 0, app.screen.width, app.screen.height);
    backgroundRect.fill(color);
}

function clearBackground() {
    backgroundRect.clear();
}

// IPC Message Handlers
ipcRenderer.on('create-text-object', (event, data) => {
    const textObj = new TextObject(data.id, data);
    textObjects.set(data.id, textObj);
    
    app.stage.addChild(textObj.container);
    app.stage.addChild(textObj.hitBox);
    app.stage.addChild(textObj.hoverBox);
    
    if (data.text) {
        textObj.animateText(data.text);
    }
});

ipcRenderer.on('delete-text-object', (event, id) => {
    const textObj = textObjects.get(id);
    if (textObj) {
        textObj.destroy();
        textObjects.delete(id);
    }
});

ipcRenderer.on('update-text-object', (event, data) => {
    const textObj = textObjects.get(data.id);
    if (textObj && data.text) {
        // Control window decides if we should animate
        if (data.shouldAnimate === false || data.instant === true) {
            textObj.setTextInstant(data.text);
        } else {
            textObj.animateText(data.text);
        }
    }
});

ipcRenderer.on('update-text-object-position', (event, data) => {
    const textObj = textObjects.get(data.id);
    if (textObj) {
        textObj.updatePosition(data.x, data.y, data.silent);
    }
});

ipcRenderer.on('update-character-offsets', (event, data) => {
    const textObj = textObjects.get(data.id);
    if (textObj) {
        textObj.setCharacterOffsets(data.offsets);
    }
});

ipcRenderer.on('update-character-colors', (event, data) => {
    const textObj = textObjects.get(data.id);
    if (textObj) {
        textObj.setCharacterColors(data.colors);
    }
});

ipcRenderer.on('update-text-object-settings', (event, data) => {
    const textObj = textObjects.get(data.id);
    if (textObj) {
        const settings = {};
        if (data.fontSize !== undefined) settings.fontSize = data.fontSize;
        if (data.fontFamily !== undefined) settings.fontFamily = data.fontFamily;
        if (data.color !== undefined) settings.color = data.color;
        if (data.loopAnimation !== undefined) settings.loopAnimation = data.loopAnimation;
        if (data.outlineEnabled !== undefined) settings.outlineEnabled = data.outlineEnabled;
        if (data.outlineColor !== undefined) settings.outlineColor = data.outlineColor;
        if (data.outlineWidth !== undefined) settings.outlineWidth = data.outlineWidth;
        if (data.hopMin !== undefined) settings.hopMin = data.hopMin;
        if (data.hopMax !== undefined) settings.hopMax = data.hopMax;
        if (data.hopVariation !== undefined) settings.hopVariation = data.hopVariation;
        if (data.charDelayStep !== undefined) settings.charDelayStep = data.charDelayStep;
        if (data.animationSpeed !== undefined) {
            // Convert speed multiplier to duration (base duration = 0.4s)
            settings.animationDuration = 0.4 / data.animationSpeed;
        }
        if (data.fadeIn !== undefined) settings.fadeIn = data.fadeIn;
        if (data.fadeOut !== undefined) settings.fadeOut = data.fadeOut;
        
        // Pass silent flag (default to false, but true for fontSize changes during dragging)
        const silent = data.silent || false;
        textObj.updateSettings(settings, silent);
    }
});

ipcRenderer.on('update-background', (event, settings) => {
    globalSettings.backgroundColor = settings.backgroundColor;
    globalSettings.backgroundTransparent = settings.backgroundTransparent;
    
    if (settings.backgroundTransparent) {
        clearBackground();
    } else {
        drawBackground(settings.backgroundColor);
    }
});

// Redraw background when window resizes (e.g., fullscreen)
let resizeTimeout;
let isResizing = false;

window.addEventListener('resize', () => {
    // Mark that we're resizing
    if (!isResizing) {
        isResizing = true;
        // Stop PixiJS rendering during resize
        app.ticker.stop();
        // Notify control panel to pause scripts
        ipcRenderer.send('overlay-visibility-changed', true);
    }
    
    // Clear any pending resize operations
    clearTimeout(resizeTimeout);
    
    // Debounce the resize to avoid performance issues
    resizeTimeout = setTimeout(() => {
        // Resize PixiJS renderer to match new window size
        app.renderer.resize(window.innerWidth, window.innerHeight);
        
        // Redraw background to fill new size
        if (!globalSettings.backgroundTransparent) {
            drawBackground(globalSettings.backgroundColor);
        }
        
        // Resume everything after resize is done
        app.ticker.start();
        isResizing = false;
        ipcRenderer.send('overlay-visibility-changed', false);
    }, 150); // Wait for resize to complete
});

// Load custom font
ipcRenderer.on('load-custom-font', async (event, { fontFamily, fontPath }) => {
    try {
        // Read font file as base64
        const fs = require('fs');
        const fontData = fs.readFileSync(fontPath);
        const base64Font = fontData.toString('base64');
        
        const style = document.createElement('style');
        style.textContent = `
            @font-face {
                font-family: "${fontFamily}";
                src: url(data:font/truetype;charset=utf-8;base64,${base64Font}) format("truetype");
            }
        `;
        document.head.appendChild(style);
        
        // Load at multiple sizes like Google Fonts
        await document.fonts.load(`12px "${fontFamily}"`);
        await document.fonts.load(`24px "${fontFamily}"`);
        await document.fonts.load(`48px "${fontFamily}"`);
        await document.fonts.load(`72px "${fontFamily}"`);
        
        // Extra delay to ensure PixiJS can access it
        await new Promise(resolve => setTimeout(resolve, 50));
        
        // Force re-render all text objects after font loads
        setTimeout(() => {
            textObjects.forEach(textObj => {
                if (textObj.lastText.trim()) {
                    textObj.setTextInstant(textObj.lastText);
                }
            });
        }, 100);
        
    } catch (error) {
        console.error(`[Overlay] Failed to load custom font ${fontFamily}:`, error);
    }
});

// Load Google Font
ipcRenderer.on('load-google-font', async (event, { fontFamily, fontFileName, fontPath }) => {
    try {
        const fs = require('fs');
        const style = document.createElement('style');
        
        // If fontPath is provided (local fonts), read as base64
        if (fontPath) {
            const fontData = fs.readFileSync(fontPath);
            const base64Font = fontData.toString('base64');
            
            style.textContent = `
                @font-face {
                    font-family: "${fontFamily}";
                    src: url(data:font/truetype;charset=utf-8;base64,${base64Font}) format("truetype");
                }
            `;
        } else {
            // This fallback shouldn't be hit anymore
            console.warn('[Overlay] load-google-font called without fontPath');
            return;
        }
        
        document.head.appendChild(style);        // Wait for font to load in DOM
        await document.fonts.load(`12px "${fontFamily}"`);
        
        // CRITICAL: Force font to load at multiple sizes for PixiJS
        await document.fonts.load(`24px "${fontFamily}"`);
        await document.fonts.load(`48px "${fontFamily}"`);
        await document.fonts.load(`72px "${fontFamily}"`);
        
        // Extra delay to ensure PixiJS can access it
        await new Promise(resolve => setTimeout(resolve, 50));
        
        // Force re-render all text objects after font loads
        setTimeout(() => {
            textObjects.forEach(textObj => {
                if (textObj.lastText.trim()) {
                    textObj.setTextInstant(textObj.lastText);
                }
            });
        }, 100);
        
    } catch (error) {
        console.error(`[Overlay] Failed to load font ${fontFamily}:`, error);
    }
});

ipcRenderer.on('update-animation-settings', (event, settings) => {
    // Update all existing text objects with new animation settings
    textObjects.forEach(textObj => {
        if (settings.hopMin !== undefined) textObj.settings.hopMin = settings.hopMin;
        if (settings.hopMax !== undefined) textObj.settings.hopMax = settings.hopMax;
        if (settings.charDelayStep !== undefined) textObj.settings.charDelayStep = settings.charDelayStep;
        if (settings.animationDuration !== undefined) textObj.settings.animationDuration = settings.animationDuration;
    });
});

ipcRenderer.on('reset-text-position', (event, data) => {
    const textObj = textObjects.get(data.id);
    if (textObj && textObj.lastText.trim()) {
        // Clear custom position and saved line positions to force recalculation
        textObj.customPosition = null;
        textObj.savedLinePositions = [];
        textObj.lastRenderedText = '';
        
        // Re-render the text, which will center it
        textObj.animateText(textObj.lastText);
        
        // The position will be sent back to control in the animateText function
        // when it saves customPosition after rendering
    }
});

// Toggle overlay window controls visibility
ipcRenderer.on('toggle-overlay-controls', (event, show) => {
    const titlebar = document.getElementById('titlebar');
    if (titlebar) {
        titlebar.style.display = show ? 'flex' : 'none';
    }
});

// Initialize
(async () => {
    await initPixi();
})();
