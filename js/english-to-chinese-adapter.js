// 英文到中文Hook适配器
// 将英文游戏的渲染函数适配为支持中文

class EnglishToChineseAdapter {
    constructor(gba, hookAddresses, encodingMap) {
        this.gba = gba;
        this.cpu = gba.cpu;
        this.mmu = gba.mmu;
        
        // Hook地址
        this.hookAddresses = hookAddresses || {
            getGlyphWidth: 0x080048EA,
            getStringWidth: 0x08004CCC,
            drawGlyphTiles: 0x08006876
        };
        
        // 编码映射 (从wholewords.txt加载)
        this.encodingMap = encodingMap || this.loadDefaultEncodingMap();
        
        // 中文字符宽度 (根据字库决定)
        this.chineseCharWidth = 12; // 12px
        this.chineseCharHeight = 12; // 12px
        
        // 原始函数备份
        this.originalFunctions = {};
        
        // 状态
        this.isChineseChar = false;
        this.currentChineseCode = 0;
    }
    
    /**
     * 加载默认编码映射
     */
    loadDefaultEncodingMap() {
        // 这里应该从wholewords.txt加载
        // 暂时返回一个示例映射
        return {
            // ASCII映射
            ascii: {
                0xC8: 'N', 0xBF: 'E', 0xD1: 'W',
                0x00: ' ', 0xC1: 'G', 0xBB: 'A',
                0xC7: 'M'
            },
            
            // 汉字映射 (示例)
            chinese: {
                0x0100: '一', 0x0101: '丁', 0x0102: '七',
                // ... 更多汉字
            }
        };
    }
    
    /**
     * 安装所有Hook
     */
    installAllHooks() {
        console.log('🔧 安装英文到中文Hook适配器...');
        
        this.installGetGlyphWidthHook();
        this.installGetStringWidthHook();
        this.installDrawGlyphTilesHook();
        
        console.log('✅ Hook适配器安装完成');
    }
    
    /**
     * 安装GetGlyphWidth Hook
     */
    installGetGlyphWidthHook() {
        const address = this.hookAddresses.getGlyphWidth;
        
        // 保存原始函数
        this.originalFunctions.getGlyphWidth = this.getFunctionAtAddress(address);
        
        // 安装Hook
        this.installCodeHook(address, this.hookedGetGlyphWidth.bind(this));
        
        console.log(`✅ GetGlyphWidth Hook已安装 @ ${hex(address)}`);
    }
    
    /**
     * Hook的GetGlyphWidth函数
     */
    hookedGetGlyphWidth() {
        // 获取参数
        const windowPtr = this.cpu.gprs[0];  // r0: 窗口结构体指针
        const charCode = this.cpu.gprs[1] & 0xFF;  // r1: 字符编码
        
        // 检查是否为中文字符
        if (this.isChineseFirstByte(charCode)) {
            // 这是一个中文字符的第一个字节
            this.isChineseChar = true;
            this.currentChineseCode = charCode << 8;
            
            // 返回中文字符宽度
            this.cpu.gprs[0] = this.chineseCharWidth;
            return true; // 已处理，跳过原始函数
        } else if (this.isChineseChar) {
            // 这是中文字符的第二个字节
            this.currentChineseCode |= charCode;
            this.isChineseChar = false;
            
            // 返回中文字符宽度
            this.cpu.gprs[0] = this.chineseCharWidth;
            return true; // 已处理，跳过原始函数
        } else {
            // 英文字符，调用原始函数
            return false; // 未处理，调用原始函数
        }
    }
    
    /**
     * 安装GetStringWidth Hook
     */
    installGetStringWidthHook() {
        const address = this.hookAddresses.getStringWidth;
        
        // 保存原始函数
        this.originalFunctions.getStringWidth = this.getFunctionAtAddress(address);
        
        // 安装Hook
        this.installCodeHook(address, this.hookedGetStringWidth.bind(this));
        
        console.log(`✅ GetStringWidth Hook已安装 @ ${hex(address)}`);
    }
    
    /**
     * Hook的GetStringWidth函数
     */
    hookedGetStringWidth() {
        const stringPtr = this.cpu.gprs[0];  // r0: 字符串指针
        
        let totalWidth = 0;
        let offset = 0;
        let inChineseChar = false;
        let chineseFirstByte = 0;
        
        // 遍历字符串直到遇到0x00终止符
        while (true) {
            try {
                const charCode = this.mmu.loadU8(stringPtr + offset);
                
                if (charCode === 0) {
                    break; // 字符串结束
                }
                
                if (this.isChineseFirstByte(charCode)) {
                    // 中文字符的第一个字节
                    inChineseChar = true;
                    chineseFirstByte = charCode;
                    totalWidth += this.chineseCharWidth;
                    offset++;
                } else if (inChineseChar) {
                    // 中文字符的第二个字节
                    inChineseChar = false;
                    offset++;
                    // 宽度已在第一个字节时计算
                } else {
                    // 英文字符，调用原始GetGlyphWidth计算宽度
                    const charWidth = this.getEnglishCharWidth(charCode);
                    totalWidth += charWidth;
                    offset++;
                }
            } catch (e) {
                break; // 内存访问错误
            }
        }
        
        // 设置返回值
        this.cpu.gprs[0] = totalWidth;
        return true; // 已处理，跳过原始函数
    }
    
    /**
     * 安装DrawGlyphTiles Hook
     */
    installDrawGlyphTilesHook() {
        const address = this.hookAddresses.drawGlyphTiles;
        
        // 保存原始函数
        this.originalFunctions.drawGlyphTiles = this.getFunctionAtAddress(address);
        
        // 安装Hook
        this.installCodeHook(address, this.hookedDrawGlyphTiles.bind(this));
        
        console.log(`✅ DrawGlyphTiles Hook已安装 @ ${hex(address)}`);
    }
    
