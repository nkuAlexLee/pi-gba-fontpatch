// Shared runtime text context for dynamic Chinese dispatch and width/glyph takeover.

class TextContext {
	constructor() {
		this.reset();
	}

	reset() {
		this.active = false;
		this.charCode = 0;
		this.isChinese = false;
		this.isPunctuation = false;
		this.fontId = 0;
		this.width = 0;
		this.height = 0;
		this.textPtr = 0;
		this.dispatchAddr = 0;
		this.observedAt = 0;
	}

	setChinese(options) {
		options = options || {};
		this.active = true;
		this.charCode = (options.charCode || 0) >>> 0;
		this.isChinese = true;
		this.isPunctuation = !!options.isPunctuation;
		this.fontId = (options.fontId || 0) >>> 0;
		this.width = (options.width || 0) >>> 0;
		this.height = (options.height || 0) >>> 0;
		this.textPtr = (options.textPtr || 0) >>> 0;
		this.dispatchAddr = (options.dispatchAddr || 0) >>> 0;
		this.observedAt = Date.now();
	}

	getSnapshot() {
		return {
			active: this.active,
			charCode: this.charCode,
			isChinese: this.isChinese,
			isPunctuation: this.isPunctuation,
			fontId: this.fontId,
			width: this.width,
			height: this.height,
			textPtr: this.textPtr,
			dispatchAddr: this.dispatchAddr,
			observedAt: this.observedAt
		};
	}
}
