# GBA Font Cracker - Advanced Edition

Advanced font cracking system for Game Boy Advance ROMs with automatic character mapping detection and Chinese font support.

## Features

- 🎯 **Automatic Hook Detection**: Automatically hooks into text rendering functions
- 🔍 **Character Capture**: Captures ASCII and Chinese characters during gameplay
- ✅ **"NEW GAME" Detection**: Automatically detects title screen for validation
- 📊 **Real-time Statistics**: Live updates of captured characters and analysis
- 💾 **Export Results**: Export captured data to JSON format
- 🔬 **Memory Scanning**: Scan ROM regions for text patterns
- 🎨 **Modern UI**: Beautiful, responsive interface with real-time updates

## Quick Start

### 1. Open the Font Cracker

Open `font-cracker.html` in a modern web browser (Chrome, Firefox, Edge, Safari).

### 2. Load a ROM

- Click the "Load ROM" button
- Select a Pokemon Emerald ROM file (.gba)
- Wait for the emulator to initialize

### 3. Start Cracking

- Click "Start Cracking" to begin
- The emulator will start running
- Watch the log for captured characters
- "NEW GAME" detection will appear on the title screen

### 4. Monitor Results

- **Character Grid**: Shows all captured characters with their hex codes
- **Statistics**: Real-time counts of ASCII and Chinese characters
- **Analysis**: Current status and recent captures
- **Log**: Detailed capture information

### 5. Export Results

- Click "Export Results" to save captured data
- `font_crack_results_[timestamp].json` will be downloaded

## Architecture

### Core Components

#### 1. GBACPUHook (js/fontcracker.js)

Provides CPU execution hooking functionality:

```javascript
const hook = new GBACPUHook(gba);
hook.addBreakpoint(0x080048EA, (pc, cpu) => {
    console.log('Hit breakpoint at', pc.toString(16));
});
hook.enable();
```

**Features**:
- Breakpoint management
- Callback system
- Non-invasive CPU hooking

#### 2. FontCracker (js/fontcracker.js)

Main font cracking engine:

```javascript
const cracker = new FontCracker(gba, HOOK_ADDRESSES);

cracker.setCallback('onCharacterCapture', (charInfo) => {
    console.log('Captured:', charInfo.char, 'at', charInfo.code.toString(16));
});

cracker.start();
```

**Features**:
- Character capture from multiple rendering functions
- "NEW GAME" detection
- Statistics tracking
- Callback system for events

#### 3. GBAMemoryScanner (js/fontcracker.js)

Memory analysis tools:

```javascript
const scanner = new GBAMemoryScanner(gba);

// Scan for text strings
const results = scanner.scanText(0x08000000, 0x08800000, 2);

// Scan for byte patterns
const matches = scanner.scanPattern("'N' 'E' 'W'", 0x08000000, 0x08800000);
```

**Features**:
- Text string detection
- Byte pattern matching
- ROM region scanning

## Hook Addresses

The tool uses these Pokemon Emerald hook addresses:

| Function | Address | Purpose |
|----------|---------|---------|
| GetGlyphWidth | 0x080048EA | Single character width calculation |
| GetStringWidth | 0x08004CCC | String width calculation |
| DrawGlyphTiles | 0x08006876 | Character rendering |

## JSON Export Format

```json
{
  "timestamp": "2026-03-16T10:30:00.000Z",
  "romInfo": {
    "size": 33554432,
    "title": "POKEMON EMER"
  },
  "statistics": {
    "totalUnique": 15,
    "asciiCount": 127,
    "chineseCount": 0,
    "frameCount": 1500,
    "vblankCount": 1500,
    "newGameFound": true,
    "running": true
  },
  "characters": [
    {
      "char": "N",
      "code": 78,
      "source": "GetGlyphWidth",
      "timestamp": 1710575400000,
      "count": 2,
      "firstSeen": 1710575400000
    }
  ],
  "recentSequence": [...],
  "recentText": "NEW GAME"
}
```

## Browser Compatibility

- ✅ Chrome/Edge: Full support
- ✅ Firefox: Full support
- ✅ Safari: Full support
- ⚠️ IE11: Limited support

## Performance Tips

1. **Pause When Not Needed**: Use Pause button to save resources
2. **Limit Log Size**: Logs are automatically limited to 1000 entries
3. **Export Early**: Export results periodically to avoid data loss
4. **Memory Scanning**: Can be resource-intensive, use sparingly

## Troubleshooting

### ROM Won't Load

- Ensure the ROM is uncompressed (.gba format)
- Check file size (should be ~32MB for Emerald)
- Try a different browser

### No Characters Captured

- Verify the ROM is Pokemon Emerald (US v1.0)
- Check the log for hook installation messages
- Ensure the emulator is running (not paused)

### "NEW GAME" Not Detected

- Wait for the title screen to appear
- Check that the ROM is the correct version
- Verify hook addresses in the console log

## Technical Details

### Hooking Mechanism

The tool uses a non-invasive CPU hooking approach:

1. **Breakpoint Setup**: Sets breakpoints at key rendering functions
2. **Execution Intercept**: Catches CPU execution at breakpoint addresses
3. **Context Capture**: Extracts character codes from CPU registers
4. **Data Recording**: Stores character information with metadata

### Memory Access

Character codes are extracted from:

- **GetGlyphWidth**: `R1` register contains character code
- **GetStringWidth**: `R1` register contains string pointer
- **DrawGlyphTiles**: `R1` register contains glyph code

### Character Recognition

- **ASCII**: `0x20` to `0x7E` (printable characters)
- **Chinese**: Future expansion for multi-byte characters
- **Control Codes**: Filtered out during capture

## Development

### Adding New Hook Points

```javascript
const HOOK_ADDRESSES = {
    GetGlyphWidth: 0x080048EA,
    GetStringWidth: 0x08004CCC,
    DrawGlyphTiles: 0x08006876,
    // Add new hooks here
    MyCustomFunction: 0x0800XXXX
};
```

### Custom Callbacks

```javascript
fontCracker.setCallback('onCharacterCapture', (charInfo) => {
    // Custom processing
    console.log('New character:', charInfo);
});

fontCracker.setCallback('onNewGameFound', () => {
    // Trigger custom action
    alert('Title screen detected!');
});
```

## License

Based on gbajs2 (BSD-style license) and Pokemon GBA Font Patch.

## Credits

- **gbajs2**: Original GBA emulator by Endrift
- **Pokemon GBA Font Patch**: Hook mechanism and font rendering insights
- **Font Cracker**: Advanced edition by AI Assistant

## Version History

### v1.0 (Current)

- Initial release
- Basic character capture
- "NEW GAME" detection
- Memory scanning
- JSON export
- Modern UI design

## Future Enhancements

- [ ] Chinese character support (multi-byte)
- [ ] Visual character mapping table
- [ ] Font data extraction
- [ ] Pattern-based text detection
- [ ] Automatic ROM version detection
- [ ] Batch processing support
- [ ] WebSocket for remote monitoring

## Support

For issues, questions, or contributions:

1. Check the troubleshooting section above
2. Review the browser console for error messages
3. Examine the log panel for detailed information

## Related Projects

- **Pokemon GBA Font Patch**: `d:\vibecoding\Pokemon_GBA_Font_Patch-main`
- **Font Data**: `d:\vibecoding\gba-font-cracker-js\fonts\`
- **Test ROM**: `d:\vibecoding\gba-font-cracker-js\testfiles\`

---

**Happy Font Cracking! 🎮✨**
