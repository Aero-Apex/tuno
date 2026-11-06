//go:build darwin

// Small helpers for talking to AppKit and WebKit through the Objective-C runtime (github.com/ebitengine/purego),
// without cgo. That's what lets Tuno for macOS be compiled on Windows or Linux as well as on a Mac.
package main

import (
	"structs"
	"sync"
	"unsafe"

	"github.com/ebitengine/purego"
	"github.com/ebitengine/purego/objc"
)

type nsPoint struct {
	_    structs.HostLayout
	X, Y float64
}

type nsSize struct {
	_             structs.HostLayout
	Width, Height float64
}

type nsRect struct {
	_      structs.HostLayout
	Origin nsPoint
	Size   nsSize
}

func rect(x, y, w, h float64) nsRect {
	return nsRect{Origin: nsPoint{X: x, Y: y}, Size: nsSize{Width: w, Height: h}}
}

func loadFrameworks() {
	for _, f := range []string{
		"/System/Library/Frameworks/Cocoa.framework/Cocoa",
		"/System/Library/Frameworks/WebKit.framework/WebKit",
	} {
		if _, err := purego.Dlopen(f, purego.RTLD_GLOBAL|purego.RTLD_NOW); err != nil {
			panic(err)
		}
	}
}

var (
	selMu    sync.Mutex
	selCache = map[string]objc.SEL{}
)

// sel returns the selector for name, registering it once.
func sel(name string) objc.SEL {
	selMu.Lock()
	defer selMu.Unlock()
	s, ok := selCache[name]
	if !ok {
		s = objc.RegisterName(name)
		selCache[name] = s
	}
	return s
}

func class(name string) objc.ID { return objc.ID(objc.GetClass(name)) }

// msg sends an Objective-C message that returns an object (or nothing).
func msg(id objc.ID, name string, args ...any) objc.ID { return id.Send(sel(name), args...) }

func msgBool(id objc.ID, name string, args ...any) bool {
	return objc.Send[bool](id, sel(name), args...)
}

func msgInt(id objc.ID, name string, args ...any) int { return objc.Send[int](id, sel(name), args...) }

// alloc + init in one go: newObject("NSAlert").
func newObject(className string) objc.ID { return msg(msg(class(className), "alloc"), "init") }

func nsString(s string) objc.ID { return msg(class("NSString"), "stringWithUTF8String:", s) }

func goString(id objc.ID) string {
	if id == 0 {
		return ""
	}
	return objc.Send[string](id, sel("UTF8String"))
}

func responds(id objc.ID, name string) bool {
	return id != 0 && msgBool(id, "respondsToSelector:", sel(name))
}

func isKind(id objc.ID, className string) bool {
	return id != 0 && msgBool(id, "isKindOfClass:", objc.GetClass(className))
}

// urlString returns an NSURL's absolute address.
func urlString(nsurl objc.ID) string {
	if nsurl == 0 {
		return ""
	}
	return goString(msg(nsurl, "absoluteString"))
}

func nsURL(s string) objc.ID { return msg(class("NSURL"), "URLWithString:", nsString(s)) }

// dataBytes copies the contents of an NSData.
func dataBytes(data objc.ID) []byte {
	n := msgInt(data, "length")
	if n <= 0 {
		return nil
	}
	ptr := objc.Send[unsafe.Pointer](data, sel("bytes"))
	return append([]byte(nil), unsafe.Slice((*byte)(ptr), n)...)
}

// callBlock calls a completion handler that WebKit passed in (decisionHandler and friends). Blocks made by
// Objective-C code aren't known to purego, so this calls the block's function directly: per the block ABI it sits
// 16 bytes in (after isa, flags and reserved), and takes the block itself as its first argument.
func callBlock(b objc.Block, args ...uintptr) {
	if b == 0 {
		return
	}
	invoke := *(*uintptr)(unsafe.Add(unsafe.Pointer(uintptr(b)), 16))
	purego.SyscallN(invoke, append([]uintptr{uintptr(b)}, args...)...)
}

func boolArg(b bool) uintptr {
	if b {
		return 1
	}
	return 0
}

// protocols looks up the named protocols, skipping any the runtime doesn't know.
func protocols(names ...string) []*objc.Protocol {
	var out []*objc.Protocol
	for _, n := range names {
		if p := objc.GetProtocol(n); p != nil {
			out = append(out, p)
		}
	}
	return out
}
