// Runtime width override helper backed by the shared TextContext.

class WidthPatcher {
	constructor(textContext) {
		this.textContext = textContext;
		this.widthMode = "absolute";
	}

	setWidthMode(mode) {
		this.widthMode = mode || "absolute";
	}

	getPatchedWidth(originalWidth) {
		if (!this.textContext || !this.textContext.active || !this.textContext.isChinese) {
			return originalWidth;
		}
		if (this.widthMode === "delta") {
			return (originalWidth + this.textContext.width) >>> 0;
		}
		return this.textContext.width >>> 0;
	}

	getSnapshot() {
		return {
			widthMode: this.widthMode,
			context: this.textContext ? this.textContext.getSnapshot() : null
		};
	}
}
