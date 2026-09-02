// 字库扫描引擎 - 专为字库破解设计
// 核心功能：分析GBA ROM中的字符编码、字体结构、文本位置

class FontScanEngine {
    constructor(gba) {
        this.gba = gba;
        this.mmu = gba.mmu;
        
        // 扫描结果
        this.scanResults = {
            // 编码分析
            encodings: {
                asciiRange: { start: 0, end: 0, confidence: 0 },
                chineseRange: { start: 0, end: 0, confidence: 0 },
                symbolRange: { start: 0, end: 0, confidence: 0 }
            },
            
            // 文本区域
            textRegions: [],
            
            // 字体数据结构
            fontStructures: [],
            
            // 关键字符串
            keyStrings: [],
            
            // 捕获字符
            capturedChars: new Map(),
            
            // 分析统计
            statistics: {
                totalMemoryScanned: 0,
                textPatternsFound: 0,
                fontStructuresDetected: 0,
                encodingPatterns: []
            }
        };
        
        // 已知Pokemon游戏的字符编码特征
        this.pokemonEncodingFeatures = {
            // ASCII字符范围 (Pokemon中常用)
            ascii: { start: 0x20, end: 0x7E, likely: true },
            
            // 汉字编码模式
            chinesePatterns: [
                { firstByte: 0x01, secondByteMin: 0x00, secondByteMax: 0xFF }, // 0x0100-0x01FF
                { firstByte: 0x02, secondByteMin: 0x00, secondByteMax: 0xFF }, // 0x0200-0x02FF
                { firstByte: 0x03, secondByteMin: 0x00, secondByteMax: 0xFF }  // 0x0300-0x03FF
            ],
            
            // 特殊字符
            specialChars: {
                // Pokemon战斗相关符号
                battleSymbols: [
                    0x01, // ?
                    0x02, // ?
                    0x03, // ?
                    0x04  // ?
                ],
                
                // 菜单、界面符号
                uiSymbols: [
                    0x10, // 箭头
                    0x11, // 心形
                    0x12, // 星星
                    0x13  // 其他
                ]
            }
        };
    }
    
    // ================= 核心扫描功能 =================
    
    /**
     * 扫描整个ROM的字库特征
     * @returns {Object} 扫描结果
     */
    comprehensiveFontScan() {
        const scanReport = {
            timestamp: Date.now(),
            scanStartTime: performance.now(),
            regionsScanned: [],
            detailedFindings: {}
        };
        
        console.log('🧠 开始字库特征全面扫描...');
        
        // 1. 扫描ROM区域 (字体数据最可能在这里)
        const romScan = this.scanROMFontStructures();
        scanReport.regionsScanned.push('ROM区域');
        scanReport.detailedFindings.rom = romScan;
        
        // 2. 扫描VRAM区域 (运行时字体数据)
        const vramScan = this.scanVRAMFontPatterns();
        scanReport.regionsScanned.push('VRAM区域');
        scanReport.detailedFindings.vram = vramScan;
        
        // 3. 扫描工作RAM (运行时字符缓存)
        const workRamScan = this.scanWorkRAMText();
        scanReport.regionsScanned.push('工作RAM');
        scanReport.detailedFindings.workRam = workRamScan;
        
        // 4. 分析字符编码模式
        const encodingAnalysis = this.analyzeEncodingPatterns();
        scanReport.detailedFindings.encoding = encodingAnalysis;
        
        // 5. 查找关键的文本字符串
        const keyStrings = this.findKeyTextStrings();
        scanReport.detailedFindings.keyStrings = keyStrings;
        
        const scanTime = performance.now() - scanReport.scanStartTime;
        scanReport.scanDuration = scanTime;
        scanReport.totalFindings = this.calculateTotalFindings();
        
        console.log(`✅ 字库特征扫描完成，耗时 ${scanTime.toFixed(2)}ms`);
        console.log(`📊 发现: ${scanReport.totalFindings.total} 处相关数据`);
        
        // 保存结果
        this.scanResults.comprehensiveReport = scanReport;
        
        return scanReport;
    }
    
