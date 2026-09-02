// 增强版FontCracker类 - 集成调试功能
// 基于fontcracker.js扩展，添加console.js的调试功能

class DebugEnhancedFontCracker extends FontCracker {
    constructor(gba, hookAddresses) {
        super(gba, hookAddresses);
        
        // 调试相关属性
        this.debugMode = false;
        this.debugLog = [];
        this.registerSnapshots = [];
        this.memorySnapshots = [];
        this.callStackTraces = [];
        this.hookTriggerCount = 0;
        this.lastHookTime = 0;
        
        // 调试回调
        this.debugCallbacks = {
            onRegisterUpdate: null,
            onMemoryUpdate: null,
            onDebugBreakpoint: null,
            onStepComplete: null
        };
        
        this.log('DebugEnhancedFontCracker initialized', 'info');
    }
    
    // 启用调试模式
    enableDebugMode() {
        this.debugMode = true;
        this.log('调试模式已启用', 'info');
        
        // 设置增强的Hook
        this.setupEnhancedHooks();
    }
    
    // 禁用调试模式
    disableDebugMode() {
        this.debugMode = false;
        this.log('调试模式已禁用', 'info');
    }
    
    // 设置增强的Hook
    setupEnhancedHooks() {
        // 调用父类的Hook设置
        super.setupHooks();
        
        // 添加调试Hook
        this.setupDebugHooks();
    }
    
    // 重写父类的setupHooks方法以调用增强版本
    setupHooks() {
        // 调用父类的Hook设置
        super.setupHooks();
        
        // 如果调试模式启用，添加调试Hook
        if (this.debugMode) {
            this.setupDebugHooks();
        }
    }
    
    // 设置调试Hook
    setupDebugHooks() {
        if (!this.debugMode) return;
        
        this.log('设置调试Hook...', 'info');
        
        // 在关键函数添加调试信息捕获
        Object.entries(this.hookAddresses).forEach(([name, address]) => {
            this.cpuHook.addBreakpoint(address, (pc, cpu) => {
                this.handleDebugHook(name, pc, cpu);
            });
        });
    }
    
    // 处理调试Hook
    handleDebugHook(hookName, pc, cpu) {
        if (!this.debugMode || !this.running) return;
        
        try {
            this.hookTriggerCount++;
            const now = Date.now();
            const timeSinceLastHook = this.lastHookTime > 0 ? now - this.lastHookTime : 0;
            this.lastHookTime = now;
            
            // 捕获调试信息
            const debugInfo = {
                timestamp: now,
                hookName: hookName,
                pc: pc,
                registers: this.getRegisterSnapshot(cpu),
                statusBits: this.getStatusBitsSnapshot(cpu),
                callStack: this.getCallStack(cpu),
                memoryContext: this.getMemoryContext(pc, cpu),
                hookTriggerCount: this.hookTriggerCount,
                timeSinceLastHook: timeSinceLastHook
            };
            
            // 保存调试信息
            this.debugLog.push(debugInfo);
            
            // 限制调试日志大小
            if (this.debugLog.length > 1000) {
                this.debugLog = this.debugLog.slice(-500);
            }
            
            // 触发回调
            if (this.debugCallbacks.onDebugBreakpoint) {
                this.debugCallbacks.onDebugBreakpoint(debugInfo);
            }
            
            // 根据Hook类型处理
            switch (hookName) {
                case 'GetGlyphWidth':
                    this.debugGetGlyphWidth(cpu, debugInfo);
                    break;
                case 'GetStringWidth':
                    this.debugGetStringWidth(cpu, debugInfo);
                    break;
                case 'DrawGlyphTiles':
                    this.debugDrawGlyphTiles(cpu, debugInfo);
                    break;
            }
            
            // 记录到控制台
            console.log(`[DebugHook] ${hookName} @ 0x${pc.toString(16)} - 总触发: ${this.hookTriggerCount}`);
            
        } catch (e) {
            this.log(`调试Hook错误: ${e.message}`, 'error');
            console.error('调试Hook错误:', e);
        }
    }
    
