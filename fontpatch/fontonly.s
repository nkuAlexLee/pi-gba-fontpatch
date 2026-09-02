.gba
.open "er_base.gba", "er_fontonly.gba", 0x08000000
.org 0x0968A4D8
	.incbin	"er_font.bin"
.close
