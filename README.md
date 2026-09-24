# sushi-raw-preview

An add-on for [nautilus-raw-thumbnails](https://github.com/emuskardin/nautilus-raw-thumbnails):
that project gives you RAW thumbnails in the Nautilus grid, this one adds a
**full-size preview when you press Space** on a RAW file in
[GNOME Sushi](https://gitlab.gnome.org/GNOME/sushi) (Nautilus/Files' Quick Look),
instead of a generic icon.

It uses the same idea — show the preview the camera already embedded in the RAW
file, extracted with `exiv2`, rather than decoding the whole RAW — and picks the
**largest** embedded preview, so you get the near-full-size image rather than the
tiny thumbnail most cameras also embed.

Works with any RAW format that has an embedded preview (the vast majority):
`.ORF, .ARW, .NEF, .RAF, .CR2, .CR3, .DNG, .RW2`, and more — see `mimeTypes` at
the end of `viewers/raw.js`.

## Install

It's a single file, installed per user — no `sudo` needed for the plugin itself.

### 1. Dependencies

```bash
# Debian/Ubuntu
sudo apt install exiv2 imagemagick libimage-exiftool-perl
# Fedora
# sudo dnf install exiv2 ImageMagick perl-Image-ExifTool
```

These are the same dependencies as nautilus-raw-thumbnails. Only `exiv2` is
strictly required here: ImageMagick is used for the non-JPEG previews some
phones embed (e.g. TIFF in Samsung DNGs), and `exiftool` is a fallback for
reading the photo's orientation.

### 2. The plugin

```bash
git clone https://github.com/histerick/sushi-raw-preview.git
mkdir -p ~/.local/share/sushi/viewers
cp sushi-raw-preview/viewers/raw.js ~/.local/share/sushi/viewers/
```

No restart needed: Sushi picks up plugins the next time it opens.

### 3. Grid thumbnails (optional, recommended)

For thumbnails in the Nautilus grid too, install
[nautilus-raw-thumbnails](https://github.com/emuskardin/nautilus-raw-thumbnails)
following its README. The two are independent: this plugin doesn't use or
replace any of that project's files, so either one can be installed, updated
or removed without affecting the other.

### Uninstall

```bash
rm ~/.local/share/sushi/viewers/raw.js
```

## How it works

When you press Space on a RAW file, `viewers/raw.js`:

1. Lists the previews embedded in the file (`exiv2 -pp`) and picks the largest.
2. Extracts it (`exiv2 -ep<N>`) into a private temporary directory — never the
   current directory, which may be read-only (e.g. a network share).
3. Loads it directly if it's a JPEG. Other formats are converted to JPEG with
   ImageMagick first (a JPEG, not a PNG: for a 50 MP phone preview that's ~1 s
   instead of ~9 s).
4. Rotates/flips it according to the RAW file's EXIF orientation.
5. Shows it just like Sushi's own image viewer does, and deletes the temporary
   files.

## Compatibility

- **gnome-sushi ≤ 50.x** (GTK3, the legacy `~/.local/share/sushi/viewers/*.js`
  plugin system): works. Tested on gnome-sushi 50.0 (Ubuntu 26.04).
- **gnome-sushi ≥ 51**: Sushi is being rewritten to GTK4/Adwaita/Glycin, with a
  new plugin system (`~/.local/share/sushi/plugins-1/`, ES modules).
  `viewers/raw.js` will **not** load there as-is — it needs porting to the new
  API. PRs welcome.

## License

`viewers/raw.js` is derived from GNOME Sushi's own `src/viewers/image.js` and is
**GPL-2.0-or-later** (see the file header and `LICENSE-GPL-2.0-or-later`).
