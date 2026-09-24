/* SPDX-License-Identifier: GPL-2.0-or-later WITH GStreamer-exception-2008
 * SPDX-FileCopyrightText: 2011 Red Hat, Inc. (original src/viewers/image.js)
 * SPDX-FileCopyrightText: 2026 Erick Salamanca (RAW adaptation)
 *
 * Full-resolution RAW image preview for GNOME Sushi (Space key in
 * Nautilus), from the largest preview embedded in the RAW file, extracted
 * with exiv2. Self-contained: it runs exiv2 itself and never touches the
 * grid thumbnailer's script, so it installs alongside
 * https://github.com/emuskardin/nautilus-raw-thumbnails without either
 * one overwriting the other.
 *
 * Based on GNOME Sushi's built-in src/viewers/image.js (tested against
 * gnome-sushi 50.0 - the legacy GTK3/GJS-`imports` plugin API, loaded from
 * ~/.local/share/sushi/viewers/*.js). See README for compatibility notes
 * on newer Sushi versions (>=51, GTK4/Adwaita/Glycin rewrite, different
 * plugin API in ~/.local/share/sushi/plugins-1/).
 */

const {Gdk, GdkPixbuf, Gio, GLib, GObject, Gtk} = imports.gi;

const Renderer = imports.ui.renderer;

// EXIF orientation (1-8) -> the transform that displays the image upright;
// same mapping as gdk_pixbuf_apply_embedded_orientation() and as
// ImageMagick's -flop/-flip/-transpose/-transverse in the upstream script.
function applyOrientation(pix, orientation) {
    const R = GdkPixbuf.PixbufRotation;
    switch (orientation) {
    case 2: return pix.flip(true);
    case 3: return pix.rotate_simple(R.UPSIDEDOWN);
    case 4: return pix.flip(false);
    case 5: return pix.rotate_simple(R.CLOCKWISE).flip(true);
    case 6: return pix.rotate_simple(R.CLOCKWISE);
    case 7: return pix.rotate_simple(R.COUNTERCLOCKWISE).flip(true);
    case 8: return pix.rotate_simple(R.COUNTERCLOCKWISE);
    default: return pix;
    }
}

