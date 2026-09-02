class GBACPUHook {
    constructor(gba) {
        this.gba = gba;
        this.breakpoints = new Map();
        this.hooks = new Map();
        this.originalStep = null;
        this.enabled = false;
    }
    
    enable() {
        if (this.enabled) return;
        
        if (this.gba && this.gba.cpu && this.gba.cpu.step) {
            this.originalStep = this.gba.cpu.step.bind(this.gba.cpu);
            
            const self = this;
            this.gba.cpu.step = function() {
                const pc = this.gprs[15];
                
                // Check breakpoints
                if (self.breakpoints.has(pc)) {
                    self.breakpoints.get(pc).forEach(callback => {
                        callback.call(self, pc, this);
                    });
                }
                
                // Execute original step
                return self.originalStep();
            };
            
            this.enabled = true;
        }
    }
    
    disable() {
        if (!this.enabled) return;
        
        if (this.originalStep && this.gba && this.gba.cpu) {
            this.gba.cpu.step = this.originalStep;
            this.originalStep = null;
            this.enabled = false;
        }
    }
    
    addBreakpoint(address, callback) {
        if (!this.breakpoints.has(address)) {
            this.breakpoints.set(address, []);
        }
        this.breakpoints.get(address).push(callback);
    }
    
    removeBreakpoint(address, callback) {
        if (this.breakpoints.has(address)) {
            const callbacks = this.breakpoints.get(address);
            const index = callbacks.indexOf(callback);
            if (index > -1) {
                callbacks.splice(index, 1);
            }
            
            if (callbacks.length === 0) {
                this.breakpoints.delete(address);
            }
        }
    }
    
    clearBreakpoints() {
        this.breakpoints.clear();
    }
    
    hasBreakpoint(address) {
        return this.breakpoints.has(address);
    }
    
    getBreakpointCount() {
        return this.breakpoints.size;
    }
}


class FontCracker {
    constructor(gba, hookAddresses) {
        this.gba = gba;
        this.hookAddresses = hookAddresses;
        this.cpuHook = new GBACPUHook(gba);
        
        this.capturedChars = new Map();
        this.capturedSequence = [];
        this.asciiCount = 0;
        this.chineseCount = 0;
        this.frameCount = 0;
        this.vblankCount = 0;
        this.newGameFound = false;
        this.running = false;
        this.targetText = "NEW GAME";
        
        this.callbacks = {
            onCharacterCapture: null,
            onNewGameFound: null,
            onProgress: null
        };
        
        this.log('FontCracker initialized', 'info');
    }
    
    setCallback(type, callback) {
        if (type in this.callbacks) {
            this.callbacks[type] = callback;
        }
    }
    
    start() {
        if (this.running) {
            this.log('Font cracker already running', 'warning');
            return;
        }
        
        this.running = true;
        this.log('Starting font cracking...', 'info');
        
        this.setupHooks();
        this.cpuHook.enable();
        
        this.log('Hooks installed and CPU hook enabled', 'success');
    }
    
    pause() {
        this.running = !this.running;
        this.log(this.running ? 'Resuming...' : 'Paused', 'info');
    }
    
    stop() {
        this.running = false;
        this.cpuHook.disable();
        this.log('Font cracker stopped', 'info');
    }
    
    reset() {
        this.stop();
        this.capturedChars.clear();
        this.capturedSequence = [];
        this.asciiCount = 0;
        this.chineseCount = 0;
        this.frameCount = 0;
        this.vblankCount = 0;
        this.newGameFound = false;
        this.log('Font cracker reset', 'info');
    }
    
    setupHooks() {
        this.log('Setting up hooks at critical addresses:', 'info');
        
        Object.entries(this.hookAddresses).forEach(([name, address]) => {
            this.log(`- ${name}: 0x${address.toString(16)}`, 'info');
            
            this.cpuHook.addBreakpoint(address, (pc, cpu) => {
                this.handleHook(name, pc, cpu);
            });
        });
        
        // Also hook VBlank for frame counting
        this.cpuHook.addBreakpoint(0x08000000, (pc, cpu) => {
            // This will be called frequently, but we'll filter in handleHook
        });
    }
    
    handleHook(hookName, pc, cpu) {
        if (!this.running) {
            console.log(`[Hook] ${hookName} @ 0x${pc.toString(16)} - FontCracker未运行`);
            return;
        }
        
        try {
            console.log(`[Hook] ${hookName} @ 0x${pc.toString(16)} - R1=0x${cpu.gprs[1].toString(16)}`);
            
            switch (hookName) {
                case 'GetGlyphWidth':
                    this.handleGetGlyphWidth(cpu);
                    break;
                case 'GetStringWidth':
                    this.handleGetStringWidth(cpu);
                    break;
                case 'DrawGlyphTiles':
                    this.handleDrawGlyphTiles(cpu);
                    break;
            }
        } catch (e) {
            console.error(`[Hook] ${hookName} 错误:`, e);
        }
    }
    