    /**
     * 扫描ROM中的字体数据结构
     */
    scanROMFontStructures() {
        const romStart = 0x08000000;
        const romEnd = 0x0E000000; // 通常ROM大小
        
        const findings = {
            fontTables: [],
            textStrings: [],
            encodingHints: [],
            totalScanned: 0
        };
        
        console.log(`🔍 扫描ROM区域: 0x${romStart.toString(16)}-0x${romEnd.toString(16)}`);
        
        // 分块扫描，避免性能问题
        const chunkSize = 0x10000; // 64KB 一块
        
        for (let address = romStart; address < romEnd; address += chunkSize) {
            const chunkEnd = Math.min(address + chunkSize, romEnd);
            
            try {
                // 扫描文本模式
                const textPatterns = this.scanForTextPatterns(address, chunkEnd);
                findings.textStrings.push(...textPatterns);
                
                // 扫描可能的字体表
                const fontTables = this.scanForFontTables(address, chunkEnd);
                findings.fontTables.push(...fontTables);
                
                // 扫描编码特征
                const encodingHints = this.scanForEncodingHints(address, chunkEnd);
                findings.encodingHints.push(...encodingHints);
                
                findings.totalScanned += chunkSize;
                
            } catch (error) {
                console.warn(`扫描ROM区域 ${address.toString(16)} 时出错:`, error);
            }
        }
        
        // 分析找到的数据
        this.analyzeFontStructures(findings);
        
        return findings;
    }
    
    /**
     * 扫描VRAM中的字体模式
     */
    scanVRAMFontPatterns() {
        const vramStart = 0x06000000;
        const vramEnd = 0x06018000; // 96KB VRAM
        
        const findings = {
            tilePatterns: [],
            paletteData: [],
            renderingHints: [],
            totalScanned: 0
        };
        
        console.log(`🎨 扫描VRAM区域: 0x${vramStart.toString(16)}-0x${vramEnd.toString(16)}`);
        
        // 扫描可能的图块模式 (适合字体显示)
        for (let address = vramStart; address < vramEnd; address += 0x20) { // 8x8图块
            try {
                const tilePattern = this.analyzeTilePattern(address);
                if (tilePattern.isLikelyFont) {
                    findings.tilePatterns.push(tilePattern);
                }
                
                // 检查可能的调色板数据
                if (this.isPaletteDataPattern(address)) {
                    findings.paletteData.push({
                        address: address,
                        pattern: this.readBytes(address, 32)
                    });
                }
                
                findings.totalScanned += 0x20;
                
            } catch (error) {
                // 可能是不合法的地址
            }
        }
        
        return findings;
    }
    
    /**
     * 扫描工作RAM中的文本
     */
    scanWorkRAMText() {
        const ramStart = 0x02000000;
        const ramEnd = 0x02040000; // 256KB 工作RAM
        
        const findings = {
            asciiStrings: [],
            multiByteSequences: [],
            bufferPatterns: [],
            totalScanned: 0
        };
        
        console.log(`💾 扫描工作RAM区域: 0x${ramStart.toString(16)}-0x${ramEnd.toString(16)}`);
        
        // 扫描ASCII字符串
        findings.asciiStrings = this.scanForASCIIStrings(ramStart, ramEnd);
        
        // 扫描多字节序列 (可能的汉字)
        findings.multiByteSequences = this.scanForMultiByteSequences(ramStart, ramEnd);
        
        // 扫描可能的文本缓冲区模式
        findings.bufferPatterns = this.scanForBufferPatterns(ramStart, ramEnd);
        
        findings.totalScanned = ramEnd - ramStart;
        
        return findings;
    }
    
    // ================= 分析功能 =================
    
