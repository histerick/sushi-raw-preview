# sushi-raw-preview

Full RAW image preview in [GNOME Sushi](https://gitlab.gnome.org/GNOME/sushi) (the
Space-key Quick Look for Nautilus/Files), plus a downscaled RAW thumbnailer for the
Nautilus grid view — both powered by the same script, which extracts the RAW file's
embedded JPEG preview with `exiv2` instead of decoding the full RAW (fast, no
`dcraw`/`libraw` decode needed).

| | |
|---|---|
| **Nautilus grid** | Small thumbnail, downscaled (`exiv2raw.thumbnailer`, standard freedesktop.org thumbnailer) |
| **Sushi (Space key)** | Full-resolution preview (`viewers/raw.js`, Sushi plugin) |

Covers `.ORF, .ARW, .NEF, .RAF, .CR2, .CR3, .DNG, .RW2` and more (Canon CRW, Sony
SR2/SRF, Panasonic RW2, Fuji RAF, Sigma X3F, Minolta MRW, etc. — see `MimeType=` in
`exiv2raw.thumbnailer`), for any RAW format with an embedded preview (the vast
majority do).

## Why

[`emuskardin/nautilus-raw-thumbnails`](https://github.com/emuskardin/nautilus-raw-thumbnails)
already solves the grid-thumbnail half of this. This project forks that script to
also:
- downscale the grid thumbnail properly (the original wrote the full-size embedded
  preview straight into the thumbnail cache — fine for one photo, not for a folder
  full of them), while
- adding a **Sushi plugin** so pressing Space on a RAW file shows an actual
  full-resolution preview instead of a generic icon.

## Install

### 1. Dependencies

```bash
sudo apt install exiv2 imagemagick libimage-exiftool-perl   # Debian/Ubuntu
```

### 2. Grid thumbnailer (Nautilus/Nemo/Caja)

```bash
sudo cp thumbnailer/exiv2-thumbnailer.sh /usr/local/bin/
sudo chmod +x /usr/local/bin/exiv2-thumbnailer.sh
sudo cp thumbnailer/exiv2raw.thumbnailer /usr/share/thumbnailers/

nautilus -q          # restart Nautilus to pick it up
rm -rf ~/.cache/thumbnails/*   # force regeneration
```

### 3. Sushi plugin (Space-key full preview)

Only tested against **GNOME Sushi 50.x**, which uses the legacy GTK3/GJS
`imports`-based plugin system (`~/.local/share/sushi/viewers/*.js`). Check your
version with `dpkg -l gnome-sushi` / `gnome-sushi --version` before installing.

```bash
mkdir -p ~/.local/share/sushi/viewers
cp viewers/raw.js ~/.local/share/sushi/viewers/
```

No restart needed — Sushi is DBus-activated and picks up plugins on next launch.

## How it works

`exiv2-thumbnailer.sh <input> <output.png> [max-size]`:
1. Extracts the RAW's embedded JPEG preview with `exiv2 -ep1` into a private tmp
   dir (not the caller's cwd — important, since Nautilus/Sushi may invoke this
   with an arbitrary/read-only working directory, e.g. when browsing a network
   share).
2. Reads EXIF orientation with `exiftool` and rotates/flips accordingly with
   ImageMagick.
3. If a `max-size` argument is given, downscales to fit within that box
   (never upscales). The Nautilus `.thumbnailer` entry passes the standard
   freedesktop.org `%s` placeholder here. The Sushi plugin omits it, so Sushi
   always gets the full-resolution preview.

`viewers/raw.js` is a Sushi `Renderer` (based on Sushi's own built-in
`src/viewers/image.js`) that runs the script above with no size argument, loads
the resulting PNG as a `GdkPixbuf`, and displays it exactly like Sushi's native
image viewer — just fed from an extracted preview instead of a directly
pixbuf-loadable file.

## Compatibility

- **gnome-sushi ≤ 50.x**: works, as shipped here.
- **gnome-sushi ≥ 51**: Sushi is being rewritten to GTK4/Adwaita/Glycin
  on `main` at the time of writing, with a new plugin system
  (`~/.local/share/sushi/plugins-1/`, ES modules, `resource://.../plugin-api-1.js`).
  `viewers/raw.js` as written here will **not** load on that version — it needs
  porting to the new API. PRs welcome.

## License

- `viewers/raw.js` is derived from GNOME Sushi's own source and is
  **GPL-2.0-or-later** (see file header).
- `thumbnailer/exiv2-thumbnailer.sh` is forked from
  [emuskardin/nautilus-raw-thumbnails](https://github.com/emuskardin/nautilus-raw-thumbnails)
  and stays **MIT** (see file header and `LICENSE-MIT`).

See `LICENSE-GPL-2.0-or-later` and `LICENSE-MIT`.