    handleGetGlyphWidth(cpu) {
        const windowPtr = cpu.gprs[0];
        const glyph = cpu.gprs[1] & 0xFF;
        
        console.log(`[GetGlyphWidth] 字符编码: 0x${glyph.toString(16)}`);
        
        if (this.isPrintableASCII(glyph)) {
            const char = String.fromCharCode(glyph);
            console.log(`[GetGlyphWidth] 捕获ASCII: '${char}' (0x${glyph.toString(16)})`);
            this.captureCharacter(char, glyph, 'GetGlyphWidth');
        } else if (glyph > 0) {
            console.log(`[GetGlyphWidth] 非ASCII字符: 0x${glyph.toString(16)}`);
        }
    }
    
    handleGetStringWidth(cpu) {
        const windowPtr = cpu.gprs[0];
        const stringPtr = cpu.gprs[1];
        
        // Read string from memory
        let charIndex = 0;
        while (charIndex < 256) { // Limit to prevent infinite loops
            try {
                const charCode = this.gba.mmu.read8(stringPtr + charIndex);
                if (charCode === 0) break;
                
                if (this.isPrintableASCII(charCode)) {
                    const char = String.fromCharCode(charCode);
                    this.captureCharacter(char, charCode, 'GetStringWidth');
                }
                
                charIndex++;
            } catch (e) {
                break;
            }
        }
    }
    
    handleDrawGlyphTiles(cpu) {
        const glyph = cpu.gprs[1] & 0xFF;
        
        if (this.isPrintableASCII(glyph)) {
            const char = String.fromCharCode(glyph);
            this.captureCharacter(char, glyph, 'DrawGlyphTiles');
        }
    }
    
    captureCharacter(char, code, source) {
        const charInfo = {
            char: char,
            code: code,
            source: source,
            timestamp: Date.now(),
            count: this.capturedChars.has(code) ? this.capturedChars.get(code).count + 1 : 1,
            firstSeen: this.capturedChars.has(code) ? this.capturedChars.get(code).firstSeen : Date.now()
        };
        
        this.capturedChars.set(code, charInfo);
        this.capturedSequence.push(charInfo);
        
        if (this.isASCII(char)) {
            this.asciiCount++;
        } else {
            this.chineseCount++;
        }
        
        // Trigger callback
        if (this.callbacks.onCharacterCapture) {
            this.callbacks.onCharacterCapture(charInfo);
        }
        
        // Check for "NEW GAME"
        this.checkNewGame();
    }
    
    checkNewGame() {
        const recent = this.capturedSequence.slice(-50).map(c => c.char).join('');
        if (recent.includes(this.targetText)) {
            if (!this.newGameFound) {
                this.newGameFound = true;
                this.log(`✓ "NEW GAME" detected!`, 'success');
                
                if (this.callbacks.onNewGameFound) {
                    this.callbacks.onNewGameFound();
                }
            }
        }
    }
    
    isPrintableASCII(code) {
        return code >= 0x20 && code <= 0x7E;
    }
    
    isASCII(char) {
        return char.charCodeAt(0) >= 0x20 && char.charCodeAt(0) <= 0x7E;
    }
    
    incrementFrameCount() {
        this.frameCount++;
        
        if (this.callbacks.onProgress) {
            this.callbacks.onProgress({
                frameCount: this.frameCount,
                capturedChars: this.capturedChars.size,
                newGameFound: this.newGameFound
            });
        }
    }
    
    getCapturedCharacters() {
        return Array.from(this.capturedChars.values());
    }
    
    getCharacterSequence(length = 100) {
        return this.capturedSequence.slice(-length);
    }
    
    getRecentText(length = 50) {
        return this.capturedSequence.slice(-length).map(c => c.char).join('');
    }
    
    getStatistics() {
        // 计算捕获速率（每分钟捕获的字符数）
        let captureRate = '0';
        if (this.capturedSequence.length > 1) {
            const firstTime = this.capturedSequence[0]?.timestamp || Date.now();
            const lastTime = this.capturedSequence[this.capturedSequence.length - 1]?.timestamp || Date.now();
            const timeDiff = Math.max(1, lastTime - firstTime) / 1000 / 60; // 转换为分钟
            const totalCaptured = this.capturedSequence.length;
            captureRate = Math.round(totalCaptured / timeDiff).toString();
        }
        
        return {
            totalUnique: this.capturedChars.size,
            asciiCount: this.asciiCount,
            chineseCount: this.chineseCount,
            frameCount: this.frameCount,
            vblankCount: this.vblankCount,
            newGameFound: this.newGameFound,
            running: this.running,
            captureRate: captureRate,
            totalCaptured: this.capturedSequence.length
        };
    }
    