var Klass = GObject.registerClass({
    Implements: [Renderer.Renderer],
    Properties: {
        fullscreen: GObject.ParamSpec.boolean('fullscreen', '', '',
                                              GObject.ParamFlags.READABLE,
                                              false),
        ready: GObject.ParamSpec.boolean('ready', '', '',
                                         GObject.ParamFlags.READABLE,
                                         false)
    },
}, class RawImageRenderer extends Gtk.DrawingArea {
    get ready() {
        return !!this._ready;
    }

    get fullscreen() {
        return !!this._fullscreen;
    }

    _init(file) {
        super._init();

        this._cancellable = new Gio.Cancellable();

        this._pix = null;
        this._scaledSurface = null;
        this._tmpDir = null;

        this._extractPreview(file);

        this.connect('destroy', this._onDestroy.bind(this));
    }

    vfunc_get_preferred_width() {
        return [1, this._pix ? this._pix.get_width() : 1];
    }

    vfunc_get_preferred_height() {
        return [1, this._pix ? this._pix.get_height() : 1];
    }

    vfunc_size_allocate(allocation) {
        super.vfunc_size_allocate(allocation);
        this._ensureScaledPix();
    }

    vfunc_draw(context) {
        if (!this._scaledSurface)
            return false;

        let width = this.get_allocated_width();
        let height = this.get_allocated_height();

        let scaleFactor = this.get_scale_factor();
        let offsetX = (width - this._scaledSurface.getWidth() / scaleFactor) / 2;
        let offsetY = (height - this._scaledSurface.getHeight() / scaleFactor) / 2;

        context.setSourceSurface(this._scaledSurface, offsetX, offsetY);
        context.paint();
        return false;
    }

    async _extractPreview(file) {
        let inPath = file.get_path();
        if (!inPath) {
            this.emit('error', new GLib.Error(
                Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_SUPPORTED,
                'RAW preview requires a local file'));
            return;
        }

        try {
            this._tmpDir = GLib.dir_make_tmp('sushi-raw-XXXXXX');
            let pix = await this._loadPreview(inPath);
            this._setPix(pix);
        } catch (e) {
            if (!e.matches || !e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                this.emit('error', e);
        } finally {
            this._cleanupTmpDir();
        }
    }

    async _loadPreview(inPath) {
        // exiv2 lists previews smallest first, but pick by pixel count
        // rather than trust the order: cameras often embed a tiny
        // thumbnail next to a near-full-size JPEG, and only the latter is
        // worth showing here.
        let listing = await this._run(['exiv2', '-pp', inPath], true);
        let best = null;
        for (let line of listing.split('\n')) {
            let m = line.match(/^Preview (\d+): ([^,]+), (\d+)x(\d+) pixels/);
            if (!m)
                continue;
            let preview = {index: m[1], mime: m[2], pixels: Number(m[3]) * Number(m[4])};
            if (!best || preview.pixels > best.pixels)
                best = preview;
        }
        if (!best)
            throw this._failed('No embedded preview found in RAW file');

        // Written as <basename>-preview<N>.<ext> into our own tmp dir,
        // never the caller's cwd (which may be read-only).
        await this._run(['exiv2', `-ep${best.index}`, '-l', this._tmpDir, inPath]);
        let previewPath = this._findExtracted(`-preview${best.index}.`);
        if (!previewPath)
            throw this._failed('exiv2 did not write the embedded preview');

        // gdk-pixbuf loads the usual JPEG preview directly. Others (e.g.
        // the uncompressed TIFF previews in phone DNGs) it may reject, so
        // those go through ImageMagick first — to JPEG, not PNG: encoding
        // a 50 MP PNG takes ~9 s, a JPEG ~1 s.
        if (best.mime !== 'image/jpeg') {
            let magick = GLib.find_program_in_path('magick') || GLib.find_program_in_path('convert');
            if (magick) {
                let jpegPath = GLib.build_filenamev([this._tmpDir, 'preview.jpg']);
                await this._run([magick, previewPath, '-quality', '92', jpegPath]);
                previewPath = jpegPath;
            }
        }

        let pix = await this._loadPixbuf(previewPath);
        return applyOrientation(pix, await this._readOrientation(inPath));
    }

    // The orientation that matters is the RAW's own: the extracted preview
    // usually carries none (or a stale one), which is also why the
    // preview's embedded tag is deliberately ignored after loading.
    async _readOrientation(inPath) {
        try {
            let out = await this._run(['exiv2', '-K', 'Exif.Image.Orientation', '-Pv', inPath], true);
            let value = parseInt(out, 10);
            if (value >= 1 && value <= 8)
                return value;
        } catch (e) {
            if (this._cancellable.is_cancelled())
                throw e;
        }
        // exiftool also knows maker-specific locations exiv2 doesn't
        // expose under that key. Optional, like the upstream thumbnailer.
        if (GLib.find_program_in_path('exiftool')) {
            try {
                let out = await this._run(['exiftool', '-s3', '-n', '-Orientation', inPath], true);
                let value = parseInt(out, 10);
                if (value >= 1 && value <= 8)
                    return value;
            } catch (e) {
                if (this._cancellable.is_cancelled())
                    throw e;
            }
        }
        return 1;
    }

    _findExtracted(marker) {
        let enumerator = Gio.File.new_for_path(this._tmpDir).enumerate_children(
            'standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = enumerator.next_file(null))) {
            if (info.get_name().includes(marker))
                return GLib.build_filenamev([this._tmpDir, info.get_name()]);
        }
        return null;
    }

    _run(argv, captureStdout = false) {
        return new Promise((resolve, reject) => {
            let flags = Gio.SubprocessFlags.STDERR_SILENCE |
                (captureStdout ? Gio.SubprocessFlags.STDOUT_PIPE : Gio.SubprocessFlags.STDOUT_SILENCE);
            let proc;
            try {
                proc = Gio.Subprocess.new(argv, flags);
            } catch (e) {
                reject(e);
                return;
            }
            proc.communicate_utf8_async(null, this._cancellable, (proc_, res) => {
                try {
                    let [, stdout] = proc_.communicate_utf8_finish(res);
                    if (!proc_.get_successful())
                        throw this._failed(`${argv[0]} exited with status ${proc_.get_exit_status()}`);
                    resolve(stdout || '');
                } catch (e) {
                    reject(e);
                }
            });
        });
    }

    _loadPixbuf(path) {
        return new Promise((resolve, reject) => {
            Gio.File.new_for_path(path).read_async(GLib.PRIORITY_DEFAULT, this._cancellable, (file, res) => {
                let stream;
                try {
                    stream = file.read_finish(res);
                } catch (e) {
                    reject(e);
                    return;
                }
                GdkPixbuf.Pixbuf.new_from_stream_async(stream, this._cancellable, (obj, res_) => {
                    try {
                        resolve(GdkPixbuf.Pixbuf.new_from_stream_finish(res_));
                    } catch (e) {
                        reject(e);
                    } finally {
                        stream.close(null);
                    }
                });
            });
        });
    }

    _failed(message) {
        return new GLib.Error(Gio.IOErrorEnum, Gio.IOErrorEnum.FAILED, message);
    }

    _ensureScaledPix() {
        if (!this._pix)
            return;

        let scaleFactor = this.get_scale_factor();
        let width = this.get_allocated_width() * scaleFactor;
        let height = this.get_allocated_height() * scaleFactor;

        let origWidth = this._pix.get_width();
        let origHeight = this._pix.get_height();

        let scaleX = width / origWidth;
        let scaleY = height / origHeight;
        let scale = Math.min(scaleX, scaleY);

        if (!this.fullscreen)
            scale = Math.min(scale, 1.0 * scaleFactor);

        let newWidth = Math.floor(origWidth * scale);
        let newHeight = Math.floor(origHeight * scale);

        let scaledWidth = this._scaledSurface ? this._scaledSurface.getWidth() : 0;
        let scaledHeight = this._scaledSurface ? this._scaledSurface.getHeight() : 0;

        if (newWidth == scaledWidth && newHeight == scaledHeight)
            return;

        let interpType = GdkPixbuf.InterpType.BILINEAR;
        if (scale >= 3.0 * scaleFactor)
            interpType = GdkPixbuf.InterpType.NEAREST;

        let scaledPixbuf = this._pix.scale_simple(newWidth, newHeight, interpType);
        this._scaledSurface = Gdk.cairo_surface_create_from_pixbuf(scaledPixbuf,
                                                                   scaleFactor,
                                                                   this.get_window());
    }

    _setPix(pix) {
        this._pix = pix;
        this._scaledSurface = null;

        this.queue_resize();
        this.isReady();
    }

    get resizePolicy() {
        return Renderer.ResizePolicy.SCALED;
    }

    _cleanupTmpDir() {
        if (!this._tmpDir)
            return;
        // Best-effort: the dir only ever holds the preview exiv2 wrote
        // and, for non-JPEG previews, the converted copy.
        try {
            let dir = Gio.File.new_for_path(this._tmpDir);
            let enumerator = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
            let info;
            while ((info = enumerator.next_file(null)))
                dir.get_child(info.get_name()).delete(null);
            dir.delete(null);
        } catch (e) {
            // ignore
        }
        this._tmpDir = null;
    }

    _onDestroy() {
        // _extractPreview's finally clears the tmp dir once the cancelled
        // steps unwind.
        this._cancellable.cancel();
    }
});

var mimeTypes = [
    'image/x-3fr', 'image/x-adobe-dng', 'image/x-arw', 'image/x-bay',
    'image/x-canon-cr2', 'image/x-canon-cr3', 'image/x-canon-crw',
    'image/x-cap', 'image/x-cr2', 'image/x-crw', 'image/x-dcr',
    'image/x-dcraw', 'image/x-dcs', 'image/x-dng', 'image/x-drf',
    'image/x-eip', 'image/x-erf', 'image/x-fff', 'image/x-fuji-raf',
    'image/x-iiq', 'image/x-k25', 'image/x-kdc', 'image/x-mef',
    'image/x-minolta-mrw', 'image/x-mos', 'image/x-mrw', 'image/x-nef',
    'image/x-nikon-nef', 'image/x-nrw', 'image/x-olympus-orf',
    'image/x-orf', 'image/x-panasonic-raw', 'image/x-panasonic-rw2',
    'image/x-pef', 'image/x-pentax-pef', 'image/x-ptx', 'image/x-pxn',
    'image/x-r3d', 'image/x-raf', 'image/x-raw', 'image/x-rw2',
    'image/x-rwl', 'image/x-rwz', 'image/x-sigma-x3f', 'image/x-sony-arw',
    'image/x-sony-sr2', 'image/x-sony-srf', 'image/x-sr2', 'image/x-srf',
    'image/x-x3f',
];