    // 调试GetGlyphWidth
    debugGetGlyphWidth(cpu, debugInfo) {
        const glyph = cpu.gprs[1] & 0xFF;
        const windowPtr = cpu.gprs[0];
        
        // 记录详细的调试信息
        const charDebug = {
            ...debugInfo,
            character: {
                code: glyph,
                char: this.isPrintableASCII(glyph) ? String.fromCharCode(glyph) : '?',
                isASCII: this.isPrintableASCII(glyph),
                isChinese: this.isChineseFirstByte(glyph)
            },
            windowInfo: {
                pointer: windowPtr,
                // 可以添加更多窗口信息
            }
        };
        
        this.registerSnapshots.push(charDebug);
        
        // 如果是中文字符首字节，特别记录
        if (this.isChineseFirstByte(glyph)) {
            this.log(`调试: 可能的中文字符首字节 0x${glyph.toString(16)}`, 'capture');
            this.log(`寄存器状态: R0=0x${cpu.gprs[0].toString(16)}, R1=0x${cpu.gprs[1].toString(16)}`, 'debug');
        }
    }
    
    // 调试GetStringWidth
    debugGetStringWidth(cpu, debugInfo) {
        const stringPtr = cpu.gprs[1];
        
        // 尝试读取字符串内容
        try {
            let text = '';
            let addr = stringPtr;
            let maxLength = 50;
            
            for (let i = 0; i < maxLength; i++) {
                const charCode = this.gba.mmu.read8(addr);
                if (charCode === 0) break;
                
                if (this.isPrintableASCII(charCode)) {
                    text += String.fromCharCode(charCode);
                } else {
                    text += `[0x${charCode.toString(16)}]`;
                }
                addr++;
            }
            
            if (text.length > 0) {
                this.log(`调试: 字符串处理 "${text}"`, 'debug');
            }
        } catch (e) {
            // 忽略读取错误
        }
    }
    
    // 调试DrawGlyphTiles
    debugDrawGlyphTiles(cpu, debugInfo) {
        const glyph = cpu.gprs[1] & 0xFF;
        
        // 记录渲染信息
        const renderInfo = {
            glyphCode: glyph,
            tileInfo: {
                // 可以添加图块信息
            },
            vramContext: this.getVRAMContext()
        };
        
        this.memorySnapshots.push(renderInfo);
    }
    
    // 获取寄存器快照
    getRegisterSnapshot(cpu) {
        const snapshot = {};
        for (let i = 0; i < 16; i++) {
            snapshot[`r${i}`] = cpu.gprs[i];
        }
        
        // 特殊寄存器
        snapshot.pc = cpu.gprs[15];
        snapshot.lr = cpu.gprs[14];
        snapshot.sp = cpu.gprs[13];
        
        return snapshot;
    }
    
    // 获取状态位快照
    getStatusBitsSnapshot(cpu) {
        return {
            N: cpu.cpsrN,
            Z: cpu.cpsrZ,
            C: cpu.cpsrC,
            V: cpu.cpsrV,
            I: cpu.cpsrI,
            T: cpu.execMode,
            mode: this.getCPUModeName(cpu.mode)
        };
    }
    
    // 获取CPU模式名称
    getCPUModeName(mode) {
        const modes = {
            0x10: 'USER',
            0x11: 'FIQ',
            0x12: 'IRQ',
            0x13: 'SVC',
            0x17: 'ABORT',
            0x1B: 'UNDEFINED',
            0x1F: 'SYSTEM'
        };
        return modes[mode] || `UNKNOWN(0x${mode.toString(16)})`;
    }
    