    getAnalysis() {
        let analysis = '';
        
        if (this.capturedChars.size === 0) {
            analysis = 'No characters captured yet. Start the emulator to capture text rendering.';
        } else {
            analysis += `Total unique characters: ${this.capturedChars.size}\n`;
            analysis += `ASCII characters: ${this.asciiCount}\n`;
            analysis += `Chinese characters: ${this.chineseCount}\n`;
            analysis += `"NEW GAME" detected: ${this.newGameFound ? 'Yes ✓' : 'No'}\n\n`;
            
            if (this.newGameFound) {
                analysis += '✓ Title screen detected successfully!\n';
                analysis += 'Font cracking progressing normally.\n';
            } else {
                analysis += 'Waiting for title screen...\n';
            }
            
            // Show most recent captures
            const recent = this.getRecentText(30);
            analysis += `\nRecent captures: "${recent}"`;
        }
        
        return analysis;
    }
    
    exportResults() {
        const results = {
            timestamp: new Date().toISOString(),
            statistics: this.getStatistics(),
            characters: this.getCapturedCharacters(),
            sequence: this.capturedSequence.slice(-100)
        };
        
        return JSON.stringify(results, null, 2);
    }
    
    log(message, type = 'info') {
        if (this.callbacks.onLog) {
            this.callbacks.onLog(message, type);
        } else {
            console.log(`[FontCracker ${type}] ${message}`);
        }
    }
}


class GBAMemoryScanner {
    constructor(gba) {
        this.gba = gba;
        this.scanResults = [];
    }
    
    scanText(startAddress, endAddress, minLength = 2) {
        const results = [];
        
        for (let addr = startAddress; addr <= endAddress; addr++) {
            try {
                const char = this.gba.mmu.read8(addr);
                
                if (this.isPrintable(char)) {
                    let text = '';
                    let textAddr = addr;
                    
                    while (this.isPrintable(char) && text.length < 255) {
                        text += String.fromCharCode(char);
                        textAddr++;
                        char = this.gba.mmu.read8(textAddr);
                    }
                    
                    if (text.length >= minLength) {
                        results.push({
                            address: addr,
                            text: text,
                            length: text.length
                        });
                    }
                    
                    addr = textAddr;
                }
            } catch (e) {
                // Skip invalid addresses
            }
        }
        
        this.scanResults = results;
        return results;
    }
    
    isPrintable(code) {
        return code >= 0x20 && code <= 0x7E;
    }
    
    scanPattern(pattern, startAddress, endAddress) {
        const results = [];
        const patternBytes = this.patternToBytes(pattern);
        
        if (patternBytes.length === 0) return results;
        
        for (let addr = startAddress; addr <= endAddress - patternBytes.length + 1; addr++) {
            let match = true;
            
            for (let i = 0; i < patternBytes.length; i++) {
                try {
                    const byte = this.gba.mmu.read8(addr + i);
                    if (byte !== patternBytes[i]) {
                        match = false;
                        break;
                    }
                } catch (e) {
                    match = false;
                    break;
                }
            }
            
            if (match) {
                results.push(addr);
            }
        }
        
        return results;
    }
    
    patternToBytes(pattern) {
        const bytes = [];
        const parts = pattern.split(/\s+/);
        
        for (const part of parts) {
            if (part.startsWith("'")) {
                // Character literal
                if (part.length >= 3 && part.endsWith("'")) {
                    bytes.push(part.charCodeAt(1));
                }
            } else if (part.startsWith('0x') || part.startsWith('0X')) {
                // Hex literal
                bytes.push(parseInt(part, 16));
            } else {
                // Try to parse as decimal
                const value = parseInt(part, 10);
                if (!isNaN(value) && value >= 0 && value <= 255) {
                    bytes.push(value);
                }
            }
        }
        
        return bytes;
    }
}


class FontDataTable {
    constructor(codeTablePath) {
        this.codeTable = new Map();
        this.reverseCodeTable = new Map();
        this.loaded = false;
    }
    
    async load(codeTablePath) {
        try {
            const response = await fetch(codeTablePath);
            const text = await response.text();
            const lines = text.split('\n');
            
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#')) {
                    const parts = trimmed.split('=');
                    if (parts.length === 2) {
                        const codeStr = parts[0].trim();
                        const char = parts[1].trim();
                        
                        let code;
                        if (codeStr.startsWith('0x') || codeStr.startsWith('0X')) {
                            code = parseInt(codeStr, 16);
                        } else {
                            code = parseInt(codeStr, 10);
                        }
                        
                        this.codeTable.set(code, char);
                        this.reverseCodeTable.set(char, code);
                    }
                }
            }
            
            this.loaded = true;
            console.log(`Loaded ${this.codeTable.size} code table entries`);
            return true;
        } catch (error) {
            console.error('Failed to load code table:', error);
            return false;
        }
    }
    
    getCharacter(code) {
        return this.codeTable.get(code);
    }
    
    getCode(character) {
        return this.reverseCodeTable.get(character);
    }
    
    isLoaded() {
        return this.loaded;
    }
    
    getSize() {
        return this.codeTable.size;
    }
}
