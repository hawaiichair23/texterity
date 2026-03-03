const PIXI = require('pixi.js');
const { ipcRenderer } = require('electron');

let app;
let backgroundRect;
let trianglesGraphics;
let scriptGraphicsMap = new Map(); // Map of scriptId -> Graphics object for per-script rendering
let scriptHitboxMap = new Map(); // Map of scriptId -> hitbox Graphics for interaction
let scriptHoverBoxMap = new Map(); // Map of scriptId -> hover box Graphics for visual feedback
let scriptPositionOffsets = new Map(); // Map of scriptId -> {x, y} position offsets for dragging
let scriptBufferCache = new Map(); // Map of scriptId -> {vertices, colors, indices} reusable buffers
let textObjects = new Map(); // Store multiple text objects by ID
let globalLoopTimer = null; // Single global loop timer for all objects
let clickThroughEnabled = false; // Track click-through mode state
let animationCallbacks = new Map(); // Store animation callbacks by scriptId

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

// Neon colors for 3D objects
let usedNeonColors = new Set();
let scriptNeonColors = new Map(); // Map scriptId to assigned neon color
const neonColors = [
    0x00FFFF, // cyan
    0xFF00FF, // magenta
    0x00FF00, // lime green
    0xFF0080, // hot pink
    0x80FF00, // chartreuse
    0xFF6600, // orange
    0x0080FF, // electric blue
    0xFFFF00, // yellow
    0xFF0040, // red-pink
    0x00FFAA, // aquamarine
];