    /**
     * 分析字符编码模式
     */
    analyzeEncodingPatterns() {
        const analysis = {
            asciiPattern: null,
            chinesePatterns: [],
            mixedPatterns: [],
            confidenceScores: {}
        };
        
        // 从捕获的字符中分析模式
        for (const [code, info] of this.scanResults.capturedChars) {
            if (code <= 0xFF) {
                // ASCII或单字节字符
                if (!analysis.asciiPattern) {
                    analysis.asciiPattern = { min: code, max: code };
                } else {
                    analysis.asciiPattern.min = Math.min(analysis.asciiPattern.min, code);
                    analysis.asciiPattern.max = Math.max(analysis.asciiPattern.max, code);
                }
            } else {
                // 多字节字符
                const firstByte = (code >> 8) & 0xFF;
                const secondByte = code & 0xFF;
                
                const pattern = analysis.chinesePatterns.find(p => p.firstByte === firstByte);
                if (pattern) {
                    pattern.minSecond = Math.min(pattern.minSecond || secondByte, secondByte);
                    pattern.maxSecond = Math.max(pattern.maxSecond || secondByte, secondByte);
                    pattern.count = (pattern.count || 0) + 1;
                } else {
                    analysis.chinesePatterns.push({
                        firstByte: firstByte,
                        minSecond: secondByte,
                        maxSecond: secondByte,
                        count: 1
                    });
                }
            }
        }
        
        // 计算置信度
        analysis.confidenceScores = {
            asciiConfidence: analysis.asciiPattern ? 0.8 : 0,
            chineseConfidence: analysis.chinesePatterns.length > 0 ? 0.7 : 0,
            mixedEncoding: analysis.chinesePatterns.length > 0 && analysis.asciiPattern ? 0.9 : 0
        };
        
        return analysis;
    }
    
    /**
     * 查找关键的文本字符串
     */
    findKeyTextStrings() {
        const keyStrings = [];
        
        // Pokemon游戏常见的界面字符串
        const pokemonKeyPhrases = [
            // 主菜单
            "NEW GAME",
            "CONTINUE",
            "OPTION",
            
            // 战斗界面
            "FIGHT",
            "BAG",
            "POKéMON",
            "RUN",
            
            // 对话框常见
            "What?",
            "Yes",
            "No",
            
            // 中文常见
            "开始游戏",
            "继续游戏",
            "设置",
            "战斗"
        ];
        
        // 扫描ROM区域查找关键词
        for (let address = 0x08000000; address < 0x0E000000; address += 0x1000) {
            try {
                const buffer = new Uint8Array(this.mmu.loadU8(address, 0x1000));
                const text = this.decodeBufferToText(buffer);
                
                pokemonKeyPhrases.forEach(phrase => {
                    if (text.includes(phrase)) {
                        keyStrings.push({
                            phrase: phrase,
                            address: address + text.indexOf(phrase),
                            context: this.extractContext(text, phrase),
                            confidence: 0.9
                        });
                    }
                });
                
            } catch (error) {
                // 忽略读取错误
            }
        }
        
        return keyStrings;
    }
    
    /**
     * 查找字体相关数据结构
     */
    scanForFontTables(startAddress, endAddress) {
        const fontTables = [];
        
        for (let address = startAddress; address < endAddress; address += 4) {
            try {
                const pattern = this.readBytes(address, 16);
                
                // 检查可能的字体表特征
                if (this.isLikelyFontTable(pattern)) {
                    fontTables.push({
                        address: address,
                        pattern: pattern,
                        possibleSize: this.estimateTableSize(pattern),
                        confidence: this.calculateFontTableConfidence(pattern)
                    });
                }
            } catch (error) {
                break; // 可能到达了无效地址区域
            }
        }
        
        return fontTables;
    }
    
    // ================= 辅助函数 =================
    
    /**
     * 读取指定地址的字节数据
     */
    readBytes(address, length) {
        const bytes = new Uint8Array(length);
        for (let i = 0; i < length; i++) {
            bytes[i] = this.mmu.loadU8(address + i);
        }
        return bytes;
    }
    
