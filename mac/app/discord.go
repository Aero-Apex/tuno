//go:build darwin

// Shows what Tuno is playing on the user's Discord profile ("Listening to Tuno"), the way Spotify does.
// It talks to the Discord desktop app over Discord's local socket, with the app's Client ID. No token or secret is
// needed, and nothing is sent anywhere except to the Discord app already running on this Mac.
// Same protocol as windows/Discord.cs: frames of [opcode int32 LE][length int32 LE][JSON].
package main

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"
)

const discordClientID = "1561445740109234301"

type discordPresence struct {
	work       chan func()
	conn       net.Conn
	retryAfter time.Time
	shown      bool
}

func newDiscord() *discordPresence {
	d := &discordPresence{work: make(chan func(), 16)}
	// All socket work happens on this goroutine, one piece after another, never on the main thread.
	go func() {
		for f := range d.work {
			f()
		}
	}()
	return d
}

func (d *discordPresence) queue(f func()) {
	select {
	case d.work <- f:
	default: // Discord is slow to answer: drop the update rather than block the window
	}
}

// Show displays "Listening to Tuno" with the track and a progress bar. Quietly does nothing when Discord isn't running.
func (d *discordPresence) Show(title, artist string, position, duration float64) {
	activity := map[string]any{"type": 2, "details": fit(title, "Tuno"), "instance": false}
	if artist != "" {
		activity["state"] = fit("by "+artist, "by Tuno")
	}
	if duration > 0 {
		start := time.Now().Unix() - int64(max(0, position))
		activity["timestamps"] = map[string]any{"start": start, "end": start + int64(duration)}
	}
	d.queue(func() { d.send(activity) })
}

// Clear removes the status.
func (d *discordPresence) Clear() {
	d.queue(func() { d.send(nil) })
}

func (d *discordPresence) send(activity map[string]any) {
	if activity == nil && !d.shown {
		return
	}
	if !d.connect() {
		return
	}
	frame := map[string]any{
		"cmd":   "SET_ACTIVITY",
		"args":  map[string]any{"pid": os.Getpid(), "activity": activity},
		"nonce": fmt.Sprint(time.Now().UnixNano()),
	}
	// Discord answers every command; the answer itself isn't needed.
	if d.write(1, frame) == nil && d.read() == nil {
		d.shown = activity != nil
	} else {
		d.drop()
	}
}

func (d *discordPresence) connect() bool {
	if d.conn != nil {
		return true
	}
	if time.Now().Before(d.retryAfter) {
		return false
	}
	var folders []string
	for _, k := range []string{"XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"} {
		if v := os.Getenv(k); v != "" {
			folders = append(folders, v)
		}
	}
	folders = append(folders, "/tmp")
	for _, folder := range folders {
		for i := range 10 {
			c, err := net.DialTimeout("unix", filepath.Join(folder, fmt.Sprintf("discord-ipc-%d", i)), time.Second)
			if err != nil {
				continue
			}
			d.conn = c
			if d.write(0, map[string]any{"v": 1, "client_id": discordClientID}) == nil && d.read() == nil { // READY
				return true
			}
			d.drop()
		}
	}
	// Discord isn't running. Look again in fifteen seconds, not on every track change.
	d.retryAfter = time.Now().Add(15 * time.Second)
	return false
}

func (d *discordPresence) write(op uint32, payload any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	buf := make([]byte, 8, 8+len(body))
	binary.LittleEndian.PutUint32(buf[0:], op)
	binary.LittleEndian.PutUint32(buf[4:], uint32(len(body)))
	_ = d.conn.SetDeadline(time.Now().Add(2 * time.Second))
	_, err = d.conn.Write(append(buf, body...))
	return err
}

func (d *discordPresence) read() error {
	head := make([]byte, 8)
	_ = d.conn.SetDeadline(time.Now().Add(2 * time.Second))
	if _, err := io.ReadFull(d.conn, head); err != nil {
		return err
	}
	n := binary.LittleEndian.Uint32(head[4:])
	if n > 1<<20 {
		return errors.New("discord sent an odd reply")
	}
	_, err := io.CopyN(io.Discard, d.conn, int64(n))
	return err
}

func (d *discordPresence) drop() {
	if d.conn != nil {
		d.conn.Close()
	}
	d.conn = nil
	d.shown = false
}

// fit keeps text within what Discord accepts (2 to 128 characters).
func fit(text, fallback string) string {
	t := strings.TrimSpace(text)
	if utf8.RuneCountInString(t) < 2 {
		t = fallback
	}
	if r := []rune(t); len(r) > 128 {
		t = string(r[:127]) + "…"
	}
	return t
}