    // 获取调用栈（简化版）
    getCallStack(cpu) {
        // 简化实现：返回最近的几个返回地址
        const stack = [];
        
        // 尝试获取LR寄存器指向的返回地址
        if (cpu.gprs[14]) {
            stack.push(cpu.gprs[14]);
        }
        
        // 可以添加更多调用栈信息
        return stack;
    }
    
    // 获取内存上下文
    getMemoryContext(pc, cpu) {
        const context = {
            pcRegion: this.getMemoryRegion(pc),
            // 可以添加更多内存信息
        };
        
        // 尝试读取指令附近的代码
        try {
            const codeBytes = [];
            for (let i = -4; i <= 4; i++) {
                const addr = pc + i * 4;
                if (addr >= 0) {
                    const byte = this.gba.mmu.read8(addr);
                    codeBytes.push(byte);
                }
            }
            context.codeBytes = codeBytes;
        } catch (e) {
            // 忽略读取错误
        }
        
        return context;
    }
    
    // 获取内存区域
    getMemoryRegion(address) {
        if (address < 0x00004000) return 'BIOS';
        if (address >= 0x02000000 && address < 0x02040000) return 'EWRAM';
        if (address >= 0x03000000 && address < 0x03008000) return 'IWRAM';
        if (address >= 0x04000000 && address < 0x04000400) return 'IO';
        if (address >= 0x05000000 && address < 0x05000400) return 'PALETTE';
        if (address >= 0x06000000 && address < 0x06018000) return 'VRAM';
        if (address >= 0x07000000 && address < 0x07000400) return 'OAM';
        if (address >= 0x08000000 && address < 0x0E000000) return 'ROM';
        if (address >= 0x0E000000 && address < 0x0E010000) return 'SRAM';
        return 'UNKNOWN';
    }
    
    // 获取VRAM上下文
    getVRAMContext() {
        // 简化实现：返回VRAM的基本信息
        try {
            if (this.gba.video && this.gba.video.renderPath) {
                return {
                    vramSize: this.gba.video.renderPath.vram ? this.gba.video.renderPath.vram.length : 0,
                    paletteSize: this.gba.video.renderPath.palette ? this.gba.video.renderPath.palette.length : 0
                };
            }
        } catch (e) {
            // 忽略错误
        }
        return {};
    }
    
    // 检查是否可能是中文字符首字节
    isChineseFirstByte(code) {
        // 基于Pokemon GBA Font Patch的经验值
        // 中文字符首字节通常在0x01-0x1E范围内
        return code >= 0x01 && code <= 0x1E;
    }
    
    // 设置调试回调
    setDebugCallback(type, callback) {
        if (type in this.debugCallbacks) {
            this.debugCallbacks[type] = callback;
        }
    }
    
    // 获取调试信息
    getDebugInfo() {
        // 获取父类的统计信息
        const parentStats = super.getStatistics ? super.getStatistics() : {};
        
        return {
            debugMode: this.debugMode,
            debugLogCount: this.debugLog.length,
            registerSnapshots: this.registerSnapshots.length,
            memorySnapshots: this.memorySnapshots.length,
            hookTriggerCount: this.hookTriggerCount,
            totalCaptured: parentStats.totalCaptured || 0,
            recentDebugLog: this.debugLog.slice(-10)
        };
    }
    
    // 获取详细的字符分析
    getCharacterAnalysis(charCode) {
        const analysis = {
            charCode: charCode,
            hex: `0x${charCode.toString(16)}`,
            isASCII: this.isPrintableASCII(charCode),
            isChineseFirstByte: this.isChineseFirstByte(charCode),
            debugOccurrences: []
        };
        
        // 查找该字符在调试日志中的出现
        this.debugLog.forEach((log, index) => {
            if (log.character && log.character.code === charCode) {
                analysis.debugOccurrences.push({
                    timestamp: log.timestamp,
                    hookName: log.hookName,
                    pc: log.pc,
                    registers: log.registers
                });
            }
        });
        
        return analysis;
    }
    