    /**
     * 解码缓冲区为文本
     */
    decodeBufferToText(buffer, encoding = 'auto') {
        let text = '';
        
        for (let i = 0; i < buffer.length; i++) {
            const byte = buffer[i];
            
            if (byte === 0x00) {
                // 字符串终止符
                break;
            }
            
            // 简单 ASCII 解码
            if (byte >= 0x20 && byte <= 0x7E) {
                text += String.fromCharCode(byte);
            } else if (byte === 0x0A) {
                text += '\n';
            } else if (byte === 0x0D) {
                // 回车符，跳过
            } else {
                // 非 ASCII 字符，用占位符表示
                text += `[0x${byte.toString(16).padStart(2, '0')}]`;
            }
        }
        
        return text;
    }
    
    /**
     * 分析图块模式是否可能是字体
     */
    analyzeTilePattern(address) {
        const tileData = this.readBytes(address, 0x20); // 8x8 4bpp 图块
        
        const analysis = {
            address: address,
            isLikelyFont: false,
            characteristics: {},
            confidence: 0
        };
        
        // 分析图块数据特征
        const characteristics = {
            solidBlocks: 0,
            checkerboard: 0,
            sparsePattern: 0,
            linearPattern: 0
        };
        
        // 简单的特征分析 (实际应用中需要更复杂的算法)
        let byteSum = 0;
        for (let i = 0; i < tileData.length; i++) {
            byteSum += tileData[i];
        }
        
        // 如果数据非常稀疏，可能是字体 (很多透明像素)
        const sparsity = byteSum / (tileData.length * 255);
        if (sparsity < 0.3) {
            analysis.isLikelyFont = true;
            analysis.confidence = 0.6;
        }
        
        analysis.characteristics = characteristics;
        
        return analysis;
    }
    
    /**
     * 计算字体表的置信度
     */
    calculateFontTableConfidence(pattern) {
        let confidence = 0;
        
        // 检查模式特征
        // 1. 有规律的结构
        // 2. 可能的字形索引
        // 3. 对齐特征
        
        // 简单实现：根据非零字节的比例
        let nonZeroCount = 0;
        for (let i = 0; i < pattern.length; i++) {
            if (pattern[i] !== 0) nonZeroCount++;
        }
        
        const density = nonZeroCount / pattern.length;
        
        // 中等密度可能表示字形数据
        if (density > 0.3 && density < 0.7) {
            confidence = 0.5;
        }
        
        return confidence;
    }
    
    /**
     * 分析字体数据结构
     */
    analyzeFontStructures(findings) {
        // 分析字体表特征
        findings.fontTables.forEach(table => {
            // 进一步分析表结构
            table.analysis = {
                possibleGlyphCount: this.estimateGlyphCount(table.pattern),
                byteAlignment: this.checkByteAlignment(table.address),
                referencePatterns: this.findReferencePatterns(table.address)
            };
        });
        
        // 分析文本字符串特征
        findings.textStrings.forEach(text => {
            text.analysis = {
                encodingType: this.detectEncodingType(text.data),
                likelyPurpose: this.guessTextPurpose(text.data),
                relatedFunctions: this.findRelatedFunctions(text.address)
            };
        });
    }
    
    /**
     * 扫描文本模式
     */
    scanForTextPatterns(startAddress, endAddress) {
        const textStrings = [];
        let currentString = [];
        let stringStart = null;
        
        for (let address = startAddress; address < endAddress; address++) {
            try {
                const byte = this.mmu.loadU8(address);
                
                // ASCII 可打印字符
                if (byte >= 0x20 && byte <= 0x7E) {
                    if (stringStart === null) {
                        stringStart = address;
                    }
                    currentString.push(byte);
                }
                // 字符串终止符或不可打印字符
                else if (currentString.length > 0) {
                    // 只有足够长的字符串才保存
                    if (currentString.length >= 4) {
                        textStrings.push({
                            address: stringStart,
                            data: currentString.slice(),
                            text: String.fromCharCode(...currentString),
                            length: currentString.length,
                            confidence: this.calculateStringConfidence(currentString)
                        });
                    }
                    
                    currentString = [];
                    stringStart = null;
                }
                
            } catch (error) {
                // 可能是不合法的地址
                break;
            }
        }
        
        return textStrings;
    }
    
