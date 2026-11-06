// Turns the two macOS builds of Tuno (Apple Silicon and Intel) into Tuno.app and zips it. It runs anywhere Rust runs,
// so the Mac app can be made on Windows or Linux:
//
//   cargo run --release --manifest-path desktop/pack/Cargo.toml -- <version> <arm64 build> <x86_64 build> <icon.png> <Info.plist> <out dir>
//
// It joins the builds into one universal binary, makes the Dock icon (.icns) from a 512 px PNG, writes Info.plist,
// and zips the bundle keeping the executable permission (so the app opens after unzipping).
use std::{fs, io::Write, path::Path};

use zip::{write::SimpleFileOptions, CompressionMethod, System, ZipWriter};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [version, arm64, x86_64, icon, plist, out] = &args[..] else {
        eprintln!("usage: pack <version> <arm64 build> <x86_64 build> <icon.png> <Info.plist template> <out dir>");
        std::process::exit(2);
    };
    let binary = universal(&[arm64, x86_64]).unwrap_or_else(|e| fail(&e));
    let icns = make_icns(icon).unwrap_or_else(|e| fail(&e));
    let info = fs::read_to_string(plist).unwrap_or_else(|e| fail(&e.to_string())).replace("__VERSION__", version);

    fs::create_dir_all(out).unwrap_or_else(|e| fail(&e.to_string()));
    let zip_path = Path::new(out).join(format!("Tuno-{version}-mac.zip"));
    let files: [(&str, &[u8], u32); 4] = [
        ("Tuno.app/Contents/Info.plist", info.as_bytes(), 0o644),
        ("Tuno.app/Contents/PkgInfo", b"APPL????", 0o644),
        ("Tuno.app/Contents/MacOS/Tuno", &binary, 0o755),
        ("Tuno.app/Contents/Resources/Tuno.icns", &icns, 0o644),
    ];
    write_zip(&zip_path, &files).unwrap_or_else(|e| fail(&e.to_string()));
    let size = fs::metadata(&zip_path).map(|m| m.len()).unwrap_or(0);
    println!("==> Built Tuno {version} for macOS: {} ({} KB)", zip_path.display(), size / 1024);
}

fn fail(message: &str) -> ! {
    eprintln!("pack: {message}");
    std::process::exit(1);
}

// ---- universal binary ----

const CPU_ARM64: u32 = 0x0100_000C;
const LC_CODE_SIGNATURE: u32 = 0x1d;

fn u32le(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([b[at], b[at + 1], b[at + 2], b[at + 3]])
}

/// Joins thin Mach-O files into a fat one. Each slice keeps its own code signature (the linker signs Apple Silicon
/// builds, which is what lets them run there at all).
fn universal(paths: &[&String]) -> Result<Vec<u8>, String> {
    let mut slices = Vec::new();
    for p in paths {
        let data = fs::read(p).map_err(|e| format!("{p}: {e}"))?;
        if data.len() < 32 || u32le(&data, 0) != 0xfeed_facf {
            return Err(format!("{p} isn't a 64-bit Mach-O file"));
        }
        let (cpu, sub) = (u32le(&data, 4), u32le(&data, 8));
        let ncmds = u32le(&data, 16) as usize;
        let mut at = 32;
        let mut signed = false;
        for _ in 0..ncmds {
            if at + 8 > data.len() {
                break;
            }
            if u32le(&data, at) == LC_CODE_SIGNATURE {
                signed = true;
            }
            at += u32le(&data, at + 4) as usize;
        }
        let align = if cpu == CPU_ARM64 { 14 } else { 12 }; // 16 KB pages on Apple Silicon, 4 KB on Intel
        if cpu == CPU_ARM64 && !signed {
            return Err(format!("{p}: the arm64 build has no code signature, so Apple Silicon Macs won't run it"));
        }
        println!("    {} slice: {} KB, signed: {signed}", if cpu == CPU_ARM64 { "arm64" } else { "x86_64" }, data.len() / 1024);
        slices.push((data, cpu, sub, align));
    }

    let mut header = Vec::new();
    header.extend_from_slice(&0xcafe_babeu32.to_be_bytes()); // FAT_MAGIC
    header.extend_from_slice(&(slices.len() as u32).to_be_bytes());
    let mut offset = 8 + 20 * slices.len() as u32;
    let mut offsets = Vec::new();
    for (data, cpu, sub, align) in &slices {
        let a = 1u32 << align;
        offset = (offset + a - 1) & !(a - 1);
        offsets.push(offset);
        for v in [*cpu, *sub, offset, data.len() as u32, *align] {
            header.extend_from_slice(&v.to_be_bytes());
        }
        offset += data.len() as u32;
    }
    let mut out = header;
    for ((data, ..), at) in slices.iter().zip(offsets) {
        out.resize(at as usize, 0);
        out.extend_from_slice(data);
    }
    Ok(out)
}

// ---- icon ----

struct Image {
    size: usize,
    rgba: Vec<u8>,
}

