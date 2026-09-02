// Chinese font helper utilities used by the dynamic cracker UI.

class ChineseRenderer {
	constructor(gba) {
		this.gba = gba;
		this.mmu = gba.mmu;
		this.fontData = null;
		this.codeTable = new Map();
		this.reverseCodeTable = new Map();
		this.lastRender = null;
	}

	async loadFontFromBuffer(arrayBuffer) {
		this.fontData = new Uint8Array(arrayBuffer);
	}

	loadCodeTable(text) {
		this.codeTable.clear();
		this.reverseCodeTable.clear();
		const lines = text.split(/\r?\n/);
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) {
				continue;
			}
			const separator = trimmed.indexOf("=");
			if (separator <= 0) {
				continue;
			}
			const hex = trimmed.slice(0, separator);
			const value = trimmed.slice(separator + 1);
			const code = parseInt(hex, 16);
			if (!Number.isNaN(code) && value) {
				this.codeTable.set(code, value);
				if (value.length === 1 && !this.reverseCodeTable.has(value)) {
					this.reverseCodeTable.set(value, code >>> 0);
				}
			}
		}
		return this.codeTable.size;
	}

	encodeTextToBytes(text) {
		if (!text || !this.reverseCodeTable.size) {
			return null;
		}

		var out = [];
		for (const ch of text) {
			if (!this.reverseCodeTable.has(ch)) {
				return null;
			}
			var code = this.reverseCodeTable.get(ch) >>> 0;
			if (code <= 0xff) {
				out.push(code & 0xff);
			} else if (code <= 0xffff) {
				out.push((code >> 8) & 0xff);
				out.push(code & 0xff);
			} else {
				return null;
			}
		}
		return new Uint8Array(out);
	}

	hasCode(code) {
		return this.codeTable.has(code >>> 0);
	}

	static isChineseChar(currByte, nextByte, fontId, isJapanese) {
		if (isJapanese || fontId === 6) {
			return false;
		}
		return (
			currByte >= 0x01 &&
			currByte <= 0x1e &&
			currByte !== 0x06 &&
			currByte !== 0x1b &&
			typeof nextByte === "number" &&
			nextByte >= 0x00 &&
			nextByte <= 0xf6
		);
	}

	static isChinesePunctuation(byte, fontId, isJapanese) {
		if (isJapanese || fontId === 6) {
			return false;
		}
		return byte === 0x30 || (byte >= 0x36 && byte <= 0x3f && byte !== 0x38);
	}

	static isSmallFont(fontId) {
		return fontId === 1 || fontId === 2 || fontId === 4 || fontId === 5 || fontId === 7 || fontId === 8;
	}

	static composeChineseCode(highByte, lowByte) {
		return (((highByte & 0xff) << 8) | (lowByte & 0xff)) >>> 0;
	}

	static calculatePunctuationGlyphId(byte) {
		var value = byte & 0xff;
		if (value === 0x30) {
			return 0;
		}
		if (value >= 0x36 && value <= 0x3f && value !== 0x38) {
			return (value - 0x35) >>> 0;
		}
		return -1;
	}

	static calculateGlyphId(highByte, lowByte) {
		let hi = highByte & 0xff;
		let lo = lowByte & 0xff;
		if (hi > 0x1b) {
			hi -= 1;
		}
		if (hi > 0x06) {
			hi -= 1;
		}
		hi -= 1;
		return ((hi << 8) | lo) >>> 0;
	}

	getMetrics(fontId, punctuation, charCode) {
		var small = ChineseRenderer.isSmallFont(fontId);
		if (small) {
			var smallWidth = 10;
			if (punctuation) {
				if (charCode === 0x30 || (charCode >= 0x3a && charCode <= 0x3e)) {
					smallWidth = 5;
				} else if (charCode === 0x37) {
					smallWidth = 6;
				} else if (charCode === 0x39 || charCode === 0x3f) {
					smallWidth = 7;
				}
			}
			return {
				width: punctuation ? smallWidth : 10,
				height: 13,
				variant: punctuation ? "smallPunc" : "small"
			};
		}
		return {
			width: punctuation ? (charCode === 0x30 ? 7 : 12) : 12,
			height: 15,
			variant: punctuation ? "normalPunc" : "normal"
		};
	}

	readGlyphData(glyphId) {
		if (!this.fontData) {
			return null;
		}
		var offset = glyphId * 0x80;
		if (offset >= 0 && offset + 0x80 <= this.fontData.length) {
			return this.fontData.subarray(offset, offset + 0x80);
		}
		// Fallback for compact 1bpp-ish sources: promote 16-byte blocks into simple 4bpp tiles.
		offset = glyphId * 0x10;
		if (offset >= 0 && offset + 0x10 <= this.fontData.length) {
			return this._convert1bppBlockTo4bpp(this.fontData.subarray(offset, offset + 0x10));
		}
		return null;
	}

	_convert1bppBlockTo4bpp(src) {
		var out = new Uint8Array(0x80);
		for (var row = 0; row < 16 && row < src.length; row++) {
			var bits = src[row];
			for (var col = 0; col < 8; col++) {
				var on = (bits >> (7 - col)) & 1;
				var pixel = on ? 0x2 : 0x0;
				var tileX = col >= 4 ? 1 : 0;
				var tileY = row >= 8 ? 1 : 0;
				var tileIndex = tileY * 2 + tileX;
				var localRow = row & 0x7;
				var localCol = col & 0x3;
				var byteIndex = tileIndex * 0x20 + localRow * 4 + localCol;
				out[byteIndex] |= pixel << ((col & 1) ? 4 : 0);
			}
		}
		return out;
	}

	renderGlyphToVram(charCode, fontId, vramBase) {
		if (!this.fontData && this.fontData !== 0) {
			return false;
		}

		var glyphId;
		var punctuation = false;
		if (charCode <= 0xff) {
			if (!ChineseRenderer.isChinesePunctuation(charCode, fontId, false)) {
				return false;
			}
			glyphId = ChineseRenderer.calculatePunctuationGlyphId(charCode);
			if (glyphId < 0) {
				return false;
			}
			punctuation = true;
		} else {
			var hi = (charCode >> 8) & 0xff;
			var lo = charCode & 0xff;
			glyphId = ChineseRenderer.calculateGlyphId(hi, lo);
		}

		var glyph = this.readGlyphData(glyphId);
		if (!glyph) {
			return false;
		}

		for (var i = 0; i < 0x80; i++) {
			this.mmu.store8((vramBase + i) >>> 0, glyph[i]);
		}

		this.lastRender = {
			charCode: charCode >>> 0,
			fontId: fontId >>> 0,
			vramBase: vramBase >>> 0,
			glyphId: glyphId >>> 0,
			punctuation: punctuation
		};
		return true;
	}

	renderPreviewToVram() {
		if (!this.fontData) {
			return false;
		}

		const glyphIds = [0x2f, 0x30, 0x31, 0x32];
		const tileBase = 0x06000000 + 0x4000;
		const mapBase = 0x0600e800;

		for (let glyphIndex = 0; glyphIndex < glyphIds.length; glyphIndex++) {
			const glyph = this.readGlyphData(glyphIds[glyphIndex]);
			if (!glyph) {
				continue;
			}
			const tileIndexBase = 0x120 + glyphIndex * 4;
			const mapColumn = 2 + glyphIndex * 2;
			const mapRow = 16;

			for (let tileY = 0; tileY < 2; tileY++) {
				for (let tileX = 0; tileX < 2; tileX++) {
					const tileIndex = tileIndexBase + tileY * 2 + tileX;
					const tileAddr = tileBase + tileIndex * 0x20;

					for (let row = 0; row < 8; row++) {
						for (let col = 0; col < 4; col++) {
							const src = glyph[(tileY * 8 + row) * 8 + tileX * 4 + col];
							this.mmu.store8(tileAddr + row * 4 + col, src);
						}
					}

					const mapOffset = ((mapRow + tileY) * 32 + mapColumn + tileX) * 2;
					this.mmu.store16(mapBase + mapOffset, tileIndex);
				}
			}
		}

		return true;
	}
}