    /**
     * 扫描多字节序列
     */
    scanForMultiByteSequences(startAddress, endAddress) {
        const sequences = [];
        
        for (let address = startAddress; address < endAddress; address++) {
            try {
                const firstByte = this.mmu.loadU8(address);
                
                // 检查是否可能是汉字编码的首字节
                const isChineseFirstByte = this.isChineseFirstByte(firstByte);
                
                if (isChineseFirstByte) {
                    try {
                        const secondByte = this.mmu.loadU8(address + 1);
                        
                        // 检查第二字节是否在合理范围
                        if (secondByte >= 0x00 && secondByte <= 0xFF) {
                            sequences.push({
                                address: address,
                                bytes: [firstByte, secondByte],
                                fullCode: (firstByte << 8) | secondByte,
                                confidence: this.calculateSequenceConfidence(firstByte, secondByte)
                            });
                            
                            address++; // 跳过第二字节
                        }
                    } catch (error) {
                        // 第二字节读取失败

                    }
                }
                
            } catch (error) {
                // 地址无效

            }
        }
        
        return sequences;
    }
    
    /**
     * 计算字符串置信度

     */
    calculateStringConfidence(bytes) {
        let confidence = 0.3; // 基础置信度
        
        // 检查是否为常见单词/短语
        const text = String.fromCharCode(...bytes);
        
        const commonWords = ["THE", "AND", "YOU", "FOR", "ARE", "BUT", "NOT", "ALL", "CAN"];
        const commonPhrases = ["NEW GAME", "CONTINUE", "OPTIONS", "SAVE", "LOAD"];
        
        if (commonWords.some(word => text.includes(word))) {
            confidence += 0.2;
        }
        
        if (commonPhrases.some(phrase => text.includes(phrase))) {
            confidence += 0.3;
        }
        
        // 检查大小写混合 (游戏文本特征)

        const hasUpperCase = /[A-Z]/.test(text);
        const hasLowerCase = /[a-z]/.test(text);
        
        if (hasUpperCase && hasLowerCase) {
            confidence += 0.2;
        }
        
        return Math.min(confidence, 1.0);
    }
    
    /**
     * 计算多字节序列置信度
     */
    calculateSequenceConfidence(firstByte, secondByte) {
        let confidence = 0.5;
        
        // 基于已知Pokemon编码模式
        const knownChineseRanges = [
            { first: 0x01, secondMin: 0x00, secondMax: 0xFF },
            { first: 0x02, secondMin: 0x00, secondMax: 0xFF },
            { first: 0x03, secondMin: 0x00, secondMax: 0xFF }
        ];
        
        const matchesKnownRange = knownChineseRanges.some(range => 
            firstByte === range.first && 
            secondByte >= range.secondMin && 
            secondByte <= range.secondMax
        );
        
        if (matchesKnownRange) {
            confidence = 0.8;
        }
        
        return confidence;
    }
    
    /**
     * 检查是否可能是汉字的首字节
     */
    isChineseFirstByte(byte) {
        // Pokemon游戏中的汉字编码通常从0x01、0x02、0x03开始

        return byte === 0x01 || byte === 0x02 || byte === 0x03;
    }
    
    /**
     * 是否为可能的字体表
     */
    isLikelyFontTable(pattern) {
        // 检查可能的字体表特征
        // 1. 字节对齐

        // 2. 可能包含字形索引

        // 3. 特定模式的重复

        
        // 简单实现：检查是否有足够的非零数据

        let nonZeroCount = 0;
        for (let i = 0; i < pattern.length; i++) {
            if (pattern[i] !== 0) nonZeroCount++;
        }
        
        // 字体数据通常不是全零也不是全满
        const density = nonZeroCount / pattern.length;
        return density > 0.2 && density < 0.8;
    }
    
