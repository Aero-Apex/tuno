// A minimal Objective-C runtime bridge. Nothing is linked at build time: the runtime and the frameworks are opened
// when Tuno starts. That's what lets Tuno for macOS be built on Windows or Linux as well as on a Mac (no Xcode SDK).
#![allow(clippy::missing_safety_doc)]

use std::{
    ffi::{c_char, c_void, CStr, CString},
    sync::OnceLock,
};

pub type Id = *mut c_void;
pub type Sel = *const c_void;
pub const NIL: Id = std::ptr::null_mut();

extern "C" {
    fn dlopen(path: *const c_char, mode: i32) -> *mut c_void;
    fn dlsym(handle: *mut c_void, name: *const c_char) -> *mut c_void;
}
const RTLD_NOW: i32 = 0x2;
const RTLD_GLOBAL: i32 = 0x8;

struct Runtime {
    msg_send: usize,
    get_class: unsafe extern "C" fn(*const c_char) -> Id,
    register_name: unsafe extern "C" fn(*const c_char) -> Sel,
    allocate_class_pair: unsafe extern "C" fn(Id, *const c_char, usize) -> Id,
    register_class_pair: unsafe extern "C" fn(Id),
    add_method: unsafe extern "C" fn(Id, Sel, *const c_void, *const c_char) -> bool,
    get_protocol: unsafe extern "C" fn(*const c_char) -> Id,
    add_protocol: unsafe extern "C" fn(Id, Id) -> bool,
}

static RUNTIME: OnceLock<Runtime> = OnceLock::new();

fn rt() -> &'static Runtime {
    RUNTIME.get().expect("objc::load() first")
}

unsafe fn symbol(lib: *mut c_void, name: &str) -> *mut c_void {
    let c = CString::new(name).unwrap();
    let p = dlsym(lib, c.as_ptr());
    assert!(!p.is_null(), "missing {name}");
    p
}

/// Opens the Objective-C runtime, AppKit and WebKit.
pub unsafe fn load() {
    for f in ["/System/Library/Frameworks/Cocoa.framework/Cocoa", "/System/Library/Frameworks/WebKit.framework/WebKit"] {
        let c = CString::new(f).unwrap();
        assert!(!dlopen(c.as_ptr(), RTLD_NOW | RTLD_GLOBAL).is_null(), "can't open {f}");
    }
    let path = CString::new("/usr/lib/libobjc.A.dylib").unwrap();
    let lib = dlopen(path.as_ptr(), RTLD_NOW | RTLD_GLOBAL);
    assert!(!lib.is_null(), "can't open the Objective-C runtime");
    let _ = RUNTIME.set(Runtime {
        msg_send: symbol(lib, "objc_msgSend") as usize,
        get_class: std::mem::transmute(symbol(lib, "objc_getClass")),
        register_name: std::mem::transmute(symbol(lib, "sel_registerName")),
        allocate_class_pair: std::mem::transmute(symbol(lib, "objc_allocateClassPair")),
        register_class_pair: std::mem::transmute(symbol(lib, "objc_registerClassPair")),
        add_method: std::mem::transmute(symbol(lib, "class_addMethod")),
        get_protocol: std::mem::transmute(symbol(lib, "objc_getProtocol")),
        add_protocol: std::mem::transmute(symbol(lib, "class_addProtocol")),
    });
}

pub fn class(name: &str) -> Id {
    let c = CString::new(name).unwrap();
    unsafe { (rt().get_class)(c.as_ptr()) }
}

pub fn sel(name: &str) -> Sel {
    let c = CString::new(name).unwrap();
    unsafe { (rt().register_name)(c.as_ptr()) }
}

/// The arguments of a message, as a tuple: () or (a,) or (a, b) and so on. Each call site's types decide the
/// C signature objc_msgSend is called with, as Objective-C's compiler would.
pub trait Args {
    unsafe fn send<R>(self, f: usize, obj: Id, sel: Sel) -> R;
}

macro_rules! args {
    ($($name:ident),*) => {
        impl<$($name: Copy),*> Args for ($($name,)*) {
            #[allow(non_snake_case)]
            unsafe fn send<R>(self, f: usize, obj: Id, sel: Sel) -> R {
                let ($($name,)*) = self;
                let f: unsafe extern "C" fn(Id, Sel $(, $name)*) -> R = std::mem::transmute_copy(&f);
                f(obj, sel $(, $name)*)
            }
        }
    };
}
args!();
args!(A);
args!(A, B);
args!(A, B, C);
args!(A, B, C, D);
args!(A, B, C, D, E);