function getRandomNeonColor() {
    const availableColors = neonColors.filter(color => !usedNeonColors.has(color));
    if (availableColors.length === 0) {
        usedNeonColors.clear();
        availableColors.push(...neonColors);
    }
    const color = availableColors[Math.floor(Math.random() * availableColors.length)];
    usedNeonColors.add(color);
    return color;
}

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
        this.charState = [];
        this.lastText = '';
        this.loopTimeout = null;
        this.isFocused = false;        this.settings = {
            fontSize: settings.fontSize || 48,
            fontFamily: settings.fontFamily || 'Instrument Serif',
            color: settings.color !== undefined ? settings.color : 0xFFFFFF,
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
        this.setupHover();    }    getRandomPastelColor() {
        // Get available colors (not yet used)
        const availableColors = pastelColors.filter(color => !usedColors.has(color));
        
        // If all colors used, reset the pool
        if (availableColors.length === 0) {
            usedColors.clear();
            availableColors.push(...pastelColors);
        }        // Pick random from available
        const color = availableColors[Math.floor(Math.random() * availableColors.length)];
        usedColors.add(color);
        return color;
    }

    setupHover() {
        // Use hitBox for hover detection instead of container
        this.hitBox.on('pointerover', () => {
            if (this.container.children.length > 0) {
                this.hoverBox.visible = true;
                
                // Disable click-through when hovering over text (allows dragging)
                ipcRenderer.send('set-click-through-temporarily', false);
            }
        });        this.hitBox.on('pointerout', () => {
            if (!this.isDragging) {
                // In click-through mode: hide box and unfocus when mouse leaves
                // In normal mode: keep box visible when focused (clicked)
                if (clickThroughEnabled) {
                    this.hoverBox.visible = false;
                    this.setFocused(false);
                    ipcRenderer.send('text-object-focused', null);
                } else {
                    // Normal mode: only hide box if not focused
                    if (!this.isFocused) {
                        this.hoverBox.visible = false;
                    }
                }
            }
            
            // Re-enable click-through when leaving text (if click-through mode is on)
            if (!this.isDragging) {
                ipcRenderer.send('restore-click-through-state');
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
    }    animateText(inputText) {
        this.lastText = inputText;
        this.container.scale.set(1);
        this.container.x = 0;
        this.container.y = 0;
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
        const maxWidth = app.screen.width - 100;
        const centerX = this.customPosition ? this.customPosition.x : app.screen.width / 2;
        const centerY = this.customPosition ? this.customPosition.y : app.screen.height / 2;

        let totalChars = 0;
        this.animatingChars = 0;
        this.completedChars = 0;

        // First pass: build all splitText objects with full styles to get real dimensions
        const builtLines = [];
        lines.forEach((line) => {
            const textStyle = {
                fontFamily: this.settings.fontFamily,
                fontSize: this.settings.fontSize,
                fill: this.settings.color,
                align: 'center',
                wordWrap: true,
                wordWrapWidth: maxWidth,
                breakWords: true
            };
            if (this.settings.outlineEnabled) {
                const baseThickness = Math.sqrt(this.settings.fontSize) * 0.6;
                textStyle.stroke = {
                    color: this.settings.outlineColor,
                    width: baseThickness * (this.settings.outlineWidth / 4)
                };
            }
            if (this.settings.dropShadow) {
                textStyle.dropShadow = {
                    color: this.settings.dropShadowColor ?? 0x000000,
                    alpha: this.settings.dropShadowAlpha ?? 1,
                    angle: this.settings.dropShadowAngle ?? Math.PI / 4,
                    blur: this.settings.dropShadowBlur ?? 0,
                    distance: this.settings.dropShadowDistance ?? 6,
                };
            }
            builtLines.push(new PIXI.SplitText({ text: line, style: textStyle, charAnchor: 0.5 }));
        });

        // Second pass: place using real measured heights
        const totalHeight = builtLines.reduce((sum, s) => sum + s.height, 0);
        let currentY = centerY - totalHeight / 2;
        builtLines.forEach((splitText, lineIndex) => {
            splitText.x = centerX - (splitText.width / 2);
            splitText.y = currentY;
            currentY += splitText.height;
            this.container.addChild(splitText);

            splitText.chars.forEach((char, charIndex) => {
                char.alpha = 0;
                const delay = (totalChars + charIndex) * this.settings.charDelayStep * 1000;
                const hopUp = this.settings.hopMax + (Math.random() * this.settings.hopVariation);
                const hopDown = this.settings.hopMin;
                this.animatingChars++;
                setTimeout(() => {
                    this.animateCharacter(char, hopUp, hopDown, () => {
                        this.completedChars++;
                        if (this.completedChars >= this.animatingChars) {
                            this.onAnimationComplete();
                        }
                    });
                }, delay);
            });
            totalChars += splitText.chars.length;
        });

        // Init or preserve charState for new text, then apply to freshly built sprites
        const charCount = inputText.replace(/\n/g, '').length;
        if (this.charState.length !== charCount) {
            this.initCharState(charCount);
        }

        // Snapshot real char positions into charState before applying
        let charStateIndex = 0;
        builtLines.forEach(splitText => {
            splitText.chars.forEach((char, i) => {
                if (this.charState[charStateIndex + i]) {
                    this.charState[charStateIndex + i].baseX = char.x;
                    this.charState[charStateIndex + i].baseY = char.y;
                }
            });
            charStateIndex += splitText.chars.length;
        });

        this.applyCharState();

        

        
        
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
        
        // During drag (silent), scale the container visually around its center
        if (silent && newSettings.fontSize !== undefined) {
            const oldSize = this.settings.fontSize;
            this.settings.fontSize = newSettings.fontSize;
            if (oldSize > 0 && this.container.children.length > 0) {
                const factor = newSettings.fontSize / oldSize;
                const bounds = this.container.getBounds();
                const cx = bounds.x + bounds.width / 2;
                const cy = bounds.y + bounds.height / 2;
                this.container.scale.x *= factor;
                this.container.scale.y *= factor;
                const newBounds = this.container.getBounds();
                const newCx = newBounds.x + newBounds.width / 2;
                const newCy = newBounds.y + newBounds.height / 2;
                this.container.x += cx - newCx;
                this.container.y += cy - newCy;
            }
            return;
        }
        
        // Handle color changes when silent (live update without re-render)
        if (silent && newSettings.color !== undefined && this.settings.color !== newSettings.color) {
            this.container.children.forEach(child => {
                if (child.style) {
                    child.style.fill = newSettings.color;
                }
            });
        }
        
        Object.assign(this.settings, newSettings);
        
        if (disablingAnimation) {
            if (this.textContainer) {
                this.textContainer.children.forEach(char => {
                    gsap.killTweensOf(char);
                    char.y = 0;
                    char.alpha = 1;
                });
            }
            return;
        }
        
        if (!silent && this.lastText.trim()) {
            this.container.scale.set(1);
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
                
                this.updateHitboxAndHoverbox();
            }
        } else {
            // Full re-animation
            if (this.lastText.trim()) {
                this.animateText(this.lastText);
            }
        }    }
    
    setTextInstant(inputText) {
        // Set text instantly without animation (for script control)
        this.lastText = inputText;
        this.container.removeChildren();
        
        const lines = inputText.split('\n');
        const maxWidth = app.screen.width - 100;
        
        // Determine center position
        const centerX = this.customPosition ? this.customPosition.x : app.screen.width / 2;
        const centerY = this.customPosition ? this.customPosition.y : app.screen.height / 2;

        // Measure real line heights from SplitText
        const tempStyle = {
            fontFamily: this.settings.fontFamily,
            fontSize: this.settings.fontSize,
            fill: this.settings.color,
            align: 'center',
            wordWrap: true,
            wordWrapWidth: maxWidth,
            breakWords: true
        };
        const lineHeights = lines.map(line => {
            const t = new PIXI.SplitText({ text: line || ' ', style: tempStyle, charAnchor: 0.5 });
            const h = t.height;
            t.destroy();
            return h;
        });
        const totalHeight = lineHeights.reduce((a, b) => a + b, 0);

        this.savedLinePositions = [];
        let currentY = centerY - totalHeight / 2;
        for (let i = 0; i < lines.length; i++) {
            this.savedLinePositions[i] = currentY;
            currentY += lineHeights[i];
        }
        
        const totalChars = inputText.replace(/\n/g, '').length;
        if (this.charState.length !== totalChars) {
            this.initCharState(totalChars);
        }

        let charStateIndex = 0;
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

            // Add drop shadow if enabled
            if (this.settings.dropShadow) {
                textStyle.dropShadow = {
                    color: this.settings.dropShadowColor !== undefined ? this.settings.dropShadowColor : 0x000000,
                    alpha: this.settings.dropShadowAlpha !== undefined ? this.settings.dropShadowAlpha : 1,
                    angle: this.settings.dropShadowAngle !== undefined ? this.settings.dropShadowAngle : Math.PI / 4,
                    blur: this.settings.dropShadowBlur !== undefined ? this.settings.dropShadowBlur : 0,
                    distance: this.settings.dropShadowDistance !== undefined ? this.settings.dropShadowDistance : 6,
                };
            }

            const splitText = new PIXI.SplitText({
                text: line,
                style: textStyle,
                charAnchor: 0.5
            });
            
            const yPos = this.savedLinePositions[lineIndex];
            splitText.x = centerX - (splitText.width / 2);
            splitText.y = yPos;
            
            // Make all characters instantly visible and snapshot base positions
            splitText.chars.forEach((char, i) => {
                char.alpha = 1;
                if (this.charState[charStateIndex + i]) {
                    this.charState[charStateIndex + i].baseX = char.x;
                    this.charState[charStateIndex + i].baseY = char.y;
                }
            });
            charStateIndex += splitText.chars.length;
            
            this.container.addChild(splitText);
        });
        
        // Apply charState (scale, offsets, colors) to freshly laid-out sprites
        this.applyCharState();
        // Re-apply after a tick in case IPC char state updates arrive async
        setTimeout(() => this.applyCharState(), 50);

        // Update hitbox
        setTimeout(() => {
            this.updateHitboxAndHoverbox();
        }, 10);
    }

    // Initialize charState to defaults for the current text length
    initCharState(length) {
        const old = this.charState;
        this.charState = [];
        for (let i = 0; i < length; i++) {
            this.charState.push({ scale: 1, baseX: 0, baseY: 0, offsetX: 0, offsetY: 0, jitterX: 0, jitterY: 0, color: null });
        }
    }

    // Apply charState to all current sprites - called after every render
    applyCharState() {
        if (!this.container.children.length || !this.charState.length) return;
        let charIndex = 0;
        this.container.children.forEach(splitText => {
            if (!splitText.chars) return;
            splitText.chars.forEach(char => {
                const state = this.charState[charIndex];
                if (!state) { charIndex++; return; }
                char.scale.set(state.scale);
                char.x = state.baseX + state.offsetX + state.jitterX;
                char.y = state.baseY + state.offsetY + state.jitterY;
                if (state.color !== null) {
                    char.tint = state.color;
                }
                charIndex++;
            });
        });
    }

    // Set per-character scale
    setCharacterSize(sizes) {
        sizes.forEach((size, i) => {
            if (size != null) {
                if (!this.charState[i]) this.charState[i] = { scale: 1, offsetX: 0, offsetY: 0 };
                this.charState[i].scale = size;
            }
        });
        this.applyCharState();
    }

    // Set per-character offsets (used by animated effects like spiral)
    setCharacterOffsets(offsets) {
        offsets.forEach((offset, i) => {
            if (offset) {
                if (!this.charState[i]) this.charState[i] = { scale: 1, offsetX: 0, offsetY: 0, jitterX: 0, jitterY: 0, color: null };
                this.charState[i].offsetX = offset.x || 0;
                this.charState[i].offsetY = offset.y || 0;
            }
        });
        this.applyCharState();
    }

    // Set per-character jitter (static baseline nudge, composited separately from effects)
    setCharacterJitter(offsets) {
        offsets.forEach((offset, i) => {
            if (offset) {
                if (!this.charState[i]) this.charState[i] = { scale: 1, offsetX: 0, offsetY: 0, jitterX: 0, jitterY: 0, color: null };
                this.charState[i].jitterX = offset.x || 0;
                this.charState[i].jitterY = offset.y || 0;
            }
        });
        this.applyCharState();
    }


    // Set per-character colors
    setCharacterColors(colors) {
        colors.forEach((color, i) => {
            if (color !== undefined) {
                if (!this.charState[i]) this.charState[i] = { scale: 1, baseX: 0, baseY: 0, offsetX: 0, offsetY: 0, jitterX: 0, jitterY: 0, color: null };
                this.charState[i].color = color;
            }
        });
        this.applyCharState();
    }

    destroy() {
        if (this.loopTimeout) {
            clearTimeout(this.loopTimeout);
        }
        // Return color to the pool when object is destroyed
        usedColors.delete(this.pastelColor);
        app.stage.removeChild(this.container);
        app.stage.removeChild(this.hoverBox);
        app.stage.removeChild(this.hitBox);    }
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
                    textObj.animateText(textObj.lastText);
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
    
    document.getElementById('pixi-container').appendChild(app.canvas);    backgroundRect = new PIXI.Graphics();
    backgroundRect.zIndex = -1;
    app.stage.addChild(backgroundRect);

    trianglesGraphics = new PIXI.Graphics();
    trianglesGraphics.zIndex = 0;
    app.stage.addChild(trianglesGraphics);

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
    });    await document.fonts.load(`48px "Instrument Serif"`).catch(err => 
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

// Draw a triangle - adds to the global triangles graphics object
function drawTriangle(x1, y1, x2, y2, x3, y3, color) {
    // Draw triangle using polygon
    trianglesGraphics.poly([x1, y1, x2, y2, x3, y3]);
    trianglesGraphics.fill(color);
}

// Clear all triangles
function clearTriangles() {
    trianglesGraphics.clear();
}

// IPC Message Handlers
ipcRenderer.on('create-text-object', (event, data) => {
    const textObj = new TextObject(data.id, data);
    textObjects.set(data.id, textObj);
    
    app.stage.addChild(textObj.container);
    app.stage.addChild(textObj.hitBox);
    app.stage.addChild(textObj.hoverBox);
    
    if (data.text) {
        textObj.setTextInstant(data.text);
    }
    if (data.charSizes) {
        textObj.setCharacterSize(data.charSizes);
    }
});


ipcRenderer.on('set-character-size', (event, { id, sizes }) => {
    const textObj = textObjects.get(id);
    if (textObj) textObj.setCharacterSize(sizes);
});

ipcRenderer.on('set-character-jitter', (event, { id, offsets }) => {
    const textObj = textObjects.get(id);
    if (textObj) textObj.setCharacterJitter(offsets);
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

ipcRenderer.on('draw-triangle', (event, data) => {
    drawTriangle(data.x1, data.y1, data.x2, data.y2, data.x3, data.y3, data.color);
});

ipcRenderer.on('clear-triangles', () => {
    clearTriangles();
});

ipcRenderer.on('draw-triangles-batch', (event, data) => {
    // Clear first, then draw all triangles atomically
    trianglesGraphics.clear();
    
    data.triangles.forEach(tri => {
        trianglesGraphics.poly([tri.x1, tri.y1, tri.x2, tri.y2, tri.x3, tri.y3]);
        trianglesGraphics.fill(tri.color);
    });
});

ipcRenderer.on('update-text-object-settings', (event, data) => {
    const textObj = textObjects.get(data.id);
    if (textObj) {
        const settings = {};
        if (data.fontSize !== undefined) settings.fontSize = data.fontSize;
        if (data.fontFamily !== undefined) settings.fontFamily = data.fontFamily;
        if (data.color !== undefined) settings.color = data.color;
        if (data.dropShadow !== undefined) settings.dropShadow = data.dropShadow;
        if (data.dropShadowColor !== undefined) settings.dropShadowColor = data.dropShadowColor;
        if (data.dropShadowAlpha !== undefined) settings.dropShadowAlpha = data.dropShadowAlpha;
        if (data.dropShadowAngle !== undefined) settings.dropShadowAngle = data.dropShadowAngle;
        if (data.dropShadowBlur !== undefined) settings.dropShadowBlur = data.dropShadowBlur;
        if (data.dropShadowDistance !== undefined) settings.dropShadowDistance = data.dropShadowDistance;
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
            const isOtf = fontPath.toLowerCase().endsWith('.otf');
            const fontFormat = isOtf ? 'opentype' : 'truetype';
            const mimeType = isOtf ? 'font/otf' : 'font/truetype';
            
            style.textContent = `
                @font-face {
                    font-family: "${fontFamily}";
                    src: url(data:${mimeType};charset=utf-8;base64,${base64Font}) format("${fontFormat}");
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

// Unfocus all text objects (when entering click-through mode)
ipcRenderer.on('unfocus-all-text-objects', () => {
    clickThroughEnabled = true; // Enable click-through mode
    textObjects.forEach(textObj => {
        textObj.setFocused(false);
    });
    // Also notify control panel
    ipcRenderer.send('text-object-focused', null);
});

// Listen for click-through mode changes
ipcRenderer.on('click-through-mode-changed', (event, enabled) => {
    clickThroughEnabled = enabled;
});

// Animation system - runs in sync with PixiJS ticker
ipcRenderer.on('start-animation', (event, data) => {
    const { scriptId, code } = data;
    
    try {
        // Create animation context with helper functions
        const animationContext = {
            rotateX: (x, y, z, angle) => {
                const cos = Math.cos(angle);
                const sin = Math.sin(angle);
                return { x: x, y: y * cos - z * sin, z: y * sin + z * cos };
            },
            rotateY: (x, y, z, angle) => {
                const cos = Math.cos(angle);
                const sin = Math.sin(angle);
                return { x: x * cos + z * sin, y: y, z: -x * sin + z * cos };
            },
            rotateZ: (x, y, z, angle) => {
                const cos = Math.cos(angle);
                const sin = Math.sin(angle);
                return { x: x * cos - y * sin, y: x * sin + y * cos, z: z };
            },            project3D: (x, y, z, distance = 500) => {
                const scale = distance / (distance + z);
                return { x: x * scale + 640, y: y * scale + 360 };
            },            calculateFaceLighting: (vertices3D, faces, lightDir = {x: 1, y: -1, z: 1}) => {
                // Normalize light direction
                const lightLen = Math.sqrt(lightDir.x * lightDir.x + lightDir.y * lightDir.y + lightDir.z * lightDir.z);
                const lightNorm = {
                    x: lightDir.x / lightLen,
                    y: lightDir.y / lightLen,
                    z: lightDir.z / lightLen
                };
                
                // Camera is at origin looking down -Z axis
                const cameraPos = { x: 0, y: 0, z: 0 };
                
                // Calculate brightness for each face WITH backface culling and z-depth
                const faceData = [];
                
                for (let i = 0; i < faces.length; i++) {
                    const face = faces[i];
                    const v1 = vertices3D[face[0]];
                    const v2 = vertices3D[face[1]];
                    const v3 = vertices3D[face[2]];
                    
                    // Calculate two edges of the triangle
                    const edge1 = {
                        x: v2.x - v1.x,
                        y: v2.y - v1.y,
                        z: v2.z - v1.z
                    };
                    
                    const edge2 = {
                        x: v3.x - v1.x,
                        y: v3.y - v1.y,
                        z: v3.z - v1.z
                    };
                    
                    // Calculate normal (cross product)
                    const normal = {
                        x: edge1.y * edge2.z - edge1.z * edge2.y,
                        y: edge1.z * edge2.x - edge1.x * edge2.z,
                        z: edge1.x * edge2.y - edge1.y * edge2.x
                    };
                    
                    // Normalize the normal
                    const normalLen = Math.sqrt(normal.x * normal.x + normal.y * normal.y + normal.z * normal.z);
                    if (normalLen > 0) {
                        normal.x /= normalLen;
                        normal.y /= normalLen;
                        normal.z /= normalLen;
                    }
                    
                    // BACKFACE CULLING: Calculate camera vector (from camera to triangle)
                    const camVec = {
                        x: v1.x - cameraPos.x,
                        y: v1.y - cameraPos.y,
                        z: v1.z - cameraPos.z
                    };
                    
                    // Dot product - if positive, triangle faces away from camera, cull it
                    const facing = normal.x * camVec.x + normal.y * camVec.y + normal.z * camVec.z;
                    
                    if (facing >= 0) {
                        // Backface - skip it
                        continue;
                    }
                    
                    // Calculate lighting (dot product with light direction)
                    let brightness = normal.x * lightNorm.x + normal.y * lightNorm.y + normal.z * lightNorm.z;
                    
                    // Clamp to 0-1 and add ambient light
                    brightness = Math.max(0, brightness);
                    brightness = 0.3 + brightness * 0.7; // 30% ambient + 70% directional
                    
                    // Calculate average Z depth for sorting (painter's algorithm)
                    const avgZ = (v1.z + v2.z + v3.z) / 3;                    faceData.push({
                        faceIndex: i,
                        brightness: brightness,
                        avgZ: avgZ
                    });
                }                // Z-SORT: Sort by average Z (farthest first)
                faceData.sort((a, b) => b.avgZ - a.avgZ);
                
                // Return array of brightness values in sorted order with original face indices
                return faceData.map(data => ({
                    faceIndex: data.faceIndex,
                    brightness: data.brightness
                }));
            },            drawTriangles: (triangles) => {
                // Get this script's mesh object
                let mesh = scriptGraphicsMap.get(scriptId);
                let geometry = null;
                
                // If it doesn't exist yet, create it
                if (!mesh) {
                    // Use MeshGeometry - the CORRECT API for PixiJS v8
                    geometry = new PIXI.MeshGeometry({
                        positions: new Float32Array([0, 0]),
                        uvs: new Float32Array([0, 0]),
                        indices: new Uint32Array([0])
                    });
                    
                    // Add custom color attribute AFTER creation
                    geometry.addAttribute('aColor', new Float32Array([1, 1, 1, 1]), 4);                    // Create shader using PixiJS v8 API with WebGL 1 compatible GLSL
                    // MeshGeometry uses aPosition (from positions property)
                    const glProgram = PIXI.GlProgram.from({
                        vertex: `
                            attribute vec2 aPosition;
                            attribute vec4 aColor;
                            
                            varying vec4 vColor;
                            
                            uniform mat3 uProjectionMatrix;
                            uniform mat3 uWorldTransformMatrix;
                            uniform mat3 uTransformMatrix;
                            
                            void main() {
                                vColor = aColor;
                                mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
                                gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
                            }
                        `,
                        fragment: `
                            precision mediump float;
                            varying vec4 vColor;
                            
                            void main() {
                                gl_FragColor = vColor;
                            }
                        `
                    });
                    
                    const shader = new PIXI.Shader({
                        glProgram,
                        resources: {}
                    });
                    
                    mesh = new PIXI.Mesh({geometry, shader});
                    mesh.zIndex = -0.5; // Between background (-1) and text (0)
                    app.stage.addChild(mesh);
                    scriptGraphicsMap.set(scriptId, mesh);
                } else {
                    geometry = mesh.geometry;
                }
                
                // Get or create hitbox and hover box
                let hitBox = scriptHitboxMap.get(scriptId);
                let hoverBox = scriptHoverBoxMap.get(scriptId);
                
                if (!hitBox) {
                    // Create invisible hitbox for interaction
                    hitBox = new PIXI.Graphics();
                    hitBox.eventMode = 'static';
                    hitBox.cursor = 'pointer';
                    hitBox.zIndex = 1;
                    app.stage.addChild(hitBox);
                    scriptHitboxMap.set(scriptId, hitBox);
                    
                    // Create hover box for visual feedback
                    hoverBox = new PIXI.Graphics();
                    hoverBox.zIndex = 1;
                    hoverBox.visible = false;
                    app.stage.addChild(hoverBox);
                    scriptHoverBoxMap.set(scriptId, hoverBox);

                    // Assign unique neon color
                    const neonColor = getRandomNeonColor();
                    scriptNeonColors.set(scriptId, neonColor);
                    
                    // Setup drag and hover handlers
                    let isDragging = false;
                    let dragOffset = { x: 0, y: 0 };
                    
                    hitBox.on('pointerover', () => {
                        hoverBox.visible = true;
                        // Always disable click-through when hovering (allows dragging)
                        ipcRenderer.send('set-click-through-temporarily', false);
                    });
                    
                    hitBox.on('pointerout', () => {
                        if (!isDragging) {
                            hoverBox.visible = false;
                        }
                        // Re-enable click-through when leaving (if click-through mode is on)
                        if (!isDragging) {
                            ipcRenderer.send('restore-click-through-state');
                        }
                    });                    hitBox.on('pointerdown', (event) => {
                        isDragging = true;
                        const position = event.data.global;
                        const bounds = mesh.getBounds();
                        dragOffset.x = position.x - bounds.x;
                        dragOffset.y = position.y - bounds.y;
                        
                        app.stage.on('pointermove', onDragMove);
                    });
                    
                    const onDragMove = (event) => {
                        if (isDragging) {
                            const position = event.data.global;
                            const bounds = mesh.getBounds();
                            
                            const newX = position.x - dragOffset.x;
                            const newY = position.y - dragOffset.y;
                            const deltaX = newX - bounds.x;
                            const deltaY = newY - bounds.y;
                            
                            // Store the offset for this script
                            let offset = scriptPositionOffsets.get(scriptId) || { x: 0, y: 0 };
                            offset.x += deltaX;
                            offset.y += deltaY;
                            scriptPositionOffsets.set(scriptId, offset);
                        }
                    };
                    
                    const onDragEnd = () => {
                        if (isDragging) {
                            app.stage.off('pointermove', onDragMove);
                            isDragging = false;
                            hoverBox.visible = false;
                        }
                    };
                    
                    app.stage.on('pointerup', onDragEnd);
                    app.stage.on('pointerupoutside', onDragEnd);
                }
                
                // Apply position offset
                const offset = scriptPositionOffsets.get(scriptId) || { x: 0, y: 0 };
                
                // Build vertex and color arrays for GPU
                const vertices = [];
                const colors = [];
                const indices = [];
                
                // Track bounds for hitbox
                let minX = Infinity, minY = Infinity;
                let maxX = -Infinity, maxY = -Infinity;
                
                let vertexIndex = 0;
                triangles.forEach(tri => {
                    // Apply offset to triangle coordinates
                    const x1 = tri.x1 + offset.x;
                    const y1 = tri.y1 + offset.y;
                    const x2 = tri.x2 + offset.x;
                    const y2 = tri.y2 + offset.y;
                    const x3 = tri.x3 + offset.x;
                    const y3 = tri.y3 + offset.y;
                    
                    // Add vertices
                    vertices.push(x1, y1, x2, y2, x3, y3);
                    
                    // Convert color to RGBA (0-1 range)
                    let color = tri.color;
                    let alpha = 1.0;
                    
                    if (typeof tri.color === 'object' && tri.color.color !== undefined) {
                        color = tri.color.color;
                        alpha = tri.color.alpha !== undefined ? tri.color.alpha : 1.0;
                    } else if (tri.alpha !== undefined) {
                        alpha = tri.alpha;
                    }
                    
                    const r = ((color >> 16) & 0xFF) / 255;
                    const g = ((color >> 8) & 0xFF) / 255;
                    const b = (color & 0xFF) / 255;
                    
                    // Add color for each vertex (same color for all 3 vertices)
                    for (let i = 0; i < 3; i++) {
                        colors.push(r, g, b, alpha);
                    }
                    
                    // Add indices (each triangle is already 3 vertices)
                    indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
                    vertexIndex += 3;
                    
                    // Track bounds
                    minX = Math.min(minX, x1, x2, x3);
                    minY = Math.min(minY, y1, y2, y3);
                    maxX = Math.max(maxX, x1, x2, x3);
                    maxY = Math.max(maxY, y1, y2, y3);                });                // Update geometry buffers - MeshGeometry direct update
                // Reuse buffers when size matches to avoid garbage collection
                let bufferCache = scriptBufferCache.get(scriptId);
                
                // Check if we can reuse existing buffers
                if (bufferCache && 
                    bufferCache.verticesLength === vertices.length &&
                    bufferCache.colorsLength === colors.length &&
                    bufferCache.indicesLength === indices.length) {
                    
                    // Reuse existing typed arrays - just update values
                    for (let i = 0; i < vertices.length; i++) {
                        bufferCache.verticesArray[i] = vertices[i];
                    }
                    for (let i = 0; i < colors.length; i++) {
                        bufferCache.colorsArray[i] = colors[i];
                    }
                    for (let i = 0; i < indices.length; i++) {
                        bufferCache.indicesArray[i] = indices[i];
                    }
                    
                    geometry.positions = bufferCache.verticesArray;
                    geometry.indices = bufferCache.indicesArray;
                    geometry.getBuffer('aColor').data = bufferCache.colorsArray;
                } else {
                    // Create new typed arrays (first time or size changed)
                    const verticesArray = new Float32Array(vertices);
                    const colorsArray = new Float32Array(colors);
                    const indicesArray = new Uint32Array(indices);
                    
                    geometry.positions = verticesArray;
                    geometry.indices = indicesArray;
                    geometry.getBuffer('aColor').data = colorsArray;
                    
                    // Cache for next frame
                    scriptBufferCache.set(scriptId, {
                        verticesArray,
                        colorsArray,
                        indicesArray,
                        verticesLength: vertices.length,
                        colorsLength: colors.length,
                        indicesLength: indices.length
                    });
                }
                
                // Update hitbox and hover box every frame for smooth interaction
                const padding = 10;
                hitBox.clear();
                hitBox.rect(minX - padding, minY - padding, (maxX - minX) + padding * 2, (maxY - minY) + padding * 2);
                hitBox.fill({ color: 0x000000, alpha: 0.01 }); // Nearly invisible but interactive
                
                hoverBox.clear();
                hoverBox.rect(minX - padding, minY - padding, (maxX - minX) + padding * 2, (maxY - minY) + padding * 2);
                const neonColor = scriptNeonColors.get(scriptId) || 0x00FFFF;
                hoverBox.stroke({ width: 1, color: neonColor });
            },
            animationCallback: null  // Will be set by startAnimation call
        };        // Execute the script with animation context
        const scriptFunc = new Function(
            'rotateX', 'rotateY', 'rotateZ', 'project3D', 'calculateFaceLighting', 'drawTriangles', 'startAnimation',
            code
        );
        
        // Provide startAnimation function that captures the callback
        const startAnimationFunc = (callback) => {
            animationContext.animationCallback = callback;
        };        // Execute script to set up variables and capture animation callback
        scriptFunc(
            animationContext.rotateX,
            animationContext.rotateY,
            animationContext.rotateZ,
            animationContext.project3D,
            animationContext.calculateFaceLighting,
            animationContext.drawTriangles,
            startAnimationFunc
        );
        
        // Now add the captured callback to ticker
        if (animationContext.animationCallback) {
            // Stop existing animation for this script if any
            if (animationCallbacks.has(scriptId)) {
                app.ticker.remove(animationCallbacks.get(scriptId));
            }
            
            // Add to PixiJS ticker
            animationCallbacks.set(scriptId, animationContext.animationCallback);
            app.ticker.add(animationContext.animationCallback);
        }
        
    } catch (error) {
        console.error('Error starting animation:', error);
    }
});

ipcRenderer.on('stop-animation', (event, data) => {
    const { scriptId } = data;
    
    if (animationCallbacks.has(scriptId)) {
        app.ticker.remove(animationCallbacks.get(scriptId));
        animationCallbacks.delete(scriptId);
    }
    
    // Clean up buffer cache
    scriptBufferCache.delete(scriptId);
    
    // Clean up this script's graphics object
    if (scriptGraphicsMap.has(scriptId)) {
        const graphics = scriptGraphicsMap.get(scriptId);
        app.stage.removeChild(graphics);
        graphics.destroy();
        scriptGraphicsMap.delete(scriptId);
    }
    
    // Clean up hitbox
    if (scriptHitboxMap.has(scriptId)) {
        const hitBox = scriptHitboxMap.get(scriptId);
        app.stage.removeChild(hitBox);
        hitBox.destroy();
        scriptHitboxMap.delete(scriptId);
    }
    
    // Clean up hover box
    if (scriptHoverBoxMap.has(scriptId)) {
        const hoverBox = scriptHoverBoxMap.get(scriptId);
        app.stage.removeChild(hoverBox);
        hoverBox.destroy();
        scriptHoverBoxMap.delete(scriptId);
    }// Clean up position offset
    scriptPositionOffsets.delete(scriptId);

    // Return neon color to pool
    if (scriptNeonColors.has(scriptId)) {
        const color = scriptNeonColors.get(scriptId);
        usedNeonColors.delete(color);
        scriptNeonColors.delete(scriptId);
    }
});

// Initialize
(async () => {
    await initPixi();
})();