    /**
     * 是否为调色板数据模式
     */
    isPaletteDataPattern(address) {
        // 调色板数据通常是16位的颜色值

        try {
            const data1 = this.mmu.loadU16(address);
            const data2 = this.mmu.loadU16(address + 2);
            
            // 简单的模式检查 (实际需要更复杂)

            return true;
        } catch (error) {
            return false;
        }
    }
    
    /**
     * 扫描可能的缓冲区模式
     */
    scanForBufferPatterns(startAddress, endAddress) {
        const patterns = [];
        
        // 检查可能的文本缓冲区模式

        for (let address = startAddress; address < endAddress; address += 0x10) {
            const chunk = this.readBytes(address, 0x10);
            
            // 检查是否为可能的文本缓冲区 (可能包含字符串终止符)

            if (chunk.includes(0x00)) {
                patterns.push({
                    address: address,
                    size: this.findBufferSize(address),
                    pattern: chunk,
                    confidence: 0.6
                });
            }
        }
        
        return patterns;
    }
    
    /**
     * 查找可能的缓冲区大小
     */
    findBufferSize(startAddress) {
        let size = 0;
        let address = startAddress;
        
        try {
            while (true) {
                const byte = this.mmu.loadU8(address);
                size++;
                address++;
                
                // 假设缓冲区以0x00结束或最大256字节

                if (byte === 0x00 || size >= 256) {
                    break;
                }
            }
        } catch (error) {
            // 遇到无效地址

        }
        
        return size;
    }
    
    /**
     * 扫描ASCII字符串
     */
    scanForASCIIStrings(startAddress, endAddress) {
        const strings = [];
        let currentString = [];
        let stringStart = null;
        
        for (let address = startAddress; address < endAddress; address++) {
            try {
                const byte = this.mmu.loadU8(address);
                
                // ASCII可打印字符

                if (byte >= 0x20 && byte <= 0x7E) {
                    if (stringStart === null) {
                        stringStart = address;
                    }
                    currentString.push(byte);
                } 
                // 字符串终止符或非可打印字符

                else if (currentString.length > 0) {
                    // 只有足够长的字符串才保存

                    if (currentString.length >= 3) {
                        strings.push({
                            address: stringStart,
                            text: String.fromCharCode(...currentString),
                            length: currentString.length,
                            confidence: this.calculateASCIIStringConfidence(currentString)
                        });
                    }
                    
                    currentString = [];
                    stringStart = null;
                }
                
            } catch (error) {
                // 跳过错误

            }
        }
        
        return strings;
    }
    
    /**
     * 计算ASCII字符串置信度
     */
    calculateASCIIStringConfidence(bytes) {
        const text = String.fromCharCode(...bytes);
        
        let confidence = 0.4;
        
        // 检查常见单词

        const commonWords = ["THE", "AND", "FOR", "YOU", "ARE", "BUT", "NOT"];
        if (commonWords.some(word => text.includes(word))) {
            confidence += 0.3;
        }
        
        // 检查大小写

        const hasUpperCase = /[A-Z]/.test(text);
        const hasLowerCase = /[a-z]/.test(text);
        
        if (hasUpperCase && hasLowerCase) {
            confidence += 0.2;
        }
        
        // 检查标点

        if (text.includes('.') || text.includes(',') || text.includes('!') || text.includes('?')) {
            confidence += 0.1;
        }
        
        return Math.min(confidence, 1.0);
    }
    
