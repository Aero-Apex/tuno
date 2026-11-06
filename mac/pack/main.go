// Command pack turns the two Mac builds of Tuno (Apple Silicon and Intel) into Tuno.app and zips it.
// It runs anywhere Go runs, so the Mac app can be made on Windows or Linux:
//
//	go run ./pack -version 1.2.0 -arm64 obj/tuno-arm64 -amd64 obj/tuno-amd64 -out dist
//
// It merges the builds into one universal binary, makes the Dock icon (.icns) from the web app's icon,
// writes Info.plist, and zips the bundle keeping the executable permission (so it opens after unzipping).
package main

import (
	"archive/zip"
	"bytes"
	"debug/macho"
	"encoding/binary"
	"flag"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"
)

func main() {
	version := flag.String("version", "", "app version, e.g. 1.2.0")
	arm64 := flag.String("arm64", "", "darwin/arm64 build")
	amd64 := flag.String("amd64", "", "darwin/amd64 build")
	icon := flag.String("icon", "../web/public/icon-512.png", "512x512 PNG icon")
	plist := flag.String("plist", "Info.plist", "Info.plist template (__VERSION__ is replaced)")
	out := flag.String("out", "dist", "output folder")
	flag.Parse()
	if *version == "" || *arm64 == "" || *amd64 == "" {
		flag.Usage()
		os.Exit(2)
	}

	binary, err := universal(*arm64, *amd64)
	check(err)
	icns, err := makeIcns(*icon)
	check(err)
	tmpl, err := os.ReadFile(*plist)
	check(err)
	info := strings.ReplaceAll(string(tmpl), "__VERSION__", *version)

	files := []entry{
		{"Tuno.app/Contents/Info.plist", []byte(info), 0o644},
		{"Tuno.app/Contents/PkgInfo", []byte("APPL????"), 0o644},
		{"Tuno.app/Contents/MacOS/Tuno", binary, 0o755},
		{"Tuno.app/Contents/Resources/Tuno.icns", icns, 0o644},
	}
	check(os.MkdirAll(*out, 0o755))
	zipPath := filepath.Join(*out, fmt.Sprintf("Tuno-%s-mac.zip", *version))
	check(writeZip(zipPath, files))
	fmt.Printf("==> Built Tuno %s for macOS: %s (%d KB)\n", *version, zipPath, fileSize(zipPath)/1024)
}

type entry struct {
	name string
	data []byte
	mode os.FileMode
}

// ---- universal binary ----

// universal joins two thin Mach-O files into a fat one. Each slice keeps its own code signature
// (Go's linker signs Apple Silicon builds itself, which is what lets them run).
func universal(paths ...string) ([]byte, error) {
	type slice struct {
		data           []byte
		cpu, subCPU    uint32
		align          uint32
		signed         bool
		cpuName, label string
	}
	var slices []slice
	for _, p := range paths {
		data, err := os.ReadFile(p)
		if err != nil {
			return nil, err
		}
		f, err := macho.NewFile(bytes.NewReader(data))
		if err != nil {
			return nil, fmt.Errorf("%s: %w", p, err)
		}
		signed := false
		for _, l := range f.Loads {
			if raw := l.Raw(); len(raw) >= 4 && f.ByteOrder.Uint32(raw) == 0x1d { // LC_CODE_SIGNATURE
				signed = true
			}
		}
		align := uint32(12) // 4 KB pages on Intel
		if f.Cpu == macho.CpuArm64 {
			align = 14 // 16 KB pages on Apple Silicon
			if !signed {
				return nil, fmt.Errorf("%s: the arm64 build has no code signature, so Apple Silicon Macs won't run it", p)
			}
		}
		slices = append(slices, slice{data: data, cpu: uint32(f.Cpu), subCPU: f.SubCpu, align: align, signed: signed, cpuName: f.Cpu.String(), label: p})
		f.Close()
	}

	var buf bytes.Buffer
	be := binary.BigEndian
	header := make([]byte, 8+20*len(slices))
	be.PutUint32(header[0:], 0xcafebabe) // FAT_MAGIC
	be.PutUint32(header[4:], uint32(len(slices)))
	offset := uint32(len(header))
	offsets := make([]uint32, len(slices))
	for i, s := range slices {
		a := uint32(1) << s.align
		offset = (offset + a - 1) &^ (a - 1)
		offsets[i] = offset
		at := 8 + 20*i
		be.PutUint32(header[at:], s.cpu)
		be.PutUint32(header[at+4:], s.subCPU)
		be.PutUint32(header[at+8:], offset)
		be.PutUint32(header[at+12:], uint32(len(s.data)))
		be.PutUint32(header[at+16:], s.align)
		offset += uint32(len(s.data))
		fmt.Printf("    %s slice: %d KB, signed: %v\n", s.cpuName, len(s.data)/1024, s.signed)
	}
	buf.Write(header)
	for i, s := range slices {
		buf.Write(make([]byte, int(offsets[i])-buf.Len()))
		buf.Write(s.data)
	}
	return buf.Bytes(), nil
}

