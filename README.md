
![Animationletters2](https://github.com/user-attachments/assets/36bed92d-9ee5-429f-9df3-e2cf7a788d95)

# Texterity

A realtime animated text overlay engine for streamers, built with Electron and PixiJS.

Texterity lets you place animated, fully customizable text objects over your stream canvas, controlled in real time from a separate panel without interrupting your layout. The overlay window can be made completely invisible and click-through over the desktop and any apps underneath. 

## Text Objects

Texterity uses text objects. These objects can be independently modified either in the overlay directly, or in the control panel. They can be dragged anywhere on screen or resized in real time. You can click directly on any text object in the overlay to highlight its corresponding panel in the control UI. Text objects are also exposed to the API for programmatic control. 

In click-through mode, text objects temporarily suspend click-through only when hovered, letting you grab and reposition them freely while using the desktop.

## Scripting

The scripting engine exposes an API surface to every text object on the overlay. From a script you can set text content and animate individual characters by adjusting their X/Y offsets, scale, color, and timing, either manually or through built-in helpers like `waveEffect`, `spiralInEffect`, and `fadeIn`. Characters are individually controllable while the word's font, size, and kerning are preserved so effects stay typographically clean. The editor includes full syntax highlighting, autocomplete, and an integrated console.


<img width="1664" height="720" alt="ev" src="https://github.com/user-attachments/assets/4fcc47ca-47e5-4d89-b5d9-dfce2e6dcab2" />

## Features

- **Multiple text objects** — create, position, and style independently
- **Character-level animation** — hop, fade, delay, and variation controls per object
- **Animation presets** — save and reuse animation configurations across text objects
- **Live font control** — load local fonts or Google Fonts, change size and color in real time
- **Scripting engine** — write JavaScript scripts with a full API to control text, character offsets, colors, scale, and timing programmatically
- **Monaco script editor** — full VS Code-style editor with syntax highlighting for writing scripts
- **File watch mode** — point a text object at a `.txt` file and it updates automatically when the file changes
- **Project save/load** — full project state serialization with autosave
- **Click-through overlay** — the overlay is invisible and non-interactive; individual text objects intercept mouse events only on hover, making them feel like floating desktop items you can grab and move at any time
- **Secure API key storage** — keys encrypted via OS keychain

## 3D Rendering

Texterity includes a software 3D rendering pipeline built directly on top of PixiJS's triangle drawing primitives. Texterity can load `.obj` files, parse vertex and face data, and render the geometry onto the overlay from scratch, including backface culling and surface normal calculations for per-face lighting. Triangles are submitted in batched draw calls for performance. The classic Utah Teapot is included in **obj_files/** as a test model.


## Architecture

Texterity runs as two Electron windows communicating over IPC:

- **Control panel** — the UI for managing text objects, animations, scripts, and settings
- **Overlay** — a transparent frameless window rendered entirely with PixiJS, sitting over your desktop


## Roadmap

**Stream event integration** — Texterity will connect directly to streaming platform events (subscriptions, donations, chat triggers, raids) so text objects and scripts can react without any middleware.

**GPU pipeline** — the rendering layer is being moved toward a fully GPU-driven pipeline for high framerate animations at scale.


## Tech Stack

- [Electron](https://www.electronjs.org/)
- [PixiJS](https://pixijs.com/) — WebGL/Canvas 2D renderer
- [Monaco Editor](https://microsoft.github.io/monaco-editor/) — script editing
- [GSAP](https://greensock.com/gsap/) — character animation tweening
- [Chokidar](https://github.com/paulmillr/chokidar) — file watching
- [opentype.js](https://opentype.js.org/) — font parsing