    /**
     * 扫描编码特征

     */
    scanForEncodingHints(startAddress, endAddress) {
        const hints = [];
        
        for (let address = startAddress; address < endAddress; address++) {
            try {
                const byte = this.mmu.loadU8(address);
                
                // 检查可能的编码模式

                if (this.isLikelyEncodingHint(byte, address)) {
                    hints.push({
                        address: address,
                        byte: byte,
                        context: this.getEncodingContext(address),
                        confidence: 0.7
                    });
                }
                
            } catch (error) {
                break;
            }
        }
        
        return hints;
    }
    
    /**
     * 是否为可能的编码特征
     */
    isLikelyEncodingHint(byte, address) {
        // 检查可能的编码相关字节

        // 例如：字符表索引、字体偏移等

        
        // 简单实现：检查某些特殊值

        const specialValues = [0x00, 0xFF, 0x80, 0x7F];
        return specialValues.includes(byte);
    }
    
    /**
     * 获取编码上下文

     */
    getEncodingContext(address) {
        // 读取周围字节作为上下文

        try {
            const context = this.readBytes(address - 8, 16);
            return {
                before: Array.from(context.slice(0, 8)),
                after: Array.from(context.slice(8, 16))
            };
        } catch (error) {
            return null;
        }
    }
    
    /**
     * 提取上下文文本

     */
    extractContext(fullText, phrase) {
        const index = fullText.indexOf(phrase);
        if (index === -1) return '';
        
        const start = Math.max(0, index - 30);
        const end = Math.min(fullText.length, index + phrase.length + 30);
        
        return fullText.substring(start, end);
    }
    
    /**
     * 编码检测类型

     */
    detectEncodingType(data) {
        // 简单编码检测

        const allASCII = data.every(byte => byte >= 0x20 && byte <= 0x7E);
        const hasChineseFirstByte = data.some(byte => this.isChineseFirstByte(byte));
        
        if (allASCII) return 'ASCII';
        if (hasChineseFirstByte) return 'Chinese';
        return 'Unknown';
    }
    
    /**
     * 猜测文本用途

     */
    guessTextPurpose(data) {
        const text = String.fromCharCharCode(...data);
        
        if (text.includes("NEW GAME") || text.includes("CONTINUE")) return "Menu Text";
        if (text.includes("FIGHT") || text.includes("BAG")) return "Battle Text";
        if (text.includes("What?") || text.includes("Yes")) return "Dialog Text";
        
        return "General Text";
    }
    
    /**
     * 查找相关函数

     */
    findRelatedFunctions(address) {
        // 简单实现：基于地址范围猜测

        // 在真实应用中，可能需要反汇编分析调用关系

        
        const functionHints = [
            { rangeStart: 0x08000000, rangeEnd: 0x08800000, possibleFunc: "GameInit" },
            { rangeStart: 0x08004800, rangeEnd: 0x08005000, possibleFunc: "TextRendering" },
            { rangeStart: 0x08006800, rangeEnd: 0x08007000, possibleFunc: "FontDrawing" }
        ];
        
        const matches = functionHints.filter(hint => 
            address >= hint.rangeStart && address < hint.rangeEnd
        );
        
        return matches.map(m => m.possibleFunc);

    }
    
    /**
     * 估计表大小

     */
    estimateTableSize(pattern) {
        // 基于模式特征估计表大小

        // 简单实现：根据非零区域计算

        
        let contiguousNonZero = 0;
        let maxContiguous = 0;
        
        for (let i = 0; i < pattern.length; i++) {
            if (pattern[i] !== 0) {
                contiguousNonZero++;
                maxContiguous = Math.max(maxContiguous, contiguousNonZero);
            } else {
                contiguousNonZero = 0;
            }
        }
        
        return maxContiguous * 4; // 简单估算
    }
    
    /**
     * 检查字节对齐

     */
    checkByteAlignment(address) {
        return (address % 4 === 0) ? "WordAligned" : "NotAligned";

    }
    
    /**
     * 查找引用模式

     */
    findReferencePatterns(address) {
        // 查找可能的引用点

        // 在真实应用中可能需要扫描代码段

        
        return [];
    }
    