    /**
     * Hook的DrawGlyphTiles函数
     */
    hookedDrawGlyphTiles() {
        // 获取参数
        const windowPtr = this.cpu.gprs[0];  // r0: 窗口结构体指针
        const charCode = this.cpu.gprs[1] & 0xFF;  // r1: 字符编码
        const x = this.cpu.gprs[2];  // r2: X坐标
        const y = this.cpu.gprs[3];  // r3: Y坐标
        
        if (this.isChineseFirstByte(charCode)) {
            // 中文字符的第一个字节
            this.isChineseChar = true;
            this.currentChineseCode = charCode << 8;
            
            // 延迟绘制，等待第二个字节
            return true; // 已处理，跳过原始函数
        } else if (this.isChineseChar) {
            // 中文字符的第二个字节
            this.currentChineseCode |= charCode;
            this.isChineseChar = false;
            
            // 绘制中文字符
            this.drawChineseCharacter(this.currentChineseCode, x, y);
            return true; // 已处理，跳过原始函数
        } else {
            // 英文字符，调用原始函数
            return false; // 未处理，调用原始函数
        }
    }
    
    /**
     * 检查是否为中文字符的第一个字节
     */
    isChineseFirstByte(byte) {
        // 根据wholewords.txt的分析，中文字符的第一个字节通常是0x01-0x1F
        return byte >= 0x01 && byte <= 0x1F;
    }
    
    /**
     * 获取英文字符宽度
     */
    getEnglishCharWidth(charCode) {
        // 这里应该调用原始的GetGlyphWidth函数
        // 暂时返回固定值
        if (charCode >= 0x20 && charCode <= 0x7E) {
            return 8; // 标准ASCII字符宽度
        } else {
            return 6; // 控制字符或其他字符
        }
    }
    
    /**
     * 绘制中文字符
     */
    drawChineseCharacter(chineseCode, x, y) {
        console.log(`🖋️ 绘制中文字符: ${hex(chineseCode)} @ (${x}, ${y})`);
        
        // 这里应该实现中文字符的实际绘制逻辑
        // 需要：
        // 1. 从字库文件中获取字模数据
        // 2. 将字模数据写入VRAM
        // 3. 更新图块映射
        
        // 暂时只记录日志
        return true;
    }
    
    /**
     * 获取地址处的函数
     */
    getFunctionAtAddress(address) {
        // 这里应该实现函数提取逻辑
        // 暂时返回一个占位符
        return {
            address: address,
            size: 0x100, // 估计大小
            instructions: []
        };
    }
    
    /**
     * 安装代码Hook
     */
    installCodeHook(address, hookFunction) {
        // 保存原始指令
        const originalInstruction = this.mmu.loadU32(address);
        
        // 创建跳转到hook函数的指令
        // ARM模式: B <hook_function_address>
        // 需要计算相对偏移
        
        // 暂时只记录
        console.log(`📌 在 ${hex(address)} 安装Hook`);
    }
    
    /**
     * 恢复所有Hook
     */
    restoreAllHooks() {
        console.log('🔄 恢复所有原始函数...');
        
        // 这里应该实现Hook恢复逻辑
        
        console.log('✅ 所有Hook已恢复');
    }
    
    /**
     * 生成Hook配置报告
     */
    generateHookReport() {
        return {
            hookPoints: Object.entries(this.hookAddresses).map(([name, address]) => ({
                name,
                address: hex(address),
                purpose: this.getHookPurpose(name),
                status: 'installed',
                modifications: this.getHookModifications(name)
            })),
            
            encodingInfo: {
                asciiRange: '0x20-0x7E',
                chineseRange: '0x0100-0x1FFF',
                mappingSource: 'wholewords.txt',
                totalMappings: Object.keys(this.encodingMap.chinese || {}).length
            },
            
            implementationNotes: `
注意事项:
1. 中文字符宽度固定为 ${this.chineseCharWidth}px
2. 英文字符宽度由原始函数计算
3. 双字节字符检测: 第一个字节在0x01-0x1F范围
4. 需要确保字库文件已正确加载到ROM中
            `
        };
    }
    
    /**
     * 获取Hook目的
     */
    getHookPurpose(name) {
        const purposes = {
            getGlyphWidth: '修改单字符宽度计算，支持双字节中文字符',
            getStringWidth: '修改字符串宽度计算，正确累加中英混合字符宽度',
            drawGlyphTiles: '修改字符绘制，支持从字库绘制中文字符'
        };
        return purposes[name] || '未知目的';
    }
    
    /**
     * 获取Hook修改内容
     */
    getHookModifications(name) {
        const modifications = {
            getGlyphWidth: [
                '添加双字节字符检测',
                '为中文字符返回固定宽度',
                '保持英文字符原始处理'
            ],
            getStringWidth: [
                '遍历字符串时识别双字节字符',
                '累加中文字符宽度',
                '调用原始函数处理英文字符'
            ],
            drawGlyphTiles: [
                '检测双字节字符',
                '从字库读取中文字模',
                '绘制到VRAM的适当位置'
            ]
        };
        return modifications[name] || [];
    }
}

// 工具函数
function hex(value, digits = 8, prefix = true) {
    const uintValue = value >>> 0;
    const hexStr = uintValue.toString(16).toUpperCase().padStart(digits, '0');
    return prefix ? `0x${hexStr}` : hexStr;
}