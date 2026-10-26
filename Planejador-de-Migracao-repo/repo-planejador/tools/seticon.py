"""Troca o ícone de um .exe (PE) sobrescrevendo os recursos RT_ICON no lugar.
Só substitui entradas de 32 bits cujo novo conteúdo cabe no espaço original;
o RT_GROUP_ICON passa a listar apenas as entradas substituídas."""
import io
import struct
import sys
from PIL import Image

exe, png = sys.argv[1], sys.argv[2]
buf = bytearray(open(exe, "rb").read())
src = Image.open(png).convert("RGBA")

pe = struct.unpack_from("<I", buf, 0x3C)[0]
assert buf[pe:pe + 4] == b"PE\0\0"
nsec = struct.unpack_from("<H", buf, pe + 6)[0]
optsz = struct.unpack_from("<H", buf, pe + 20)[0]
opt = pe + 24
magic = struct.unpack_from("<H", buf, opt)[0]
dd = opt + (96 if magic == 0x10B else 112)
res_rva, res_size = struct.unpack_from("<II", buf, dd + 2 * 8)
secs = []
s0 = opt + optsz
for i in range(nsec):
    o = s0 + 40 * i
    vsz, va, rawsz, rawptr = struct.unpack_from("<IIII", buf, o + 8)
    secs.append((va, max(vsz, rawsz), rawptr))


def r2o(rva):
    for va, sz, ptr in secs:
        if va <= rva < va + sz:
            return rva - va + ptr
    raise ValueError(hex(rva))


base = r2o(res_rva)


def entries(off):
    n1, n2 = struct.unpack_from("<HH", buf, off + 12)
    for i in range(n1 + n2):
        name, data = struct.unpack_from("<II", buf, off + 16 + 8 * i)
        yield name, data


def leaves(type_id):
    out = {}
    for name, data in entries(base):
        if name == type_id and data & 0x80000000:
            for nid, d2 in entries(base + (data & 0x7FFFFFFF)):
                sub = base + (d2 & 0x7FFFFFFF)
                if d2 & 0x80000000:
                    for _, d3 in entries(sub):
                        out[nid] = base + d3
                else:
                    out[nid] = sub
    return out


icons = leaves(3)
groups = leaves(14)


def dib32(img):
    w, h = img.size
    px = img.tobytes("raw", "BGRA")
    rows = [px[y * w * 4:(y + 1) * w * 4] for y in range(h)][::-1]
    mask_row = ((w + 31) // 32) * 4
    hdr = struct.pack("<IiiHHIIiiII", 40, w, h * 2, 1, 32, 0, w * h * 4 + mask_row * h, 0, 0, 0, 0)
    return hdr + b"".join(rows) + b"\0" * (mask_row * h)


replaced = 0
for gid, gleaf in groups.items():
    g_rva, g_size = struct.unpack_from("<II", buf, gleaf)
    goff = r2o(g_rva)
    _, typ, count = struct.unpack_from("<HHH", buf, goff)
    keep = []
    for i in range(count):
        e = goff + 6 + 14 * i
        w, h, colors, _, planes, bpp, nbytes, iid = struct.unpack_from("<BBBBHHIH", buf, e)
        size = w or 256
        if iid not in icons:
            continue
        leaf = icons[iid]
        i_rva, i_size = struct.unpack_from("<II", buf, leaf)
        ioff = r2o(i_rva)
        img = src.resize((size, size), Image.LANCZOS)
        if size >= 256:
            b = io.BytesIO()
            img.save(b, "PNG", optimize=True)
            data = b.getvalue()
            for ncol in (64, 32, 16):
                if len(data) <= i_size:
                    break
                b = io.BytesIO()
                img.quantize(colors=ncol, method=Image.FASTOCTREE).save(b, "PNG", optimize=True)
                data = b.getvalue()
        else:
            data = dib32(img)
        if bpp != 32 or len(data) > i_size:
            continue
        buf[ioff:ioff + len(data)] = data
        buf[ioff + len(data):ioff + i_size] = b"\0" * (i_size - len(data))
        struct.pack_into("<I", buf, leaf + 4, len(data))
        keep.append(struct.pack("<BBBBHHIH", w, h, 0, 0, 1, 32, len(data), iid))
        replaced += 1
    if keep:
        new = struct.pack("<HHH", 0, typ, len(keep)) + b"".join(keep)
        buf[goff:goff + g_size] = new + b"\0" * (g_size - len(new))
        struct.pack_into("<I", buf, gleaf + 4, len(new))

# o checksum do cabeçalho não é verificado para .exe comuns; zera para não ficar inconsistente
struct.pack_into("<I", buf, opt + 64, 0)
open(exe, "wb").write(buf)
print("ícones substituídos:", replaced, "grupos:", len(groups))
