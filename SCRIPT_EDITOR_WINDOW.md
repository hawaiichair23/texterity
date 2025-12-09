# Script Editor Window Feature

## What Was Added

### New Files Created:
1. **script-editor.html** - Full-screen script editor UI
2. **script-editor.js** - Script editor logic and Monaco integration

### Modified Files:

#### main.js
- Added `scriptEditorWindows` object to track editor windows
- Added `createScriptEditorWindow()` function
- Added 6 IPC handlers for script editor communication:
  - `open-script-editor` - Opens editor window
  - `script-editor-update` - Syncs code changes back to control
  - `script-editor-run` - Runs script from editor
  - `script-editor-stop` - Stops script from editor
  - `script-console-to-editor` - Forwards console logs
  - `script-error-to-editor` - Forwards errors

#### control.js
- Added `expandScript()` function
- Added "⤢ Expand" button to each script
- Added 3 IPC listeners for syncing:
  - `script-updated-from-editor` - Updates control window when editing in big window
  - `run-script-from-editor` - Runs script from editor window
  - `stop-script-from-editor` - Stops script from editor window

## Features

### Script Editor Window
✅ **Large Monaco Editor** - 1000x700 resizable window  
✅ **Syntax Highlighting** - Full JavaScript coloring  
✅ **Auto-Save** - Saves 500ms after you stop typing  
✅ **Keyboard Shortcuts**:
  - `Ctrl+S` / `Cmd+S` - Manual save
  - `F5` - Run script
  - `Shift+F5` - Stop script
  - `Ctrl+Shift+I` - Dev tools

### UI Components
- **Header** - Script name input + action buttons
- **Monaco Editor** - Full-featured code editor with minimap
- **Console Panel** - Toggle-able console output (click "Console" button)
- **Status Bar** - Shows script state (Ready/Running/Stopped) + cursor position

### Two-Way Sync
- ✅ Edit in big window → Updates control window automatically
- ✅ Edit in control window → No conflict (each window independent)
- ✅ Run/Stop from either window
- ✅ Multiple scripts can have editor windows open simultaneously

## How to Use

1. **Open Script Editor**
   - Go to Scripts tab
   - Click "⤢ Expand" button on any script
   - New window opens with that script

2. **Edit Code**
   - Type in the big Monaco editor
   - Changes auto-save after 500ms
   - Or press `Ctrl+S` to save manually

3. **Run/Stop Scripts**
   - Click "▶ Run" or press `F5`
   - Click "⏹ Stop" or press `Shift+F5`
   - Status bar shows current state

4. **View Console** (Future Feature)
   - Click "Console" button to toggle
   - See script output and errors
   - Click "Clear" to reset

5. **Close Window**
   - Changes are automatically saved
   - Window can be reopened anytime
   - Multiple scripts can have editors open

## Window Management

- **Reopen Same Script**: If you click Expand again, it focuses the existing window (no duplicates)
- **Multiple Scripts**: Each script can have its own editor window open
- **Memory Management**: Windows are cleaned up on close
- **Persistence**: Script changes survive window close

## Next Steps (Optional)

1. **Console Integration** - Wire up actual console.log() output
2. **Error Highlighting** - Show errors inline in Monaco
3. **Snippets** - Add code snippets for common Texterity functions
4. **API Autocomplete** - IntelliSense for createTextObject(), etc.
5. **Themes** - Multiple color themes
6. **Find/Replace** - Already built into Monaco (Ctrl+F / Ctrl+H)

## Testing

1. Restart Texterity: `npm start`
2. Go to Scripts tab
3. Click "⤢ Expand" on a script
4. New window should open!
5. Try editing code - it should auto-save
6. Try `Ctrl+S`, `F5`, `Shift+F5` shortcuts
7. Close window and reopen - changes should persist

## Troubleshooting

**Window doesn't open?**
- Check console for errors
- Verify script-editor.html and script-editor.js exist

**Monaco not loading?**
- Check Monaco is installed: `npm list monaco-editor`
- Check browser console in editor window (Ctrl+Shift+I)

**Changes not syncing?**
- Check IPC handlers in main.js
- Verify control.js has IPC listeners

**Multiple windows for same script?**
- Should focus existing window instead
- Check scriptEditorWindows tracking in main.js