    // 导出调试数据
    exportDebugData() {
        const data = {
            timestamp: new Date().toISOString(),
            debugInfo: this.getDebugInfo(),
            capturedChars: Array.from(this.capturedChars.values()),
            debugLog: this.debugLog,
            registerSnapshots: this.registerSnapshots,
            memorySnapshots: this.memorySnapshots
        };
        
        return JSON.stringify(data, null, 2);
    }
    
    // 清理调试数据
    clearDebugData() {
        this.debugLog = [];
        this.registerSnapshots = [];
        this.memorySnapshots = [];
        this.callStackTraces = [];
        this.log('调试数据已清理', 'info');
    }
}

// 增强的内存扫描器
class DebugEnhancedMemoryScanner extends GBAMemoryScanner {
    constructor(gba) {
        super(gba);
        this.debugScans = [];
    }
    
    // 增强的文本扫描，包含调试信息
    scanTextWithDebug(startAddress, endAddress, minLength = 2) {
        const results = [];
        const debugInfo = {
            startTime: Date.now(),
            regionsScanned: []
        };
        
        for (let addr = startAddress; addr <= endAddress; addr += 0x1000) {
            try {
                const regionResults = this.scanText(addr, Math.min(addr + 0x1000, endAddress), minLength);
                
                if (regionResults.length > 0) {
                    results.push(...regionResults);
                    debugInfo.regionsScanned.push({
                        start: addr,
                        end: addr + 0x1000,
                        found: regionResults.length
                    });
                }
                
                // 更新进度
                const progress = ((addr - startAddress) / (endAddress - startAddress)) * 100;
                if (Math.floor(progress) % 10 === 0) {
                    console.log(`内存扫描进度: ${progress.toFixed(1)}%`);
                }
                
            } catch (e) {
                // 跳过无效区域
            }
        }
        
        debugInfo.endTime = Date.now();
        debugInfo.duration = debugInfo.endTime - debugInfo.startTime;
        debugInfo.totalFound = results.length;
        
        this.debugScans.push(debugInfo);
        
        return {
            results: results,
            debugInfo: debugInfo
        };
    }
    
    // 扫描字体相关区域
    scanFontRelatedRegions() {
        const regions = [
            { start: 0x08000000, end: 0x08800000, name: 'ROM区域', description: '游戏代码和字体数据可能存储区域' },
            { start: 0x02000000, end: 0x02040000, name: '工作RAM', description: '运行时字符缓存可能区域' },
            { start: 0x06000000, end: 0x06018000, name: 'VRAM区域', description: '显示字符数据存储区域' },
            { start: 0x03000000, end: 0x03008000, name: '内部RAM', description: '高速字符处理可能区域' }
        ];
        
        const allResults = [];
        const regionReports = [];
        
        regions.forEach(region => {
            console.log(`扫描${region.name}: 0x${region.start.toString(16)}-0x${region.end.toString(16)}`);
            
            const scanResult = this.scanTextWithDebug(region.start, region.end, 2);
            
            if (scanResult.results.length > 0) {
                regionReports.push({
                    region: region.name,
                    found: scanResult.results.length,
                    description: region.description,
                    sampleTexts: scanResult.results.slice(0, 3).map(r => r.text)
                });
                
                // 标记结果来源区域
                scanResult.results.forEach(result => {
                    result.sourceRegion = region.name;
                });
                
                allResults.push(...scanResult.results);
            }
        });
        
        return {
            totalResults: allResults.length,
            regionReports: regionReports,
            allResults: allResults
        };
    }
}

// 调试工具类
class FontCrackerDebugTools {
    constructor(gba) {
        this.gba = gba;
    }
    