/// Sends a message: `send::<Id>(obj, "title", ())`, `send::<()>(window, "setTitle:", (s,))`.
pub unsafe fn send<R>(obj: Id, name: &str, args: impl Args) -> R {
    args.send(rt().msg_send, obj, sel(name))
}

pub fn new_object(class_name: &str) -> Id {
    unsafe { send(send::<Id>(class(class_name), "alloc", ()), "init", ()) }
}

pub fn ns_string(s: &str) -> Id {
    let c = CString::new(s.replace('\0', "")).unwrap();
    unsafe { send(class("NSString"), "stringWithUTF8String:", (c.as_ptr(),)) }
}

pub fn to_string(s: Id) -> String {
    if s.is_null() {
        return String::new();
    }
    unsafe {
        let p: *const c_char = send(s, "UTF8String", ());
        if p.is_null() {
            String::new()
        } else {
            CStr::from_ptr(p).to_string_lossy().into_owned()
        }
    }
}

pub fn responds(obj: Id, name: &str) -> bool {
    !obj.is_null() && unsafe { send::<bool>(obj, "respondsToSelector:", (sel(name),)) }
}

pub fn is_kind(obj: Id, class_name: &str) -> bool {
    !obj.is_null() && unsafe { send::<bool>(obj, "isKindOfClass:", (class(class_name),)) }
}

pub fn url_string(nsurl: Id) -> String {
    if nsurl.is_null() {
        return String::new();
    }
    to_string(unsafe { send(nsurl, "absoluteString", ()) })
}

pub fn ns_url(s: &str) -> Id {
    unsafe { send(class("NSURL"), "URLWithString:", (ns_string(s),)) }
}

/// The bytes of an NSData.
pub fn data_bytes(data: Id) -> Vec<u8> {
    unsafe {
        let len: usize = send(data, "length", ());
        let ptr: *const u8 = send(data, "bytes", ());
        if ptr.is_null() || len == 0 {
            return Vec::new();
        }
        std::slice::from_raw_parts(ptr, len).to_vec()
    }
}

// Completion handlers (blocks) that AppKit and WebKit pass in. Per the block ABI the function sits two pointers in
// (after isa, and the flags and reserved words), and takes the block itself as its first argument.
pub unsafe fn call_block_0(block: Id) {
    if block.is_null() {
        return;
    }
    let f: unsafe extern "C" fn(Id) = std::mem::transmute(*(block as *const usize).add(2));
    f(block)
}

pub unsafe fn call_block_1<A: Copy>(block: Id, a: A) {
    if block.is_null() {
        return;
    }
    let f: unsafe extern "C" fn(Id, A) = std::mem::transmute_copy(&*(block as *const usize).add(2));
    f(block, a)
}

/// Makes an Objective-C class whose methods are Rust functions. `methods` are (selector, function, type encoding).
pub unsafe fn make_class(name: &str, superclass: &str, protocols: &[&str], methods: &[(&str, *const c_void, &str)]) -> Id {
    let c = CString::new(name).unwrap();
    let cls = (rt().allocate_class_pair)(class(superclass), c.as_ptr(), 0);
    assert!(!cls.is_null(), "can't make class {name}");
    for p in protocols {
        let pc = CString::new(*p).unwrap();
        let proto = (rt().get_protocol)(pc.as_ptr());
        if !proto.is_null() {
            (rt().add_protocol)(cls, proto);
        }
    }
    for (selector, imp, types) in methods {
        let t = CString::new(*types).unwrap();
        (rt().add_method)(cls, sel(selector), *imp, t.as_ptr());
    }
    (rt().register_class_pair)(cls);
    cls
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct NSPoint {
    pub x: f64,
    pub y: f64,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct NSSize {
    pub width: f64,
    pub height: f64,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct NSRect {
    pub origin: NSPoint,
    pub size: NSSize,
}

pub fn rect(x: f64, y: f64, w: f64, h: f64) -> NSRect {
    NSRect { origin: NSPoint { x, y }, size: NSSize { width: w, height: h } }
}

/// BOOL's type encoding: a C bool on Apple Silicon, a signed char on Intel.
#[cfg(target_arch = "aarch64")]
pub const BOOL_ENC: &str = "B";
#[cfg(not(target_arch = "aarch64"))]
pub const BOOL_ENC: &str = "c";