fn load_png(path: &str) -> Result<Image, String> {
    let file = fs::File::open(path).map_err(|e| format!("{path}: {e}"))?;
    let mut decoder = png::Decoder::new(std::io::BufReader::new(file));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder.read_info().map_err(|e| e.to_string())?;
    let mut buf = vec![0; reader.output_buffer_size().ok_or("the icon is too large")?];
    let info = reader.next_frame(&mut buf).map_err(|e| e.to_string())?;
    if info.width != info.height {
        return Err("the icon must be square".into());
    }
    let pixels = (info.width * info.height) as usize;
    let rgba = match info.color_type {
        png::ColorType::Rgba => buf[..pixels * 4].to_vec(),
        png::ColorType::Rgb => buf[..pixels * 3].chunks(3).flat_map(|c| [c[0], c[1], c[2], 255]).collect(),
        png::ColorType::GrayscaleAlpha => buf[..pixels * 2].chunks(2).flat_map(|c| [c[0], c[0], c[0], c[1]]).collect(),
        png::ColorType::Grayscale => buf[..pixels].iter().flat_map(|&g| [g, g, g, 255]).collect(),
        png::ColorType::Indexed => return Err("unexpected indexed PNG".into()),
    };
    Ok(Image { size: info.width as usize, rgba })
}

/// Halves an image, averaging each 2x2 block (weighted by alpha, so edges don't darken).
fn half(img: &Image) -> Image {
    let s = img.size / 2;
    let mut rgba = vec![0u8; s * s * 4];
    for y in 0..s {
        for x in 0..s {
            let (mut r, mut g, mut b, mut a) = (0u32, 0u32, 0u32, 0u32);
            for (dx, dy) in [(0, 0), (1, 0), (0, 1), (1, 1)] {
                let i = ((2 * y + dy) * img.size + 2 * x + dx) * 4;
                let al = img.rgba[i + 3] as u32;
                r += img.rgba[i] as u32 * al;
                g += img.rgba[i + 1] as u32 * al;
                b += img.rgba[i + 2] as u32 * al;
                a += al;
            }
            if a > 0 {
                let o = (y * s + x) * 4;
                rgba[o..o + 4].copy_from_slice(&[(r / a) as u8, (g / a) as u8, (b / a) as u8, (a / 4) as u8]);
            }
        }
    }
    Image { size: s, rgba }
}

fn encode_png(img: &Image) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let mut enc = png::Encoder::new(&mut out, img.size as u32, img.size as u32);
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Eight);
    let mut w = enc.write_header().map_err(|e| e.to_string())?;
    w.write_image_data(&img.rgba).map_err(|e| e.to_string())?;
    w.finish().map_err(|e| e.to_string())?;
    Ok(out)
}

/// An .icns file with PNG images from 16 to 512 pixels (and their Retina versions).
fn make_icns(path: &str) -> Result<Vec<u8>, String> {
    let mut sizes = std::collections::HashMap::new();
    let mut img = load_png(path)?;
    while img.size >= 16 {
        let next = half(&img);
        sizes.insert(img.size, encode_png(&img)?);
        img = next;
    }
    let types = [
        ("icp4", 16),
        ("icp5", 32),
        ("icp6", 64),
        ("ic07", 128),
        ("ic08", 256),
        ("ic09", 512),
        ("ic11", 32),
        ("ic12", 64),
        ("ic13", 256),
        ("ic14", 512),
    ];
    let mut body = Vec::new();
    for (code, size) in types {
        if let Some(png) = sizes.get(&size) {
            body.extend_from_slice(code.as_bytes());
            body.extend_from_slice(&(8 + png.len() as u32).to_be_bytes());
            body.extend_from_slice(png);
        }
    }
    let mut out = b"icns".to_vec();
    out.extend_from_slice(&(8 + body.len() as u32).to_be_bytes());
    out.extend_from_slice(&body);
    Ok(out)
}

// ---- zip ----

fn write_zip(path: &Path, files: &[(&str, &[u8], u32)]) -> zip::result::ZipResult<()> {
    let mut zip = ZipWriter::new(fs::File::create(path)?);
    // Folders first, so Archive Utility recreates them with the right permissions.
    let mut dirs: Vec<String> = Vec::new();
    for (name, ..) in files {
        let mut d = Path::new(name).parent();
        while let Some(p) = d.filter(|p| !p.as_os_str().is_empty()) {
            let s = p.to_string_lossy().replace('\\', "/");
            if !dirs.contains(&s) {
                dirs.push(s);
            }
            d = p.parent();
        }
    }
    dirs.sort_by_key(|d| (d.len(), d.clone()));
    for d in dirs {
        zip.add_directory(d, SimpleFileOptions::default().system(System::Unix).unix_permissions(0o755))?;
    }
    for (name, data, mode) in files {
        // Unix permissions are stored, so the app's executable stays executable.
        zip.start_file(*name, SimpleFileOptions::default().system(System::Unix).compression_method(CompressionMethod::Deflated).unix_permissions(*mode))?;
        zip.write_all(data)?;
    }
    zip.finish()?;
    Ok(())
}