    // 获取实时寄存器显示HTML
    getRegistersHTML(cpu) {
        if (!cpu) return '';
        
        let html = '<div class="debug-registers">';
        html += '<h4>通用寄存器 (GPRs)</h4>';
        html += '<div class="register-grid">';
        
        for (let i = 0; i < 16; i++) {
            const value = cpu.gprs[i];
            const hexValue = value.toString(16).padStart(8, '0').toUpperCase();
            html += `<div class="register-item">
                <span class="register-name">R${i}</span>
                <span class="register-value">0x${hexValue}</span>
            </div>`;
        }
        
        html += '</div>';
        
        // 状态位
        html += '<h4>状态位 (CPSR)</h4>';
        html += '<div class="status-bits">';
        html += `<div class="status-item"><span class="status-name">N</span><span class="status-value ${cpu.cpsrN ? 'active' : 'inactive'}">${cpu.cpsrN ? '1' : '0'}</span></div>`;
        html += `<div class="status-item"><span class="status-name">Z</span><span class="status-value ${cpu.cpsrZ ? 'active' : 'inactive'}">${cpu.cpsrZ ? '1' : '0'}</span></div>`;
        html += `<div class="status-item"><span class="status-name">C</span><span class="status-value ${cpu.cpsrC ? 'active' : 'inactive'}">${cpu.cpsrC ? '1' : '0'}</span></div>`;
        html += `<div class="status-item"><span class="status-name">V</span><span class="status-value ${cpu.cpsrV ? 'active' : 'inactive'}">${cpu.cpsrV ? '1' : '0'}</span></div>`;
        html += `<div class="status-item"><span class="status-name">I</span><span class="status-value ${cpu.cpsrI ? 'active' : 'inactive'}">${cpu.cpsrI ? '1' : '0'}</span></div>`;
        html += `<div class="status-item"><span class="status-name">T</span><span class="status-value ${cpu.execMode ? 'active' : 'inactive'}">${cpu.execMode ? 'Thumb' : 'ARM'}</span></div>`;
        
        html += '</div>';
        html += '</div>';
        
        return html;
    }
    
    // 获取内存查看HTML（简化版）
    getMemoryViewHTML(address, length = 256) {
        let html = '<div class="debug-memory">';
        html += `<h4>内存查看: 0x${address.toString(16)}</h4>`;
        html += '<div class="memory-content">';
        
        try {
            for (let i = 0; i < length; i += 16) {
                const lineAddr = address + i;
                const hexBytes = [];
                const asciiChars = [];
                
                for (let j = 0; j < 16; j++) {
                    const byteAddr = lineAddr + j;
                    if (byteAddr < address + length) {
                        try {
                            const byte = this.gba.mmu.read8(byteAddr);
                            hexBytes.push(byte.toString(16).padStart(2, '0').toUpperCase());
                            asciiChars.push(byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.');
                        } catch (e) {
                            hexBytes.push('??');
                            asciiChars.push('?');
                        }
                    }
                }
                
                html += `<div class="memory-line">
                    <span class="memory-addr">0x${lineAddr.toString(16).padStart(8, '0')}:</span>
                    <span class="memory-hex">${hexBytes.join(' ')}</span>
                    <span class="memory-ascii">${asciiChars.join('')}</span>
                </div>`;
            }
        } catch (e) {
            html += `<div class="memory-error">无法读取内存: ${e.message}</div>`;
        }
        
        html += '</div>';
        html += '</div>';
        
        return html;
    }
    
    // 获取Hook点状态
    getHookStatusHTML(hookAddresses, cracker) {
        let html = '<div class="debug-hooks">';
        html += '<h4>Hook点状态</h4>';
        
        Object.entries(hookAddresses).forEach(([name, address]) => {
            const isActive = cracker && cracker.cpuHook.hasBreakpoint(address);
            html += `<div class="hook-item ${isActive ? 'active' : 'inactive'}">
                <span class="hook-name">${name}</span>
                <span class="hook-address">0x${address.toString(16)}</span>
                <span class="hook-status">${isActive ? '✓ 激活' : '✗ 未激活'}</span>
            </div>`;
        });
        
        html += '</div>';
        return html;
    }
}