    /**
     * 估计字符数量

     */
    estimateGlyphCount(pattern) {
        // 基于模式特征估计字符数量

        // 简单实现：根据数据模式估算

        
        const uniquePatterns = new Set();
        for (let i = 0; i < pattern.length; i += 4) {
            const word = pattern[i] | (pattern[i+1] << 8) | (pattern[i+2] << 16) | (pattern[i+3] << 24);
            uniquePatterns.add(word);
        }
        
        return uniquePatterns.size;

    }
    
    /**
     * 计算总发现数

     */
    calculateTotalFindings() {
        let total = 0;
        
        if (this.scanResults.comprehensiveReport) {
            const report = this.scanResults.comprehensiveReport;
            
            // 计算各种发现的总数

            total += (report.detailedFindings.rom?.fontTables?.length || 0);
            total += (report.detailedFindings.rom?.textStrings?.length || 0);
            total += (report.detailedFindings.vram?.tilePatterns?.length || 0);
            total += (report.detailedFindings.workRam?.asciiStrings?.length || 0);
        }
        
        return {
            total: total,
            categories: {
                romFontTables: (this.scanResults.comprehensiveReport?.detailedFindings?.rom?.fontTables?.length || 0),
                romTextStrings: (this.scanResults.comprehensiveReport?.detailedFindings?.rom?.textStrings?.length || 0),
                vramTilePatterns: (this.scanResults.comprehensiveReport?.detailedFindings?.vram?.tilePatterns?.length || 0),
                ramAsciiStrings: (this.scanResults.comprehensiveReport?.detailedFindingsings?.workRam?.asciiStrings?.length || 0)
            }
        };
    }
    
    // ================= 工具方法 =================

    /**
     * 获取扫描结果摘要

     */
    getScanSummary() {
        const summary = {
            timestamp: Date.now(),
            totalFindings: this.calculateTotalFindings(),
            encodingAnalysis: this.analyzeEncodingPatterns(),
            keyFindings: []
        };
        
        // 添加关键发现

        if (this.scanResults.comprehensiveReport) {
            const report = this.scanResults.comprehensiveReport;
            
            // ROM区域的关键字体表

            if (report.detailedFindings.rom?.fontTables?.length > 0) {
                summary.keyFindings.push({
                    type: "FontTable",
                    count: report.detailedFindings.rom.fontTables.length,
                    examples: report.detailedFindings.rom.fontTables.slice(0, 3)

                });
            }
            
            // VRAM区域的可能字形

            if (report.detailedFindings.vram?.tilePatterns?.length > 0) {
                summary.keyFindings.push({
                    type: "FontTiles",
                    count: report.detailedFindings.vram.tilePatterns.length,
                    examples: report.detailedFindings.vram.tilePatterns.slice(0, 3)

                });
            }
            
            // 工作RAM中的文本

            if (report.detailedFindings.workRam?.asciiStrings?.length > 0) {
                summary.keyFindings.push({
                    type: "ActiveText",
                    count: report.detailedFindings.workRam.asciiStrings.length,
                    examples: report.detailedFindings.workRam.asciiStrings.slice(0, 3)

                });
            }
        }
        
        return summary;

    }
    
    /**
     * 重置扫描结果

     */
    resetScanResults() {
        this.scanResults = {
            encodings: {
                asciiRange: { start: 0, end: 0, confidence: 0 },
                chineseRange: { start: 0, end: 0, confidence: 0 },
                symbolRange: { start: 0, end: 0, confidence: 0 }
            },
            textRegions: [],
            fontStructures: [],
            keyStrings: [],
            capturedChars: new Map(),
            statistics: {
                totalMemoryScanned: 0,
                textPatternsFound: 0,
                fontStructuresDetected: 0,
                encodingPatterns: []
            }
        };
    }
}

// 导出模块

if (typeof module !== 'undefined' && module.exports) {
    module.exports = FontScanEngine;
}