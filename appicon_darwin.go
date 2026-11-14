//go:build darwin

package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework AppKit
#include <stdlib.h>
#include <AppKit/AppKit.h>

static void SetLocknoteApplicationIcon(const void *data, int length) {
	NSData *imageData = [[NSData alloc] initWithBytes:data length:(NSUInteger)length];
	dispatch_async(dispatch_get_main_queue(), ^{
		@autoreleasepool {
			NSImage *image = [[NSImage alloc] initWithData:imageData];
			if (image != nil) {
				[[NSApplication sharedApplication] setApplicationIconImage:image];
				[image release];
			}
		}
	});
	[imageData release];
}
*/
import "C"

import (
	_ "embed"
	"unsafe"
)

// Wails dev 会复用 macOS 的应用包图标缓存。启动时显式设置一次，
// 让开发模式和正式打包都使用当前项目里的同一份图标。
//
//go:embed build/appicon.png
var applicationIconPNG []byte

func setApplicationIcon() {
	if len(applicationIconPNG) == 0 {
		return
	}
	C.SetLocknoteApplicationIcon(
		unsafe.Pointer(&applicationIconPNG[0]),
		C.int(len(applicationIconPNG)),
	)
}