// ---- icon ----

// makeIcns builds an .icns file with PNG images from 16 to 512 pixels (and their Retina versions).
func makeIcns(path string) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	src, err := png.Decode(f)
	if err != nil {
		return nil, err
	}
	sizes := map[int]image.Image{}
	img := toNRGBA(src)
	for size := img.Bounds().Dx(); size >= 16; size /= 2 {
		sizes[size] = img
		img = half(img)
	}
	types := []struct {
		code string
		size int
	}{
		{"icp4", 16}, {"icp5", 32}, {"icp6", 64}, {"ic07", 128}, {"ic08", 256}, {"ic09", 512},
		{"ic11", 32}, {"ic12", 64}, {"ic13", 256}, {"ic14", 512},
	}
	var body bytes.Buffer
	for _, t := range types {
		im, ok := sizes[t.size]
		if !ok {
			continue
		}
		var p bytes.Buffer
		if err := png.Encode(&p, im); err != nil {
			return nil, err
		}
		body.WriteString(t.code)
		binary.Write(&body, binary.BigEndian, uint32(8+p.Len()))
		body.Write(p.Bytes())
	}
	var out bytes.Buffer
	out.WriteString("icns")
	binary.Write(&out, binary.BigEndian, uint32(8+body.Len()))
	out.Write(body.Bytes())
	return out.Bytes(), nil
}

func toNRGBA(src image.Image) *image.NRGBA {
	b := src.Bounds()
	dst := image.NewNRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	for y := 0; y < b.Dy(); y++ {
		for x := 0; x < b.Dx(); x++ {
			dst.Set(x, y, src.At(b.Min.X+x, b.Min.Y+y))
		}
	}
	return dst
}

// half scales an image down by two, averaging each 2x2 block (weighted by alpha, so edges don't darken).
func half(src *image.NRGBA) *image.NRGBA {
	w, h := src.Bounds().Dx()/2, src.Bounds().Dy()/2
	dst := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			var r, g, b, a uint32
			for dy := 0; dy < 2; dy++ {
				for dx := 0; dx < 2; dx++ {
					c := src.NRGBAAt(2*x+dx, 2*y+dy)
					al := uint32(c.A)
					r += uint32(c.R) * al
					g += uint32(c.G) * al
					b += uint32(c.B) * al
					a += al
				}
			}
			if a == 0 {
				continue
			}
			dst.SetNRGBA(x, y, color.NRGBA{R: uint8(r / a), G: uint8(g / a), B: uint8(b / a), A: uint8(a / 4)})
		}
	}
	return dst
}

// ---- zip ----

func writeZip(path string, files []entry) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer f.Close()
	w := zip.NewWriter(f)
	now := time.Now()
	dirs := map[string]bool{}
	for _, e := range files {
		// Folders first, so Archive Utility recreates them with the right permissions.
		for d := filepath.ToSlash(filepath.Dir(e.name)); d != "." && !dirs[d]; d = filepath.ToSlash(filepath.Dir(d)) {
			dirs[d] = true
		}
	}
	for _, d := range sortedDirs(dirs) {
		h := &zip.FileHeader{Name: d + "/", Modified: now}
		h.SetMode(os.ModeDir | 0o755)
		if _, err := w.CreateHeader(h); err != nil {
			return err
		}
	}
	for _, e := range files {
		h := &zip.FileHeader{Name: e.name, Method: zip.Deflate, Modified: now}
		h.SetMode(e.mode) // stores Unix permissions, so the app's executable stays executable
		fw, err := w.CreateHeader(h)
		if err != nil {
			return err
		}
		if _, err := fw.Write(e.data); err != nil {
			return err
		}
	}
	return w.Close()
}

func sortedDirs(m map[string]bool) []string {
	var out []string
	for d := range m {
		out = append(out, d)
	}
	// Parents before children: shorter paths first, then alphabetical.
	for i := range out {
		for j := i + 1; j < len(out); j++ {
			if len(out[j]) < len(out[i]) || (len(out[j]) == len(out[i]) && out[j] < out[i]) {
				out[i], out[j] = out[j], out[i]
			}
		}
	}
	return out
}

func fileSize(p string) int64 {
	st, err := os.Stat(p)
	if err != nil {
		return 0
	}
	return st.Size()
}

func check(err error) {
	if err != nil {
		log.Fatal(err)
	}
}
